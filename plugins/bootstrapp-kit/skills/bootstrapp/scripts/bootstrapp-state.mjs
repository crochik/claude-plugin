#!/usr/bin/env node
// Copyright (c) 2026 Crochik Software Solutions, LLC. All rights reserved.
// Proprietary; use requires agreement to CSS license terms and prior written
// authorization from CSS. See LICENSE.
// Inspect a bootstrapp/ folder: validate manifests, compare them with the
// applied.json ledger, print the MCP calls a sync needs, and record applied items.
//
// Usage:
//   node bootstrapp-state.mjs status            [--dir bootstrapp] [--json]
//   node bootstrapp-state.mjs check             [--dir bootstrapp] [--json]
//   node bootstrapp-state.mjs plan              [--dir bootstrapp] [--summary]
//   node bootstrapp-state.mjs record <kind> <name...> [--dir bootstrapp] [--id <networkPolicyId>]
//        kind: app | profile | class | access | action | action-access | shared-script | script | event-script | network-policy | webhook | auth
//        (network-policy: --id is the id replace_network_policy returned)
//
// No dependencies; Node 18+.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const args = process.argv.slice(2);
const command = args[0] ?? "status";
const dirFlag = args.indexOf("--dir");
const dir = dirFlag >= 0 ? args[dirFlag + 1] : "bootstrapp";
const asJson = args.includes("--json");
const summary = args.includes("--summary");
const idFlag = args.indexOf("--id");
const recordedId = idFlag >= 0 ? args[idFlag + 1] : undefined;
const positional = args.slice(1).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--dir" && all[i - 1] !== "--id");

const SNAKE = /^[a-z][a-z0-9_]*$/;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const CAMEL = /^[a-z][A-Za-z0-9]*$/;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SCOPES = ["Instance", "Bulk", "Class"];

// Access control (see the bootstrapp-access skill). Names as the MCP tools take them.
const DEFAULT_PROFILE = "Admin"; // created by init_app, always full access, can't be restricted
const CLASS_PERMISSIONS = ["Read", "Create", "Update", "Delete", "Import", "Export", "BulkDelete", "BulkTag", "Customize", "DeepClone", "ReadOnly", "ReadWrite", "Full"];
const FIELD_PERMISSIONS = ["Read", "Update", "SetOnCreate", "Reset", "CreateOnDemand"];
const RELATION_PERMISSIONS = ["Read"];
const OPERATORS = ["Eq", "Ne", "Gt", "Gte", "Lt", "Lte", "In", "Nin"];
const CONTEXT_KEYS = ["AccountId", "OrganizationId", "UserId", "EntityId", "ProfileId", "ClientId", "AllProfileIds", "AllUserIds", "AllOrganizationIds", "AllEntityIds"];
const CONTEXT_VALUE = /^\{\{\s*context\s+"(?<key>[^"]+)"\s*\}\}$/;
const PROVIDERS = ["Microsoft", "Google", "Salesforce", "GitHub"];
const SIGNUP = ["open", "invite_only"];
// words the ApiScript grammar reserves: a property with one of these names can't follow "." in a script
const SCRIPT_RESERVED = new Set(["as", "from", "of", "number", "string", "boolean", "any", "Record", "import", "const", "let", "function", "if", "else", "for", "while", "return", "throw", "true", "false", "null"]);
const INT32_MAX = 2147483647;
const KINDS = { app: null, profile: "profiles", class: "classes", access: "access", action: "actions", "action-access": "actionAccess", "shared-script": "sharedScripts", script: "scripts", "event-script": "eventScripts", "network-policy": "networkPolicies", webhook: "webhooks", auth: null };
// network/<name>.json: the HTTP calls (system.http) a run started by one of the scripts it lists may make, the actions and
// shared scripts it calls included (replace_network_policy + set_script_network_policy). The server keeps policies by id
// (ledger) and saves them inactive: someone activates them outside the MCP server, and a change to an active one is
// saved as a new policy with a new id
const POLICY_ID = "<id replace_network_policy returned>";
const HTTP_SCHEMES = ["https", "http"];
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
// events/<fullObjectType>.<created|updated>.<scriptName>.ts: one of the scripts a class runs after one of its objects
// is created or updated (several per event, one per behavior)
const CLASS_EVENTS = { created: "Created", updated: "Updated" };
const EVENT_FILE = /^(?<cls>.+)\.(?<event>created|updated)\.(?<script>[^.]+)$/;
// webhooks/<name>.json: the replace_webhook arguments (without appName). replace_webhook makes the event classes:
// app.<app>.webhook.WebhookEvent (the base) and app.<app>.webhook.<Name>WebhookEvent per webhook
const WEBHOOK_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const WEBHOOK_FORMATS = ["json", "form", "xml", "raw"];
const WEBHOOK_AUTH = {
  none: [], hmac: ["header", "secret"], bearer: ["token"], apikey: ["token"], basic: ["username", "password"], ipAllowlist: ["ranges"],
  twilio: ["token"], ecdsa: ["publicKey"], stripe: ["secret"], docuseal: ["secret"], openphone: ["secret"], clientCert: ["thumbprints|subject"], bodyField: ["path", "value"],
};
const WEBHOOK_SECRETS = ["secret", "token", "password"];
const ENV_VALUE = /^\$\{env:(?<name>[A-Za-z_][A-Za-z0-9_]*)\}$/;
const webhookEventClass = (appName, name) => `app.${appName}.webhook.${name.charAt(0).toUpperCase()}${name.slice(1)}WebhookEvent`;

function fail(message) {
  console.error(`bootstrapp-state: ${message}`);
  process.exit(2);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { $error: `${path}: ${e.message}` };
  }
}

function listFiles(sub, ext) {
  const path = join(dir, sub);
  if (!existsSync(path)) return [];
  return readdirSync(path).filter((f) => f.endsWith(ext)).sort().map((f) => join(path, f));
}

// JSON Schema keywords that start with "$" and must reach the server
// ("$ref" is how a property embeds a registered class).
const SCHEMA_KEYWORDS = new Set(["$ref", "$defs", "$id", "$schema", "$anchor", "$dynamicRef", "$dynamicAnchor"]);

// Drop human-only "$" keys (like "$notes"), keep JSON Schema keywords, then
// serialize with sorted keys so formatting changes don't count as changes.
function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (!key.startsWith("$") || SCHEMA_KEYWORDS.has(key)) out[key] = strip(value[key]);
    }
    return out;
  }
  return value;
}

const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

// "elevated" in an action manifest goes to replace_action_script, not register_action,
// so it is part of the script's hash and not the action's.
const actionArgs = (data) => { const { elevated, ...rest } = strip(data); return rest; };
const scriptHash = (text, action) => hash(action?.elevated === true ? `${text}\n// elevated` : text);
const hashJson = (value) => hash(JSON.stringify(strip(value)));
// replace_script takes the manifest's fields and the script together, so both are one item
const sharedHash = (shared) => hash(`${JSON.stringify(strip(shared.data ?? {}))}\n${shared.text ?? ""}`);

// Shared scripts a script calls: scripts.<name>(...) through its import of app.<app>.scripts
function sharedCalls(text, appName) {
  if (!text || !appName) return [];
  const module = `app.${appName}.scripts`;
  const aliases = [...text.matchAll(/import\s+\*\s+as\s+([A-Za-z_]\w*)\s+from\s+["']([^"']+)["']/g)].filter((m) => m[2] === module).map((m) => m[1]);
  return [...new Set(aliases.flatMap((alias) => [...text.matchAll(new RegExp(`\\b${alias}\\.([A-Za-z_]\\w*)\\s*\\(`, "g"))].map((m) => m[1])))];
}

function load() {
  if (!existsSync(dir)) return null;
  const app = existsSync(join(dir, "app.json")) ? readJson(join(dir, "app.json")) : null;
  const classes = listFiles("classes", ".json").map((file) => ({ file, data: readJson(file) }));
  const actions = listFiles("actions", ".json").map((file) => ({ file, data: readJson(file) }));
  const scripts = listFiles("scripts", ".ts").map((file) => ({ file, name: basename(file, ".ts"), text: readFileSync(file, "utf8") }));
  const events = listFiles("events", ".ts").map((file) => {
    const name = basename(file, ".ts");
    const match = EVENT_FILE.exec(name);
    return { file, name, fullObjectType: match?.groups.cls ?? null, classEvent: match ? CLASS_EVENTS[match.groups.event] : null, scriptName: match?.groups.script ?? null, text: readFileSync(file, "utf8") };
  });
  const profiles = listFiles("profiles", ".json").map((file) => ({ file, data: readJson(file) }));
  // shared/<scriptName>.json (the replace_script arguments) next to shared/<scriptName>.ts (its script)
  const sharedNames = [...new Set([...listFiles("shared", ".json"), ...listFiles("shared", ".ts")].map((file) => basename(file).replace(/\.(json|ts)$/, "")))].sort();
  const shared = sharedNames.map((name) => {
    const json = join(dir, "shared", `${name}.json`);
    const ts = join(dir, "shared", `${name}.ts`);
    return { name, file: json, data: existsSync(json) ? readJson(json) : null, text: existsSync(ts) ? readFileSync(ts, "utf8") : null };
  });
  // access/<profileName>/<fullObjectType>.json, and access/actions/<actionName>.json
  const accessDir = join(dir, "access");
  const profileDirs = existsSync(accessDir)
    ? readdirSync(accessDir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "actions").map((d) => d.name).sort()
    : [];
  const access = profileDirs.flatMap((folder) => listFiles(join("access", folder), ".json").map((file) => ({ file, folder, data: readJson(file) })));
  const actionAccess = listFiles(join("access", "actions"), ".json").map((file) => ({ file, data: readJson(file) }));
  const webhooks = listFiles("webhooks", ".json").map((file) => ({ file, data: readJson(file) }));
  const auth = existsSync(join(dir, "auth.json")) ? { file: join(dir, "auth.json"), data: readJson(join(dir, "auth.json")) } : null;
  const network = listFiles("network", ".json").map((file) => ({ file, data: readJson(file) }));
  const ledgerPath = join(dir, "applied.json");
  const ledger = existsSync(ledgerPath) ? readJson(ledgerPath) : {};
  for (const key of ["profiles", "classes", "access", "actions", "actionAccess", "sharedScripts", "scripts", "eventScripts", "networkPolicies", "webhooks"]) ledger[key] ??= {};
  return { app, classes, actions, scripts, events, shared, profiles, access, actionAccess, webhooks, auth, network, ledger, ledgerPath };
}

const accessName = (data) => `${data.profileName}/${data.fullObjectType}`;

// The server's name of each local script that starts a run (actions and class event scripts), the one set_script_network_policy takes
function scriptServerNames(state) {
  const names = new Map();
  for (const script of state.scripts) {
    const action = state.actions.find((a) => !a.data.$error && a.data.actionName === script.name)?.data;
    if (action?.fullObjectType) names.set(`${action.fullObjectType}.${script.name}`, `scripts/${script.name}.ts`);
  }
  for (const event of state.events) {
    if (!event.fullObjectType) continue;
    names.set(`${event.fullObjectType}#${event.classEvent.toLowerCase()}#${event.scriptName}`, `events/${event.name}.ts`);
  }
  return names;
}

// ---------------------------------------------------------------- checks

function check(state) {
  const problems = [];
  const error = (where, message) => problems.push({ level: "error", where, message });
  const warn = (where, message) => problems.push({ level: "warning", where, message });

  const { app } = state;
  if (!app) {
    error("app.json", "missing; create it with name, title and description");
  } else if (app.$error) {
    error("app.json", app.$error);
  } else {
    if (!SNAKE.test(app.name ?? "")) error("app.json", `name "${app.name}" must be snake_case (lowercase letters, digits, underscores)`);
    if (!app.title) error("app.json", "title is required");
    if (!app.description || app.description.length < 20) error("app.json", "description should be a real paragraph");
  }
  const root = app?.name ? `app.${app.name}` : null;

  const byName = new Map();
  for (const { file, data } of state.classes) {
    if (data.$error) { error(file, data.$error); continue; }
    byName.set(data.fullObjectType, data);
  }

  const propsOf = (cls, seen = new Set()) => {
    const own = cls?.schema?.properties ?? {};
    const base = cls?.baseObjectType && !seen.has(cls.baseObjectType) ? byName.get(cls.baseObjectType) : null;
    return base ? { ...propsOf(base, seen.add(cls.baseObjectType)), ...own } : own;
  };

  for (const { file, data: cls } of state.classes) {
    if (cls.$error) continue;
    const name = cls.fullObjectType;
    const where = `classes/${basename(file)}`;
    if (!name) { error(where, "fullObjectType is required"); continue; }
    if (basename(file) !== `${name}.json`) warn(where, `file name should be ${name}.json`);

    const parts = name.split(".");
    const short = parts.at(-1);
    const ns = parts.slice(0, -1).join(".");
    if (root && !(ns === root || ns.startsWith(`${root}.`))) error(where, `must live under ${root}`);
    for (const seg of parts.slice(0, -1)) if (!SNAKE.test(seg)) error(where, `namespace segment "${seg}" must be snake_case`);
    if (!PASCAL.test(short)) warn(where, `class name "${short}" should be PascalCase`);
    if (["User", "Group"].includes(short)) error(where, "User and Group are platform classes; reference them by a *Id field instead");
    if (root && ns === `${root}.webhook` && cls.type === "TopLevel") error(where, `top-level classes in ${root}.webhook are webhook event classes, made by replace_webhook from webhooks/*.json; keep only embedded body classes here`);

    if (!["TopLevel", "Embedded"].includes(cls.type)) error(where, `type must be TopLevel or Embedded, got ${cls.type}`);
    if (!Array.isArray(cls.indexedFields)) error(where, "indexedFields is required (use [] for embedded classes)");
    if (cls.baseObjectType && root && !cls.baseObjectType.startsWith(`${root}.`)) error(where, `baseObjectType must live under ${root}`);
    if (cls.baseObjectType && !byName.has(cls.baseObjectType)) warn(where, `base class ${cls.baseObjectType} has no local manifest`);
    checkDiscriminator(cls, where, byName, error, warn);

    const schema = cls.schema;
    if (!schema || typeof schema !== "object") { error(where, "schema is required"); continue; }
    if (schema.type !== "object" && !schema.allOf) error(where, 'schema.type must be "object"');
    checkSchemaNode(schema, "schema", where, error, warn, true);

    for (const { path, ref } of schemaRefs(schema)) {
      if (!ref.startsWith(REF_PREFIX)) { error(where, `${path}: $ref must be ${REF_PREFIX}<full class name>`); continue; }
      const target = ref.slice(REF_PREFIX.length);
      const embedded = byName.get(target);
      if (target === name) error(where, `${path}: a class cannot embed itself`);
      else if (!embedded) warn(where, `${path}: embedded class ${target} has no local manifest; it must already exist on the server`);
      else if (embedded.type !== "Embedded") error(where, `${path}: ${target} is top-level and cannot be embedded; store its _id in a <name>Id field with a foreign key`);
    }
    for (const nested of inlineClassNames(schema, name)) {
      if (byName.has(nested)) error(where, `inline object creates embedded class ${nested}, which clashes with an existing manifest; use a $ref instead`);
    }

    const props = propsOf(cls);
    if (cls.type === "TopLevel") {
      if (root && ns !== root) warn(where, `top-level class outside ${root}; actions on it may not run (see the server's platform-notes.md)`);
      const id = props._id;
      if (!id) error(where, "top-level classes need an _id property (string, format uuid)");
      else if (id.type !== "string" || id.format !== "uuid") error(where, "_id must be { type: string, format: uuid }");
      if (!cls.baseObjectType && !(schema.required ?? []).includes("_id")) warn(where, "_id should be listed in required");
      if (Array.isArray(cls.indexedFields) && !cls.indexedFields.includes("_id")) warn(where, "indexedFields should include _id");
    } else if (cls.type === "Embedded") {
      if (schema.properties?._id) warn(where, "embedded classes should not declare _id");
      if (cls.indexedFields?.length) error(where, "embedded classes must use indexedFields: []");
    }

    for (const [field, prop] of Object.entries(schema.properties ?? {})) {
      if (SCRIPT_RESERVED.has(field)) warn(where, `property "${field}" is a reserved word in ApiScript, so scripts can't read or write it (input.${field} fails to save); rename it`);
      if (prop?.type === "integer" && [prop.maximum, prop.minimum, prop.exclusiveMaximum].some((v) => typeof v === "number" && (v > INT32_MAX || v < -INT32_MAX - 1))) {
        error(where, `property "${field}": integer fields are 32-bit signed (max ${INT32_MAX}) whatever maximum says; store larger values as a string (e.g. hex for colors)`);
      }
    }
    for (const field of cls.indexedFields ?? []) {
      if (!props[field]) error(where, `indexed field "${field}" is not a property`);
    }
    checkForeignKeys(cls, propsOf, where, byName, error, warn);
    for (const key of Object.keys(schema.properties ?? {})) {
      if (key !== "_id" && !CAMEL.test(key)) warn(where, `property "${key}" should be camelCase`);
    }
  }

  const actionNames = new Set();
  for (const { file, data: action } of state.actions) {
    const where = `actions/${basename(file)}`;
    if (action.$error) { error(where, action.$error); continue; }
    for (const key of ["fullObjectType", "actionName", "actionSummary", "actionDescription", "scope", "actionInputObjectType", "actionOutputObjectType"]) {
      if (!action[key]) error(where, `${key} is required`);
    }
    if (!action.actionName) continue;
    actionNames.add(action.actionName);
    if (basename(file) !== `${action.actionName}.json`) warn(where, `file name should be ${action.actionName}.json`);
    if (!CAMEL.test(action.actionName)) warn(where, "actionName should be camelCase");
    if (!SCOPES.includes(action.scope)) error(where, `scope must be one of ${SCOPES.join(", ")}`);
    if (action.elevated === undefined) warn(where, "elevated is not set; the script runs with the caller's access. Decide and set true or false (bootstrapp-apiscript skill, Elevated scripts)");
    else if (typeof action.elevated !== "boolean") error(where, "elevated must be true or false");

    const target = byName.get(action.fullObjectType);
    if (!target) warn(where, `target ${action.fullObjectType} has no local manifest`);
    else if (target.type !== "TopLevel") error(where, "target must be a top-level class");

    for (const key of ["actionInputObjectType", "actionOutputObjectType"]) {
      const io = byName.get(action[key]);
      if (!action[key]) continue;
      if (!io) { warn(where, `${key} ${action[key]} has no local manifest`); continue; }
      if (io.type !== "Embedded") error(where, `${key} must be an embedded class`);
      if (root && action[key].split(".").slice(0, -1).join(".") === root) warn(where, `${key} should live in an actions namespace, not ${root}`);
    }

    const input = byName.get(action.actionInputObjectType);
    if (input) {
      const props = propsOf(input);
      const required = input.schema?.required ?? [];
      if (action.scope === "Instance" && !(props.id && required.includes("id"))) error(where, "Instance scope needs a required id (uuid) on the input class");
      if (action.scope === "Bulk" && !(props.ids?.type === "array" && required.includes("ids"))) error(where, "Bulk scope needs a required ids array on the input class");
      if (action.scope === "Class" && (props.id || props.ids)) error(where, "Class scope input must not declare id or ids");
    }
    if (!state.scripts.some((s) => s.name === action.actionName)) warn(where, `no script yet (scripts/${action.actionName}.ts)`);
  }

  for (const script of state.scripts) {
    if (!actionNames.has(script.name)) warn(`scripts/${script.name}.ts`, "no matching action manifest");
  }

  const webhookClasses = new Set(state.app?.name ? state.webhooks.filter((w) => !w.data.$error && w.data.name).map((w) => webhookEventClass(state.app.name, w.data.name)) : []);
  for (const event of state.events) {
    const where = `events/${event.name}.ts`;
    if (!event.fullObjectType) { error(where, "name it <fullObjectType>.created.<scriptName>.ts or <fullObjectType>.updated.<scriptName>.ts"); continue; }
    if (!IDENTIFIER.test(event.scriptName)) error(where, `script name "${event.scriptName}" must be an identifier such as updateOrderTotal`);
    else if (!CAMEL.test(event.scriptName)) warn(where, `script name "${event.scriptName}" should be camelCase`);
    const target = byName.get(event.fullObjectType);
    const webhookClass = webhookClasses.has(event.fullObjectType);
    if (!target && !webhookClass) warn(where, `class ${event.fullObjectType} has no local manifest; it must already exist on the server`);
    else if (target && target.type !== "TopLevel") error(where, "only top-level classes fire created and updated events");
    if (root && !webhookClass && event.fullObjectType.split(".").slice(0, -1).join(".") !== root) error(where, `only classes directly in ${root} (and webhook event classes, from webhooks/*.json) have a flow to run it from`);
    if (!event.text.trim()) error(where, "the script is empty");
  }

  checkAccess(state, byName, propsOf, error, warn);
  checkShared(state, byName, error, warn);
  checkWebhooks(state, byName, error, warn);
  checkNetwork(state, error, warn);

  return problems;
}

function checkWebhooks(state, byName, error, warn) {
  const appName = state.app?.name;
  for (const { file, data: hook } of state.webhooks) {
    const where = `webhooks/${basename(file)}`;
    if (hook.$error) { error(where, hook.$error); continue; }
    if (!CAMEL.test(hook.name ?? "")) { error(where, `name "${hook.name}" must be camelCase, such as stripe or githubPullRequests`); continue; }
    if (basename(file) !== `${hook.name}.json`) warn(where, `file name should be ${hook.name}.json`);
    if ("appName" in hook) warn(where, "appName comes from app.json; leave it out");
    if ("rotateUrl" in hook) error(where, "rotateUrl is a one-off: call replace_webhook with rotateUrl: true yourself, don't keep it in the manifest");

    if (!hook.bodyClass) error(where, "bodyClass is required: the embedded class the parsed body is stored as");
    else {
      const body = byName.get(hook.bodyClass);
      if (appName && !hook.bodyClass.startsWith(`app.${appName}.`)) error(where, `bodyClass must live under app.${appName}`);
      if (!body) warn(where, `body class ${hook.bodyClass} has no local manifest; it must already exist on the server`);
      else if (body.type !== "Embedded") error(where, `body class ${hook.bodyClass} must be Embedded`);
    }

    if (!Array.isArray(hook.auth) || !hook.auth.length) error(where, 'auth is required: the provider\'s checks, or [{ "type": "none" }] for a webhook anyone with the URL can call');
    else {
      if (hook.auth.some((a) => a?.type === "none") && hook.auth.length > 1) error(where, "auth: none can't be combined with other steps");
      hook.auth.forEach((step, i) => {
        const required = WEBHOOK_AUTH[step?.type];
        if (!required) { error(where, `auth[${i}]: unknown type ${step?.type}; use one of ${Object.keys(WEBHOOK_AUTH).join(", ")}`); return; }
        for (const field of required) {
          if (!field.split("|").some((f) => step[f] !== undefined && step[f] !== "" && !(Array.isArray(step[f]) && !step[f].length))) error(where, `auth[${i}] (${step.type}) needs ${field.replace("|", " or ")}`);
        }
        for (const field of WEBHOOK_SECRETS) {
          const value = step[field];
          if (typeof value !== "string" || ENV_VALUE.test(value)) continue;
          if (value === "generate") {
            if (!["bearer", "apikey", "basic"].includes(step.type)) error(where, `auth[${i}].${field}: "generate" only works for bearer, apikey and basic; a ${step.type} secret comes from the provider`);
            else warn(where, `auth[${i}].${field}: "generate" makes a new secret on every apply; after the first, save the returned one in .env and write \${env:NAME} here`);
          } else if (value === "set") warn(where, `auth[${i}].${field}: "set" keeps the server's secret, but a new environment can't be set up from this manifest; prefer \${env:NAME}`);
          else error(where, `auth[${i}].${field}: don't commit secrets; write \${env:NAME} and put the value in .env`);
        }
      });
    }

    for (const method of hook.methods ?? []) if (!WEBHOOK_METHODS.includes(method)) error(where, `methods: ${method} is not one of ${WEBHOOK_METHODS.join(", ")}`);
    if (hook.methods && !hook.methods.length) error(where, "methods can't be empty (leave it out for POST)");
    if (hook.format !== undefined && !WEBHOOK_FORMATS.includes(hook.format)) error(where, `format must be one of ${WEBHOOK_FORMATS.join(", ")}`);
    if (hook.dedupeKey && !/^(header|body):[^:\s]+$/.test(hook.dedupeKey)) error(where, "dedupeKey must be header:<name> or body:<dot.path>");
    if (!hook.dedupeKey) warn(where, "no dedupeKey: a delivery the provider sends again is saved twice, so the processing script must be safe to run twice");
    if (appName && !state.events.some((e) => e.fullObjectType === webhookEventClass(appName, hook.name) && e.classEvent === "Created")) {
      warn(where, `nothing processes its events yet: add events/${webhookEventClass(appName, hook.name)}.created.<scriptName>.ts`);
    }
  }
}

function checkShared(state, byName, error, warn) {
  const profileNames = new Set(state.profiles.map((p) => p.data?.profileName).filter(Boolean));
  for (const shared of state.shared) {
    const where = `shared/${shared.name}.json`;
    if (!IDENTIFIER.test(shared.name)) error(`shared/${shared.name}`, "the file name is the script's function name: use an identifier such as orderTotal");
    if (shared.text === null) warn(where, `no script yet (shared/${shared.name}.ts)`);
    if (!shared.data) { warn(`shared/${shared.name}.ts`, `no manifest (shared/${shared.name}.json with scriptName and description); it can't be applied`); continue; }
    const data = shared.data;
    if (data.$error) { error(where, data.$error); continue; }
    if (!data.scriptName) error(where, "scriptName is required");
    else if (data.scriptName !== shared.name) error(where, `scriptName "${data.scriptName}" doesn't match its file name ${shared.name}`);
    else if (!CAMEL.test(data.scriptName)) warn(where, "scriptName should be camelCase");
    if (!data.description) error(where, "description is required (what it does; callers see it in platform.d.ts)");
    if ("elevated" in data) error(where, "shared scripts have no elevated flag: they run with their caller's access, elevated only when the caller is");
    for (const key of ["inputObjectType", "outputObjectType"]) {
      if (data[key] === undefined || data[key] === "") continue;
      if (typeof data[key] !== "string") error(where, `${key} must be a class's full name`);
      else if (!byName.has(data[key])) warn(where, `${key} ${data[key]} has no local manifest; it must already exist on the server`);
    }
    if (data.profiles !== undefined && !Array.isArray(data.profiles)) { error(where, "profiles must be a list of profile names (leave it out to let every caller run it)"); continue; }
    for (const p of data.profiles ?? []) {
      if (p.toLowerCase() === DEFAULT_PROFILE.toLowerCase()) warn(where, `${DEFAULT_PROFILE} can always call it; no need to list it`);
      else if (!profileNames.has(p)) warn(where, `profile ${p} has no local manifest; it must already exist on the server`);
    }
  }

  const sharedNames = new Set(state.shared.map((s) => s.name));
  const appName = state.app?.name;
  const callers = [
    ...state.shared.map((s) => ({ where: `shared/${s.name}.ts`, text: s.text })),
    ...state.scripts.map((s) => ({ where: `scripts/${s.name}.ts`, text: s.text })),
    ...state.events.map((s) => ({ where: `events/${s.name}.ts`, text: s.text })),
  ];
  for (const { where, text } of callers) {
    for (const name of sharedCalls(text, appName)) {
      if (!sharedNames.has(name)) warn(where, `calls shared script ${name}, which has no local manifest; it must already exist on the server`);
    }
  }
}

function checkNetwork(state, error, warn) {
  const appName = state.app?.name;
  const local = scriptServerNames(state);
  const owner = new Map();
  for (const { file, data } of state.network) {
    const where = `network/${basename(file)}`;
    if (data.$error) { error(where, data.$error); continue; }
    if (!IDENTIFIER.test(data.name ?? "")) { error(where, "name is required: an identifier such as stripe"); continue; }
    if (basename(file) !== `${data.name}.json`) warn(where, `file name should be ${data.name}.json`);
    if (!data.description) warn(where, "description: say what the policy is for");
    if (!Array.isArray(data.rules)) error(where, "rules is required (a list; [] refuses every call)");
    for (const [i, rule] of (Array.isArray(data.rules) ? data.rules : []).entries()) {
      const at = `rules[${i}]`;
      const host = typeof rule?.host === "string" ? rule.host.trim() : "";
      if (!host) { error(where, `${at}.host is required`); continue; }
      if (host.includes("/")) error(where, `${at}.host must be the host alone (api.example.com), not a url`);
      else if (/^\*\.[^.]+$/.test(host)) error(where, `${at}.host ${host} matches a whole top level domain`);
      else if (host.slice(host.startsWith("*.") ? 2 : 0).includes("*")) error(where, `${at}.host: only a leading *. is allowed`);
      if (rule.schemes !== undefined && !(Array.isArray(rule.schemes) && rule.schemes.every((x) => HTTP_SCHEMES.includes(String(x).toLowerCase())))) error(where, `${at}.schemes must be a list of ${HTTP_SCHEMES.join(", ")}`);
      if (rule.methods !== undefined && !(Array.isArray(rule.methods) && rule.methods.every((x) => HTTP_METHODS.includes(String(x).toUpperCase())))) error(where, `${at}.methods must be a list of ${HTTP_METHODS.join(", ")}`);
      if ((rule.schemes ?? []).some((x) => String(x).toLowerCase() === "http")) warn(where, `${at}: http sends the request (and any key in it) unencrypted; use https unless the service has no https`);
    }
    if (data.scripts !== undefined && !Array.isArray(data.scripts)) { error(where, "scripts must be a list of script names"); continue; }
    for (const script of data.scripts ?? []) {
      if (appName && !String(script).startsWith(`app.${appName}.`)) error(where, `script ${script} isn't one of ${appName}'s (their names start with app.${appName}.)`);
      else if (appName && String(script).startsWith(`app.${appName}.scripts.`)) error(where, `script ${script} is a shared script: it runs under the policy of the action or class event script that calls it, so list that one instead`);
      else if (!local.has(script)) warn(where, `script ${script} has no local file; it must already exist on the server. Names: <fullObjectType>.<actionName>, <fullObjectType>#created#<name> or #updated#`);
      if (owner.has(script)) error(where, `script ${script} is also in network/${owner.get(script)}.json; a script has one network policy`);
      else owner.set(script, data.name);
    }
  }
}

function checkAccess(state, byName, propsOf, error, warn) {
  const profileNames = new Set();
  const profiles = new Map();
  for (const { file, data } of state.profiles) {
    const where = `profiles/${basename(file)}`;
    if (data.$error) { error(where, data.$error); continue; }
    if (!data.profileName) { error(where, "profileName is required"); continue; }
    if (basename(file) !== `${data.profileName}.json`) warn(where, `file name should be ${data.profileName}.json`);
    if (data.profileName.toLowerCase() === DEFAULT_PROFILE.toLowerCase()) error(where, `${DEFAULT_PROFILE} is the app's default profile (created by init_app, always full access); don't declare it`);
    if (data.profileName === "actions") error(where, '"actions" is reserved (access/actions/ holds action access)');
    if (!data.description) error(where, "description is required (what users with this profile do)");
    if (data.copyAccessFrom) error(where, "copyAccessFrom isn't used in manifests: write the access/ files for this profile instead");
    profileNames.add(data.profileName);
    profiles.set(data.profileName, data);
  }
  const knownProfile = (name) => profileNames.has(name) || name?.toLowerCase() === DEFAULT_PROFILE.toLowerCase();

  for (const [name, data] of profiles) {
    const where = `profiles/${name}.json`;
    if (data.inheritsFrom !== undefined && !Array.isArray(data.inheritsFrom)) { error(where, "inheritsFrom must be a list of profile names"); continue; }
    for (const parent of data.inheritsFrom ?? []) {
      if (parent === name) error(where, "a profile can't inherit from itself");
      else if (!knownProfile(parent)) warn(where, `inherits from ${parent}, which has no local manifest; it must already exist on the server`);
    }
  }

  const badValues = (values, allowed) => (Array.isArray(values) ? values.filter((v) => !allowed.includes(v)) : null);

  // A class outside this app (another app's, or one no app owns) is granted to this app's profiles with profileApp: this app
  const appName = state.app?.name;
  const isOwnClass = (fullObjectType) => !appName || fullObjectType.startsWith(`app.${appName}.`);
  const checkProfileApp = (where, data) => {
    if (isOwnClass(data.fullObjectType)) {
      if (data.profileApp !== undefined && data.profileApp !== appName) error(where, `profileApp must be ${appName} (this app) or left out for its own classes`);
      return true;
    }
    if (data.fullObjectType.startsWith("system.")) error(where, "system.* classes are the platform's; their access isn't set per profile");
    if (data.profileApp !== appName) error(where, `${data.fullObjectType} isn't a class of ${appName}: set "profileApp": "${appName}" so the grant goes to this app's profile`);
    return false;
  };

  for (const { file, folder, data } of state.access) {
    const where = `access/${folder}/${basename(file)}`;
    if (data.$error) { error(where, data.$error); continue; }
    if (!data.fullObjectType || !data.profileName) { error(where, "fullObjectType and profileName are required"); continue; }
    if (data.profileName !== folder) error(where, `profileName "${data.profileName}" doesn't match its folder ${folder}`);
    if (basename(file) !== `${data.fullObjectType}.json`) warn(where, `file name should be ${data.fullObjectType}.json`);
    const own = checkProfileApp(where, data);
    if (own && data.profileName.toLowerCase() === DEFAULT_PROFILE.toLowerCase()) { error(where, `${DEFAULT_PROFILE} always has full access and can't be restricted`); continue; }
    if (!knownProfile(data.profileName)) warn(where, `profile ${data.profileName} has no local manifest; it must already exist on the server`);

    const bad = badValues(data.permissions, CLASS_PERMISSIONS);
    if (!bad) error(where, "permissions is required (a list; [] removes the profile's access)");
    else if (bad.length) error(where, `unknown permissions ${bad.join(", ")}. Valid: ${CLASS_PERMISSIONS.join(", ")}`);
    const removing = Array.isArray(data.permissions) && data.permissions.length === 0;
    if (removing && (Object.keys(data.fieldPermissions ?? {}).length || Object.keys(data.relationPermissions ?? {}).length || data.constraints?.length || data.updateConstraints?.length || data.deleteConstraints?.length)) {
      error(where, "permissions [] removes access; don't combine it with field, relation or constraint settings");
    }

    const cls = byName.get(data.fullObjectType);
    if (!cls && own) warn(where, `class ${data.fullObjectType} has no local manifest; fields and constraints can't be checked`);
    const ownFields = cls?.schema?.properties ?? {};
    const all = cls ? propsOf(cls) : {};

    for (const [field, values] of Object.entries(data.fieldPermissions ?? {})) {
      if (cls && !ownFields[field]) error(where, all[field] ? `field ${field} is inherited from ${cls.baseObjectType}: set its access there` : `${data.fullObjectType} has no field ${field}`);
      const badField = badValues(values, FIELD_PERMISSIONS);
      if (!badField) error(where, `fieldPermissions.${field} must be a list ([] hides the field)`);
      else if (badField.length) error(where, `fieldPermissions.${field}: unknown ${badField.join(", ")}. Valid: ${FIELD_PERMISSIONS.join(", ")}`);
    }
    if (data.defaultFieldPermissions !== undefined) {
      const badDefault = badValues(data.defaultFieldPermissions, FIELD_PERMISSIONS);
      if (!badDefault) error(where, "defaultFieldPermissions must be a list");
      else if (badDefault.length) error(where, `defaultFieldPermissions: unknown ${badDefault.join(", ")}. Valid: ${FIELD_PERMISSIONS.join(", ")}`);
    }
    for (const [relation, values] of Object.entries(data.relationPermissions ?? {})) {
      const badRelation = badValues(values, RELATION_PERMISSIONS);
      if (!badRelation) error(where, `relationPermissions.${relation} must be a list`);
      else if (badRelation.length) error(where, `relationPermissions.${relation}: only Read, or [] to hide it`);
    }

    const shorthands = { ReadOnly: ["Read"], ReadWrite: ["Read", "Create", "Update"], Full: ["Read", "Create", "Update", "Delete"] };
    const granted = (Array.isArray(data.permissions) ? data.permissions : []).flatMap((p) => shorthands[p] ?? [p]);
    const grants = (...names) => names.some((n) => granted.includes(n));
    if (data.updateConstraints?.length && !grants("Update", "Delete", "BulkDelete", "BulkTag")) error(where, "updateConstraints narrow Update and Delete, but permissions grant neither");
    if (data.deleteConstraints?.length && !grants("Delete", "BulkDelete")) error(where, "deleteConstraints narrow Delete, but permissions don't grant it");

    for (const list of ["constraints", "updateConstraints", "deleteConstraints"]) {
      if (data[list] !== undefined && !Array.isArray(data[list])) { error(where, `${list} must be a list`); continue; }
      if (data[list]?.length && cls?.type === "Embedded") error(where, `${list} only apply to top-level classes`);
      for (const [i, c] of (data[list] ?? []).entries()) {
        const at = `${list}[${i}]`;
        if (!c?.fieldName || !c.operator) { error(where, `${at}: fieldName and operator are required`); continue; }
        if (list !== "constraints" && c.fieldName.includes(".")) error(where, `${at}: update and delete constraints take top-level fields only, not ${c.fieldName}`);
        if (cls && !all[c.fieldName.split(".")[0]]) error(where, `${at}: ${data.fullObjectType} has no field ${c.fieldName}; add it to the class (e.g. ownerId, organizationId) first`);
        if (!OPERATORS.includes(c.operator)) error(where, `${at}: operator must be one of ${OPERATORS.join(", ")}`);
        const values = Array.isArray(c.value) ? c.value : [c.value];
        const isList = Array.isArray(c.value) || (typeof c.value === "string" && /"All\w+Ids"/.test(c.value));
        if (["In", "Nin"].includes(c.operator) && !isList) error(where, `${at}: ${c.operator} takes a list (or an All*Ids context value)`);
        if (OPERATORS.includes(c.operator) && !["In", "Nin"].includes(c.operator) && isList) error(where, `${at}: ${c.operator} takes a single value; use In or Nin with a list`);
        for (const v of values) {
          if (typeof v !== "string" || !v.includes("{{")) continue;
          const key = CONTEXT_VALUE.exec(v)?.groups?.key;
          if (!key) error(where, `${at}: "${v}" must be exactly {{context "Key"}}`);
          else if (!CONTEXT_KEYS.includes(key) && !key.startsWith("Claims.")) error(where, `${at}: unknown context key ${key}. Valid: ${CONTEXT_KEYS.join(", ")}, Claims.<name>`);
          else if (key.startsWith("Claims.") && !(key.slice(7) in (state.auth?.data?.calculatedClaims ?? {}))) warn(where, `${at}: claim ${key.slice(7)} isn't in auth.json calculatedClaims; it must be a claim the token already has`);
        }
      }
    }
  }

  const actionsByName = new Map(state.actions.filter((a) => !a.data.$error).map((a) => [a.data.actionName, a.data]));
  for (const { file, data } of state.actionAccess) {
    const where = `access/actions/${basename(file)}`;
    if (data.$error) { error(where, data.$error); continue; }
    if (!data.fullObjectType || !data.actionName) { error(where, "fullObjectType and actionName are required"); continue; }
    if (basename(file) !== `${data.actionName}.json`) warn(where, `file name should be ${data.actionName}.json`);
    const own = checkProfileApp(where, data);
    const action = actionsByName.get(data.actionName);
    if (!action && own) warn(where, `action ${data.actionName} has no local manifest; it must already be registered`);
    else if (action && action.fullObjectType !== data.fullObjectType) error(where, `${data.actionName} is registered on ${action.fullObjectType}, not ${data.fullObjectType}`);
    if (!Array.isArray(data.profiles)) { error(where, "profiles is required (a list; [] leaves only the default profile)"); continue; }
    for (const p of data.profiles) {
      if (own && p.toLowerCase() === DEFAULT_PROFILE.toLowerCase()) warn(where, `${DEFAULT_PROFILE} always runs every action; no need to list it`);
      else if (!knownProfile(p)) warn(where, `profile ${p} has no local manifest; it must already exist on the server`);
    }
  }

  if (state.auth) {
    const where = "auth.json";
    const data = state.auth.data;
    if (data.$error) { error(where, data.$error); return; }
    const badProviders = badValues(data.providers, PROVIDERS);
    if (!badProviders || !data.providers.length) error(where, `providers is required: one or more of ${PROVIDERS.join(", ")}`);
    else if (badProviders.length) error(where, `unknown providers ${badProviders.join(", ")}. Valid: ${PROVIDERS.join(", ")}`);
    if (!SIGNUP.includes(data.signup)) error(where, `signup must be ${SIGNUP.join(" or ")}`);
    if (!data.signupProfile) error(where, "signupProfile is required");
    else if (!knownProfile(data.signupProfile)) warn(where, `signupProfile ${data.signupProfile} has no local manifest; it must already exist on the server`);
    else if (data.signup === "open" && data.signupProfile.toLowerCase() === DEFAULT_PROFILE.toLowerCase()) {
      warn(where, `open sign-up with ${DEFAULT_PROFILE} gives anyone who signs in full access; use a restricted profile`);
    }
    for (const provider of Object.keys(data.providerTenants ?? {})) {
      if (!(data.providers ?? []).includes(provider)) error(where, `providerTenants.${provider}: ${provider} isn't in providers`);
    }
    for (const [claim, expression] of Object.entries(data.calculatedClaims ?? {})) {
      if (typeof expression !== "string" || !expression.includes("{{")) error(where, `calculatedClaims.${claim} must be a {{...}} expression`);
    }
  }
}

const REF_PREFIX = "#/components/schemas/";

// Every $ref in a schema, with the path it was found at.
function schemaRefs(node, path = "schema", out = []) {
  if (!node || typeof node !== "object") return out;
  if (typeof node.$ref === "string") { out.push({ path, ref: node.$ref }); return out; }
  for (const [key, child] of Object.entries(node.properties ?? {})) schemaRefs(child, `${path}.properties.${key}`, out);
  if (node.items && typeof node.items === "object") schemaRefs(node.items, `${path}.items`, out);
  if (node.additionalProperties && typeof node.additionalProperties === "object") schemaRefs(node.additionalProperties, `${path}.additionalProperties`, out);
  return out;
}

// add_object_class stores each inline object property as an embedded class named <parent>.<property>.
function inlineClassNames(node, parent, out = []) {
  for (const [key, child] of Object.entries(node?.properties ?? {})) {
    const shape = child?.type === "array" ? child.items
      : child?.type === "object" && !child.properties && typeof child.additionalProperties === "object" ? child.additionalProperties
      : child;
    if (shape?.type === "object" && shape.properties && !shape.$ref) {
      out.push(`${parent}.${key}`);
      inlineClassNames(shape, `${parent}.${key}`, out);
    }
  }
  return out;
}

// A discriminated class extends a base with a value of one of the base's own required string properties (discriminatorField,
// the same for every class of the base; the server infers it after the first one and adds the values to the field's enum).
function checkDiscriminator(cls, where, byName, error, warn) {
  const siblings = [...byName.values()].filter((other) => other !== cls && other.baseObjectType && other.baseObjectType === cls.baseObjectType);
  const field = cls.discriminatorField;
  const value = cls.discriminatorValue;
  if (field === undefined && value === undefined) {
    const used = siblings.find((other) => other.discriminatorValue !== undefined);
    if (used) error(where, `${used.fullObjectType} extends ${cls.baseObjectType} with a discriminator: set discriminatorField and discriminatorValue here too`);
    return;
  }
  if (typeof value !== "string" || !value) { error(where, "discriminatorValue must be a non-empty string"); return; }
  if (typeof field !== "string" || !field) { error(where, "discriminatorField must name the base's property that holds discriminatorValue"); return; }
  if (!cls.baseObjectType) { error(where, "discriminatorField and discriminatorValue need a baseObjectType"); return; }
  if (cls.schema?.properties?.[field]) error(where, `"${field}" comes from ${cls.baseObjectType}; leave it out of this schema`);
  for (const other of siblings) {
    if (other.discriminatorField !== undefined && other.discriminatorField !== field) error(where, `${other.fullObjectType} uses discriminatorField "${other.discriminatorField}"; every class of ${cls.baseObjectType} must use the same one`);
    if (other.discriminatorValue === value) error(where, `${other.fullObjectType} already uses ${field} = "${value}"`);
  }
  const base = byName.get(cls.baseObjectType);
  if (!base) return; // the base exists only on the server, which checks the rest
  if (base.type !== cls.type) error(where, `${base.fullObjectType} is ${base.type}: a discriminated class must have its base's type`);
  const prop = base.schema?.properties?.[field];
  if (!prop) error(where, `discriminatorField "${field}" must be one of ${base.fullObjectType}'s own properties`);
  else {
    if (field === "_id" || prop.type !== "string") error(where, `discriminatorField "${field}" must be a string property of ${base.fullObjectType}`);
    if (!(base.schema.required ?? []).includes(field)) error(where, `discriminatorField "${field}" must be listed in ${base.fullObjectType}'s required`);
    if (base.type === "TopLevel" && !(base.indexedFields ?? []).includes(field)) warn(where, `${base.fullObjectType}'s "${field}" is usually worth indexing`);
  }
}

// The shape a foreign key's property must have: a string (reference), an array of strings (multi reference),
// or a dictionary of strings (its keys or values are references, per dictionaryPart). null when it can't hold ids.
function foreignKeyShape(prop) {
  if (prop?.type === "string" && !prop.enum) return "reference";
  if (prop?.type === "array" && prop.items?.type === "string" && !prop.items.enum) return "multi";
  if (prop?.type === "object" && !prop.properties && prop.additionalProperties?.type === "string") return "dictionary";
  return null;
}

// Mirrors add_object_class: every property that holds ids of other records is a foreign key of the right shape,
// pointing at a top-level class and at _id or one of its fields.
function checkForeignKeys(cls, propsOf, where, byName, error, warn) {
  // the server looks the field up among the class' own properties, and the target's field among all of its
  const props = cls.schema?.properties ?? {};
  const seen = new Set();
  const declared = new Set();
  for (const fk of cls.foreignKeys ?? []) {
    const field = fk.localFieldName;
    const part = fk.dictionaryPart;
    declared.add(field);
    if (seen.has(`${field}|${part ?? ""}`)) error(where, `foreign key field "${field}" is listed more than once`);
    seen.add(`${field}|${part ?? ""}`);
    if (part !== undefined && part !== null && !["key", "value"].includes(part)) error(where, `foreign key "${field}": dictionaryPart must be "key" or "value"`);
    if (!fk.referenceObjectType || !fk.referenceFieldName) error(where, "foreign keys need referenceObjectType and referenceFieldName");

    const prop = props[field];
    if (!prop) { error(where, `foreign key field "${field}" is not one of the class' own properties`); continue; }
    if (field === "_id") { error(where, "_id is the record's own id and can't be a foreign key"); continue; }
    const shape = foreignKeyShape(prop);
    if (!shape) error(where, `foreign key field "${field}" can't hold ids: use a string, an array of strings, or a dictionary of strings`);
    else if (shape === "dictionary" && !part) error(where, `foreign key field "${field}" is a dictionary: set dictionaryPart to "key" (its keys are the ids) or "value"`);
    else if (shape !== "dictionary" && part) error(where, `foreign key field "${field}" is not a dictionary of strings: leave dictionaryPart out`);

    const target = fk.referenceObjectType === cls.fullObjectType ? cls : byName.get(fk.referenceObjectType);
    if (!fk.referenceObjectType) continue;
    if (!target) {
      if (fk.referenceObjectType.startsWith("app.")) warn(where, `foreign key target ${fk.referenceObjectType} has no local manifest; it must already exist on the server`);
    } else if (target.type === "Embedded") {
      error(where, `foreign key "${field}" points at ${fk.referenceObjectType}, an embedded class; only top-level classes can be referenced`);
    } else if (fk.referenceFieldName && fk.referenceFieldName !== "_id" && !propsOf(target)[fk.referenceFieldName]) {
      error(where, `foreign key "${field}" points at ${fk.referenceObjectType}.${fk.referenceFieldName}, which is not one of its properties`);
    }
    if (cls.type === "TopLevel" && shape !== "dictionary" && !(cls.indexedFields ?? []).includes(field)) warn(where, `reference field "${field}" is usually worth indexing`);
  }

  // ids left as plain strings: the server stores them as text with no link to the class they point at
  for (const [field, prop] of Object.entries(cls.schema?.properties ?? {})) {
    if (field === "_id" || declared.has(field)) continue;
    const isId = (prop?.type === "string" && prop.format === "uuid" && field.endsWith("Id")) ||
      (prop?.type === "array" && prop.items?.type === "string" && prop.items.format === "uuid" && field.endsWith("Ids"));
    if (isId) warn(where, `"${field}" looks like it holds ids of another class; if it does, add it to foreignKeys so it becomes a reference field (user ids stay plain)`);
  }
}

// Classes a class needs registered before it: its base class, the classes it embeds by $ref, and the classes its foreign keys point at.
function classDependencies(cls) {
  const deps = schemaRefs(cls.schema)
    .filter(({ ref }) => ref.startsWith(REF_PREFIX))
    .map(({ ref }) => ref.slice(REF_PREFIX.length));
  if (cls.baseObjectType) deps.push(cls.baseObjectType);
  for (const fk of cls.foreignKeys ?? []) if (fk.referenceObjectType && fk.referenceObjectType !== cls.fullObjectType) deps.push(fk.referenceObjectType);
  return deps;
}

function checkSchemaNode(node, path, where, error, warn, isRoot = false) {
  if (!node || typeof node !== "object") return;
  // A $ref points at another manifest; its docs and shape are checked there. title/description next to it label the field.
  if (node.$ref) return;
  if ((node.anyOf?.length ?? 0) > 1 || (node.oneOf?.length ?? 0) > 1) error(where, `${path}: anyOf/oneOf with several branches is not supported`);
  if (["byte", "binary"].includes(node.format)) error(where, `${path}: format ${node.format} is not supported`);
  // Root and properties feed the OpenAPI surface directly, so missing docs there are errors.
  const documented = isRoot || path.split(".").at(-2) === "properties";
  if (!node.title) (documented ? error : warn)(where, `${path}: title is required`);
  if (!node.description) (documented ? error : warn)(where, `${path}: description is required`);
  if (documented && node.examples === undefined && node.example === undefined) warn(where, `${path}: add examples`);
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    checkSchemaNode(child, `${path}.properties.${key}`, where, error, warn);
  }
  if (node.items && typeof node.items === "object" && node.items.type === "object") {
    checkSchemaNode(node.items, `${path}.items`, where, error, warn);
  }
  if (node.additionalProperties && typeof node.additionalProperties === "object" && node.additionalProperties.type === "object") {
    checkSchemaNode(node.additionalProperties, `${path}.additionalProperties`, where, error, warn);
  }
}

// ---------------------------------------------------------------- diff

function diff(state) {
  const items = [];
  const { ledger } = state;
  if (state.app && !state.app.$error) {
    items.push({ kind: "app", name: state.app.name, state: ledger.app?.name === state.app.name ? "applied" : "new" });
  }
  for (const { data } of state.classes) {
    if (data.$error || !data.fullObjectType) continue;
    const prev = ledger.classes[data.fullObjectType];
    items.push({ kind: "class", name: data.fullObjectType, hash: hashJson(data), state: !prev ? "new" : prev.hash === hashJson(data) ? "applied" : "changed" });
  }
  for (const { data } of state.actions) {
    if (data.$error || !data.actionName) continue;
    const prev = ledger.actions[data.actionName];
    const h = hashJson(actionArgs(data));
    items.push({ kind: "action", name: data.actionName, hash: h, state: !prev ? "new" : prev.hash === h ? "applied" : "changed" });
  }
  for (const script of state.scripts) {
    const prev = ledger.scripts[script.name];
    const action = state.actions.find((a) => !a.data.$error && a.data.actionName === script.name)?.data;
    const h = scriptHash(script.text, action);
    items.push({ kind: "script", name: script.name, hash: h, state: !prev ? "new" : prev.hash === h ? "applied" : "changed" });
  }
  for (const shared of state.shared) {
    const prev = ledger.sharedScripts[shared.name];
    const h = sharedHash(shared);
    items.push({ kind: "shared-script", name: shared.name, hash: h, state: !prev ? "new" : prev.hash === h ? "applied" : "changed" });
  }
  for (const event of state.events) {
    if (!event.fullObjectType) continue;
    const prev = ledger.eventScripts[event.name];
    const h = hash(event.text);
    items.push({ kind: "event-script", name: event.name, hash: h, state: !prev ? "new" : prev.hash === h ? "applied" : "changed" });
  }
  // a class event script whose file was deleted is removed from the server too
  for (const name of Object.keys(ledger.eventScripts)) {
    if (!state.events.some((e) => e.name === name)) items.push({ kind: "event-script", name, state: "removed" });
  }
  const manifestItem = (kind, name, data, prev) => ({ kind, name, hash: hashJson(data), state: !prev ? "new" : prev.hash === hashJson(data) ? "applied" : "changed" });
  for (const { data } of state.profiles) {
    if (data.$error || !data.profileName) continue;
    items.push(manifestItem("profile", data.profileName, data, ledger.profiles[data.profileName]));
  }
  // Replacing a class can add fields the profile has no entry for (hidden), so access is applied again
  // whenever its class changed since the access was applied (the ledger keeps the class hash it was applied against).
  const changedClasses = new Set(items.filter((i) => i.kind === "class" && i.state === "changed").map((i) => i.name));
  for (const { data } of state.access) {
    if (data.$error || !data.profileName || !data.fullObjectType) continue;
    const prev = ledger.access[accessName(data)];
    const item = manifestItem("access", accessName(data), data, prev);
    const classMoved = changedClasses.has(data.fullObjectType) || prev?.classHash !== ledger.classes[data.fullObjectType]?.hash;
    if (item.state === "applied" && classMoved) item.state = "recheck";
    items.push(item);
  }
  for (const { data } of state.actionAccess) {
    if (data.$error || !data.actionName) continue;
    items.push(manifestItem("action-access", data.actionName, data, ledger.actionAccess[data.actionName]));
  }
  for (const { data } of state.webhooks) {
    if (data.$error || !data.name) continue;
    items.push(manifestItem("webhook", data.name, data, ledger.webhooks[data.name]));
  }
  // a webhook whose manifest was deleted is removed from the server too (its event class and events stay)
  for (const name of Object.keys(ledger.webhooks)) {
    if (!state.webhooks.some((w) => !w.data.$error && w.data.name === name)) items.push({ kind: "webhook", name, state: "removed" });
  }
  for (const { data } of state.network) {
    if (data.$error || !data.name) continue;
    items.push({ ...manifestItem("network-policy", data.name, data, ledger.networkPolicies[data.name]), scripts: data.scripts ?? [] });
  }
  // a policy whose file was deleted: its scripts lose their network access (there is no tool to delete the policy itself)
  for (const name of Object.keys(ledger.networkPolicies)) {
    if (!state.network.some((n) => n.data.name === name)) items.push({ kind: "network-policy", name, state: "removed", scripts: [] });
  }
  if (state.auth && !state.auth.data.$error) items.push(manifestItem("auth", "auth", state.auth.data, ledger.auth));
  return items;
}

function plan(state) {
  const items = diff(state);
  const appName = state.app?.name;
  const calls = [];
  const blocked = [];
  const app = items.find((i) => i.kind === "app");
  if (app?.state === "new") {
    calls.push({ tool: "init_app", record: ["app", appName], args: { appName, appTitle: state.app.title, appDescription: state.app.description } });
  }
  const pending = (kind) => items.filter((i) => i.kind === kind && i.state !== "applied");
  for (const item of profileOrder(pending("profile"), state)) {
    const { profileName, description, inheritsFrom } = strip(state.profiles.find((p) => p.data.profileName === item.name).data);
    calls.push({ tool: item.state === "new" ? "add_profile" : "replace_profile", record: ["profile", item.name], args: { appName, profileName, description, ...(inheritsFrom?.length ? { inheritsFrom } : {}) } });
  }
  // a foreign key's target must exist on the server first; classes that point at each other are added
  // without the foreign keys to the ones not added yet, and replaced with them once every class exists
  const classItems = items.filter((i) => i.kind === "class");
  const newClasses = new Set(classItems.filter((i) => i.state === "new").map((i) => i.name));
  const onServer = new Set();
  const deferred = [];
  for (const item of dependencyOrder(classItems, state)) {
    const { data } = state.classes.find((c) => c.data.fullObjectType === item.name);
    if (item.state === "new" || item.state === "changed") {
      const { fullObjectType, type, baseObjectType, discriminatorField, discriminatorValue, indexedFields, foreignKeys, schema, isFullTextSearchable } = strip(data);
      const args = (fks) => ({ appName, fullObjectType, type, ...(baseObjectType ? { baseObjectType } : {}), ...(discriminatorField ? { discriminatorField } : {}), ...(discriminatorValue ? { discriminatorValue } : {}), indexedFields, ...(fks?.length ? { foreignKeys: fks } : {}), schema, ...(typeof isFullTextSearchable === "boolean" ? { isFullTextSearchable } : {}) });
      const pendingTarget = (fk) => fk.referenceObjectType !== fullObjectType && newClasses.has(fk.referenceObjectType) && !onServer.has(fk.referenceObjectType);
      const waiting = (foreignKeys ?? []).filter(pendingTarget);
      if (!waiting.length) {
        calls.push({ tool: item.state === "new" ? "add_object_class" : "replace_object_class", record: ["class", item.name], args: args(foreignKeys) });
      } else if (item.state === "new") {
        const targets = [...new Set(waiting.map((fk) => fk.referenceObjectType))].join(", ");
        calls.push({ tool: "add_object_class", record: null, note: `without its foreign keys to ${targets} (not added yet); don't record it, the replace_object_class further down adds them and is recorded`, args: args((foreignKeys ?? []).filter((fk) => !pendingTarget(fk))) });
        deferred.push({ tool: "replace_object_class", record: ["class", item.name], args: args(foreignKeys) });
      } else {
        deferred.push({ tool: "replace_object_class", record: ["class", item.name], args: args(foreignKeys) });
      }
    }
    onServer.add(item.name);
  }
  calls.push(...deferred);
  for (const item of pending("access")) {
    const { data } = state.access.find((a) => accessName(a.data) === item.name);
    calls.push({ tool: "replace_class_access", record: ["access", item.name], args: strip(data) });
  }
  const registered = new Set();
  for (const item of items.filter((i) => i.kind === "action")) {
    const { data } = state.actions.find((a) => a.data.actionName === item.name);
    if (item.state === "new" || item.state === "changed") {
      calls.push({ tool: item.state === "new" ? "register_action" : "replace_action", record: ["action", item.name], args: actionArgs(data) });
    }
    registered.add(item.name);
  }
  for (const item of pending("action-access")) {
    const { data } = state.actionAccess.find((a) => a.data.actionName === item.name);
    calls.push({ tool: "replace_action_access", record: ["action-access", item.name], args: strip(data) });
  }
  // shared scripts before the scripts that call them: a script is checked against what the server has when it is saved
  for (const item of sharedOrder(pending("shared-script"), state)) {
    const shared = state.shared.find((s) => s.name === item.name);
    if (!shared.data || shared.data.$error || shared.text === null) {
      blocked.push({ kind: "shared-script", name: item.name, reason: shared.text === null ? `no script (shared/${item.name}.ts)` : `no manifest (shared/${item.name}.json)` });
      continue;
    }
    const { scriptName, description, inputObjectType, outputObjectType, profiles } = strip(shared.data);
    calls.push({
      tool: "replace_script",
      record: ["shared-script", item.name],
      ...(item.state === "changed" ? { note: "if its classes changed, run validate_action_scripts afterwards to find the callers it broke" } : {}),
      args: { appName, scriptName, script: `<contents of ${join(dir, "shared", `${item.name}.ts`)}>`, description, ...(inputObjectType ? { inputObjectType } : {}), ...(outputObjectType ? { outputObjectType } : {}), ...(profiles?.length ? { profiles } : {}) },
    });
  }
  for (const item of items.filter((i) => i.kind === "script" && i.state !== "applied")) {
    const action = state.actions.find((a) => a.data.actionName === item.name)?.data;
    if (!action || !registered.has(item.name)) {
      blocked.push({ kind: "script", name: item.name, reason: "no action manifest for this script" });
      continue;
    }
    calls.push({ tool: "replace_action_script", record: ["script", item.name], args: { fullObjectType: action.fullObjectType, actionName: item.name, actionScript: `<contents of ${join(dir, "scripts", `${item.name}.ts`)}>`, elevated: action.elevated === true } });
  }
  // after the body classes, before the event scripts: replace_webhook makes the event class a script runs on
  for (const item of pending("webhook")) {
    if (item.state === "removed") {
      calls.push({ tool: "remove_webhook", record: ["webhook", item.name], args: { appName, name: item.name } });
      continue;
    }
    const args = { appName, ...strip(state.webhooks.find((w) => w.data.name === item.name).data) };
    const env = [...new Set((args.auth ?? []).flatMap((step) => WEBHOOK_SECRETS.map((f) => ENV_VALUE.exec(step?.[f] ?? "")?.groups.name).filter(Boolean)))];
    calls.push({
      tool: "replace_webhook",
      record: ["webhook", item.name],
      ...(env.length ? { note: `replace \${env:...} with the values of ${env.join(", ")} from .env; never print them` } : {}),
      args,
    });
  }
  for (const item of pending("event-script")) {
    const { cls, event, script } = EVENT_FILE.exec(item.name).groups;
    const args = { fullObjectType: cls, classEvent: CLASS_EVENTS[event], scriptName: script };
    if (item.state === "removed") {
      calls.push({ tool: "remove_class_event_script", record: ["event-script", item.name], args });
      continue;
    }
    calls.push({ tool: "replace_class_event_script", record: ["event-script", item.name], args: { ...args, script: `<contents of ${join(dir, "events", `${item.name}.ts`)}>` } });
  }
  // after the scripts: a script has to exist to be pointed at a policy (replacing a script keeps its policy)
  const listed = new Set(state.network.flatMap((n) => (n.data.$error ? [] : n.data.scripts ?? [])));
  for (const item of pending("network-policy")) {
    const group = [];
    if (item.state !== "removed") {
      const { name, description, rules } = strip(state.network.find((n) => n.data.name === item.name).data);
      const id = state.ledger.networkPolicies[item.name]?.id;
      group.push({ tool: "replace_network_policy", args: { appName, name, rules, ...(description ? { description } : {}), ...(id ? { id } : {}) } });
      for (const script of item.scripts) group.push({ tool: "set_script_network_policy", args: { appName, script, networkPolicyId: POLICY_ID } });
    }
    // scripts it no longer lists (and no other policy does) lose their network access
    for (const script of state.ledger.networkPolicies[item.name]?.scripts ?? []) {
      if (!item.scripts.includes(script) && !listed.has(script)) group.push({ tool: "set_script_network_policy", args: { appName, script, networkPolicyId: "" } });
    }
    if (!group.length) group.push({ tool: "(none)", args: {}, note: "nothing to call on the server; record it" });
    const recordNote = item.state === "removed" ? undefined : `record with --id ${POLICY_ID}`;
    group.forEach((call, i) => {
      const last = i === group.length - 1;
      const note = last ? recordNote : `part of network policy ${item.name}; recorded with its last call`;
      calls.push({ ...call, record: last ? ["network-policy", item.name] : null, ...(note ? { note } : {}) });
    });
  }
  for (const item of pending("auth")) {
    calls.push({ tool: "replace_app_auth", record: ["auth", "auth"], args: { appName, ...strip(state.auth.data) } });
  }
  return { calls, blocked };
}

// Profiles a profile inherits from go first.
function profileOrder(profileItems, state) {
  const byName = new Map(profileItems.map((i) => [i.name, i]));
  const ordered = [];
  const seen = new Set();
  const visit = (item) => {
    if (seen.has(item.name)) return;
    seen.add(item.name);
    const data = state.profiles.find((p) => p.data.profileName === item.name)?.data;
    for (const parent of data?.inheritsFrom ?? []) if (byName.has(parent)) visit(byName.get(parent));
    ordered.push(item);
  };
  profileItems.forEach(visit);
  return ordered;
}

// Shared scripts another one calls go first (scripts that call each other can't both be new: save one without the call first).
function sharedOrder(sharedItems, state) {
  const byName = new Map(sharedItems.map((i) => [i.name, i]));
  const ordered = [];
  const visiting = new Set();
  const done = new Set();
  const visit = (item) => {
    if (done.has(item.name) || visiting.has(item.name)) return;
    visiting.add(item.name);
    const text = state.shared.find((s) => s.name === item.name)?.text;
    for (const dep of sharedCalls(text, state.app?.name)) if (dep !== item.name && byName.has(dep)) visit(byName.get(dep));
    visiting.delete(item.name);
    done.add(item.name);
    ordered.push(item);
  };
  sharedItems.forEach(visit);
  return ordered;
}

// Base classes and $ref'd embedded classes go before the classes that use them.
function dependencyOrder(classItems, state) {
  const byName = new Map(classItems.map((i) => [i.name, i]));
  const ordered = [];
  const visiting = new Set();
  const done = new Set();
  const visit = (item) => {
    if (done.has(item.name) || visiting.has(item.name)) return;
    visiting.add(item.name);
    const data = state.classes.find((c) => c.data.fullObjectType === item.name)?.data;
    for (const dep of data ? classDependencies(data) : []) if (byName.has(dep)) visit(byName.get(dep));
    visiting.delete(item.name);
    done.add(item.name);
    ordered.push(item);
  };
  classItems.forEach(visit);
  return ordered;
}

function record(state, kind, names) {
  const { ledger } = state;
  const now = new Date().toISOString();
  const items = diff(state);
  for (const name of names) {
    if (kind === "app") {
      ledger.app = { name, appliedAt: now };
      continue;
    }
    const item = items.find((i) => i.kind === kind && i.name === name);
    if (!item) fail(`no local ${kind} named ${name}`);
    if (kind === "auth") ledger.auth = { hash: item.hash, appliedAt: now };
    else if (item.state === "removed") delete ledger[KINDS[kind]][name];
    else if (kind === "access") ledger.access[name] = { hash: item.hash, classHash: ledger.classes[name.slice(name.indexOf("/") + 1)]?.hash, appliedAt: now };
    else if (kind === "network-policy") {
      // the id can change: a change to an active policy is saved as a new one
      if (!recordedId) fail(`record network-policy ${name} --id <id replace_network_policy returned>`);
      ledger.networkPolicies[name] = { id: recordedId, hash: item.hash, scripts: item.scripts, appliedAt: now };
    }
    else ledger[KINDS[kind]][name] = { hash: item.hash, appliedAt: now };
  }
  const ordered = {
    app: ledger.app, profiles: ledger.profiles, classes: ledger.classes, access: ledger.access,
    actions: ledger.actions, actionAccess: ledger.actionAccess, sharedScripts: ledger.sharedScripts, scripts: ledger.scripts, eventScripts: ledger.eventScripts, networkPolicies: ledger.networkPolicies, webhooks: ledger.webhooks, ...(ledger.auth ? { auth: ledger.auth } : {}),
  };
  writeFileSync(state.ledgerPath, `${JSON.stringify(ordered, null, 2)}\n`);
  console.log(`recorded ${kind}: ${names.join(", ")}`);
}

// ---------------------------------------------------------------- output

function printProblems(problems) {
  if (!problems.length) { console.log("Manifests: no problems found."); return; }
  const errors = problems.filter((p) => p.level === "error").length;
  console.log(`Manifests: ${errors} error(s), ${problems.length - errors} warning(s)`);
  for (const p of problems) console.log(`  ${p.level === "error" ? "ERROR" : "warn "} ${p.where}: ${p.message}`);
}

const state = load();
if (!state) {
  if (command === "status") {
    console.log(`No ${dir}/ folder here. This is either a new app or an existing app not yet on BootstrApp.`);
    process.exit(0);
  }
  fail(`no ${dir}/ folder found (pass --dir <path>)`);
}

switch (command) {
  case "status": {
    const items = diff(state);
    const problems = check(state);
    if (asJson) { console.log(JSON.stringify({ app: state.app, items, problems }, null, 2)); break; }
    console.log(`App: ${state.app?.name ?? "(no app.json)"}${state.app?.title ? ` (${state.app.title})` : ""}`);
    const generated = ["platform.d.ts", "openapi.yaml"].map((f) => `${f}: ${existsSync(join(dir, "generated", f)) ? "present" : "missing"}`);
    console.log(`Generated: ${generated.join(", ")}`);
    const titles = { profile: "Profiles", class: "Classes", access: "Class access (profile/class)", action: "Actions", "action-access": "Action access", "shared-script": "Shared scripts", script: "Action scripts", "event-script": "Class event scripts", "network-policy": "Network policies", webhook: "Webhooks", auth: "Sign-in (auth.json)" };
    for (const kind of Object.keys(titles)) {
      const group = items.filter((i) => i.kind === kind);
      if (!group.length) continue;
      console.log(`\n${titles[kind]}:`);
      for (const i of group) console.log(`  ${i.state.padEnd(8)} ${i.name}`);
    }
    const app = items.find((i) => i.kind === "app");
    if (app) console.log(`\nApp initialized on backend: ${app.state === "applied" ? "yes" : "not recorded"}`);
    console.log("");
    printProblems(problems);
    break;
  }
  case "check": {
    const problems = check(state);
    if (asJson) console.log(JSON.stringify(problems, null, 2));
    else printProblems(problems);
    process.exit(problems.some((p) => p.level === "error") ? 1 : 0);
  }
  case "plan": {
    const result = plan(state);
    if (!summary) { console.log(JSON.stringify(result, null, 2)); break; }
    for (const c of result.calls) console.log(`${c.tool.padEnd(22)} ${c.args?.script ? `${c.args.script} -> ${c.args.networkPolicyId || "no policy"}` : c.record?.[1] ?? c.args?.fullObjectType ?? ""}${c.note ? ` (${c.note})` : ""}`);
    for (const b of result.blocked) console.log(`BLOCKED ${b.kind} ${b.name}: ${b.reason}`);
    if (!result.calls.length && !result.blocked.length) console.log("Nothing to apply.");
    break;
  }
  case "record": {
    const [kind, ...names] = positional;
    if (!(kind in KINDS) || !names.length) fail(`usage: record <${Object.keys(KINDS).join("|")}> <name...>`);
    record(state, kind, names);
    break;
  }
  default:
    fail(`unknown command ${command} (status | check | plan | record)`);
}
