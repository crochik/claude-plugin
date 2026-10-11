#!/usr/bin/env node
// Inspect a bootstrapp/ folder: validate manifests, compare them with the
// applied.json ledger, print the MCP calls a sync needs, and record applied items.
//
// Usage:
//   node bootstrapp-state.mjs status            [--dir bootstrapp] [--json]
//   node bootstrapp-state.mjs check             [--dir bootstrapp] [--json]
//   node bootstrapp-state.mjs plan              [--dir bootstrapp] [--summary]
//   node bootstrapp-state.mjs record <kind> <name...> [--dir bootstrapp]
//        kind: app | profile | class | access | action | action-access | script | auth
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
const positional = args.slice(1).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--dir");

const SNAKE = /^[a-z][a-z0-9_]*$/;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const CAMEL = /^[a-z][A-Za-z0-9]*$/;
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
const KINDS = { app: null, profile: "profiles", class: "classes", access: "access", action: "actions", "action-access": "actionAccess", script: "scripts", auth: null };

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

function load() {
  if (!existsSync(dir)) return null;
  const app = existsSync(join(dir, "app.json")) ? readJson(join(dir, "app.json")) : null;
  const classes = listFiles("classes", ".json").map((file) => ({ file, data: readJson(file) }));
  const actions = listFiles("actions", ".json").map((file) => ({ file, data: readJson(file) }));
  const scripts = listFiles("scripts", ".ts").map((file) => ({ file, name: basename(file, ".ts"), text: readFileSync(file, "utf8") }));
  const profiles = listFiles("profiles", ".json").map((file) => ({ file, data: readJson(file) }));
  // access/<profileName>/<fullObjectType>.json, and access/actions/<actionName>.json
  const accessDir = join(dir, "access");
  const profileDirs = existsSync(accessDir)
    ? readdirSync(accessDir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "actions").map((d) => d.name).sort()
    : [];
  const access = profileDirs.flatMap((folder) => listFiles(join("access", folder), ".json").map((file) => ({ file, folder, data: readJson(file) })));
  const actionAccess = listFiles(join("access", "actions"), ".json").map((file) => ({ file, data: readJson(file) }));
  const auth = existsSync(join(dir, "auth.json")) ? { file: join(dir, "auth.json"), data: readJson(join(dir, "auth.json")) } : null;
  const ledgerPath = join(dir, "applied.json");
  const ledger = existsSync(ledgerPath) ? readJson(ledgerPath) : {};
  for (const key of ["profiles", "classes", "access", "actions", "actionAccess", "scripts"]) ledger[key] ??= {};
  return { app, classes, actions, scripts, profiles, access, actionAccess, auth, ledger, ledgerPath };
}

const accessName = (data) => `${data.profileName}/${data.fullObjectType}`;

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

    if (!["TopLevel", "Embedded"].includes(cls.type)) error(where, `type must be TopLevel or Embedded, got ${cls.type}`);
    if (!Array.isArray(cls.indexedFields)) error(where, "indexedFields is required (use [] for embedded classes)");
    if (cls.baseObjectType && root && !cls.baseObjectType.startsWith(`${root}.`)) error(where, `baseObjectType must live under ${root}`);
    if (cls.baseObjectType && !byName.has(cls.baseObjectType)) warn(where, `base class ${cls.baseObjectType} has no local manifest`);

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
      if (root && ns !== root) warn(where, `top-level class outside ${root}; actions on it may not run (see platform notes)`);
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
    for (const fk of cls.foreignKeys ?? []) {
      if (!props[fk.localFieldName]) error(where, `foreign key field "${fk.localFieldName}" is not a property`);
      if (!fk.referenceObjectType || !fk.referenceFieldName) error(where, "foreign keys need referenceObjectType and referenceFieldName");
      else if (fk.referenceObjectType.startsWith("app.") && !byName.has(fk.referenceObjectType)) warn(where, `foreign key target ${fk.referenceObjectType} has no local manifest`);
      if (cls.type === "TopLevel" && !(cls.indexedFields ?? []).includes(fk.localFieldName)) warn(where, `reference field "${fk.localFieldName}" is usually worth indexing`);
    }
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

  checkAccess(state, byName, propsOf, error, warn);

  return problems;
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

  for (const { file, folder, data } of state.access) {
    const where = `access/${folder}/${basename(file)}`;
    if (data.$error) { error(where, data.$error); continue; }
    if (!data.fullObjectType || !data.profileName) { error(where, "fullObjectType and profileName are required"); continue; }
    if (data.profileName !== folder) error(where, `profileName "${data.profileName}" doesn't match its folder ${folder}`);
    if (basename(file) !== `${data.fullObjectType}.json`) warn(where, `file name should be ${data.fullObjectType}.json`);
    if (data.profileName.toLowerCase() === DEFAULT_PROFILE.toLowerCase()) { error(where, `${DEFAULT_PROFILE} always has full access and can't be restricted`); continue; }
    if (!knownProfile(data.profileName)) warn(where, `profile ${data.profileName} has no local manifest; it must already exist on the server`);

    const bad = badValues(data.permissions, CLASS_PERMISSIONS);
    if (!bad) error(where, "permissions is required (a list; [] removes the profile's access)");
    else if (bad.length) error(where, `unknown permissions ${bad.join(", ")}. Valid: ${CLASS_PERMISSIONS.join(", ")}`);
    const removing = Array.isArray(data.permissions) && data.permissions.length === 0;
    if (removing && (Object.keys(data.fieldPermissions ?? {}).length || Object.keys(data.relationPermissions ?? {}).length || data.constraints?.length)) {
      error(where, "permissions [] removes access; don't combine it with field, relation or constraint settings");
    }

    const cls = byName.get(data.fullObjectType);
    if (!cls) warn(where, `class ${data.fullObjectType} has no local manifest; fields and constraints can't be checked`);
    const own = cls?.schema?.properties ?? {};
    const all = cls ? propsOf(cls) : {};

    for (const [field, values] of Object.entries(data.fieldPermissions ?? {})) {
      if (cls && !own[field]) error(where, all[field] ? `field ${field} is inherited from ${cls.baseObjectType}: set its access there` : `${data.fullObjectType} has no field ${field}`);
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

    if (data.constraints !== undefined && !Array.isArray(data.constraints)) { error(where, "constraints must be a list"); continue; }
    if (data.constraints?.length && cls?.type === "Embedded") error(where, "constraints only apply to top-level classes");
    for (const [i, c] of (data.constraints ?? []).entries()) {
      const at = `constraints[${i}]`;
      if (!c?.fieldName || !c.operator) { error(where, `${at}: fieldName and operator are required`); continue; }
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

  const actionsByName = new Map(state.actions.filter((a) => !a.data.$error).map((a) => [a.data.actionName, a.data]));
  for (const { file, data } of state.actionAccess) {
    const where = `access/actions/${basename(file)}`;
    if (data.$error) { error(where, data.$error); continue; }
    if (!data.fullObjectType || !data.actionName) { error(where, "fullObjectType and actionName are required"); continue; }
    if (basename(file) !== `${data.actionName}.json`) warn(where, `file name should be ${data.actionName}.json`);
    const action = actionsByName.get(data.actionName);
    if (!action) warn(where, `action ${data.actionName} has no local manifest; it must already be registered`);
    else if (action.fullObjectType !== data.fullObjectType) error(where, `${data.actionName} is registered on ${action.fullObjectType}, not ${data.fullObjectType}`);
    if (!Array.isArray(data.profiles)) { error(where, "profiles is required (a list; [] leaves only the default profile)"); continue; }
    for (const p of data.profiles) {
      if (p.toLowerCase() === DEFAULT_PROFILE.toLowerCase()) warn(where, `${DEFAULT_PROFILE} always runs every action; no need to list it`);
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

// Classes a class needs registered before it: its base class and the classes it embeds by $ref.
function classDependencies(cls) {
  const deps = schemaRefs(cls.schema)
    .filter(({ ref }) => ref.startsWith(REF_PREFIX))
    .map(({ ref }) => ref.slice(REF_PREFIX.length));
  if (cls.baseObjectType) deps.push(cls.baseObjectType);
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
  for (const item of dependencyOrder(items.filter((i) => i.kind === "class"), state)) {
    const { data } = state.classes.find((c) => c.data.fullObjectType === item.name);
    if (item.state === "new" || item.state === "changed") {
      const { fullObjectType, type, baseObjectType, indexedFields, foreignKeys, schema, isFullTextSearchable } = strip(data);
      const tool = item.state === "new" ? "add_object_class" : "replace_object_class";
      calls.push({ tool, record: ["class", item.name], args: { appName, fullObjectType, type, ...(baseObjectType ? { baseObjectType } : {}), indexedFields, ...(foreignKeys?.length ? { foreignKeys } : {}), schema, ...(typeof isFullTextSearchable === "boolean" ? { isFullTextSearchable } : {}) } });
    }
  }
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
  for (const item of items.filter((i) => i.kind === "script" && i.state !== "applied")) {
    const action = state.actions.find((a) => a.data.actionName === item.name)?.data;
    if (!action || !registered.has(item.name)) {
      blocked.push({ kind: "script", name: item.name, reason: "no action manifest for this script" });
      continue;
    }
    calls.push({ tool: "replace_action_script", record: ["script", item.name], args: { fullObjectType: action.fullObjectType, actionName: item.name, actionScript: `<contents of ${join(dir, "scripts", `${item.name}.ts`)}>`, elevated: action.elevated === true } });
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
    else if (kind === "access") ledger.access[name] = { hash: item.hash, classHash: ledger.classes[name.slice(name.indexOf("/") + 1)]?.hash, appliedAt: now };
    else ledger[KINDS[kind]][name] = { hash: item.hash, appliedAt: now };
  }
  const ordered = {
    app: ledger.app, profiles: ledger.profiles, classes: ledger.classes, access: ledger.access,
    actions: ledger.actions, actionAccess: ledger.actionAccess, scripts: ledger.scripts, ...(ledger.auth ? { auth: ledger.auth } : {}),
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
    const titles = { profile: "Profiles", class: "Classes", access: "Class access (profile/class)", action: "Actions", "action-access": "Action access", script: "Scripts", auth: "Sign-in (auth.json)" };
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
    for (const c of result.calls) console.log(`${c.tool.padEnd(22)} ${c.record[1]}`);
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
