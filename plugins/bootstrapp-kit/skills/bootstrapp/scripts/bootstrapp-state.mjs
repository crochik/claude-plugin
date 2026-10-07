#!/usr/bin/env node
// Inspect a bootstrapp/ folder: validate manifests, compare them with the
// applied.json ledger, print the MCP calls a sync needs, and record applied items.
//
// Usage:
//   node bootstrapp-state.mjs status            [--dir bootstrapp] [--json]
//   node bootstrapp-state.mjs check             [--dir bootstrapp] [--json]
//   node bootstrapp-state.mjs plan              [--dir bootstrapp] [--summary]
//   node bootstrapp-state.mjs record <kind> <name...> [--dir bootstrapp]
//        kind: app | class | action | script
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

// Drop human-only "$" keys, then serialize with sorted keys so formatting
// changes don't count as changes.
function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (!key.startsWith("$")) out[key] = strip(value[key]);
    }
    return out;
  }
  return value;
}

const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const hashJson = (value) => hash(JSON.stringify(strip(value)));

function load() {
  if (!existsSync(dir)) return null;
  const app = existsSync(join(dir, "app.json")) ? readJson(join(dir, "app.json")) : null;
  const classes = listFiles("classes", ".json").map((file) => ({ file, data: readJson(file) }));
  const actions = listFiles("actions", ".json").map((file) => ({ file, data: readJson(file) }));
  const scripts = listFiles("scripts", ".ts").map((file) => ({ file, name: basename(file, ".ts"), text: readFileSync(file, "utf8") }));
  const ledgerPath = join(dir, "applied.json");
  const ledger = existsSync(ledgerPath) ? readJson(ledgerPath) : {};
  for (const key of ["classes", "actions", "scripts"]) ledger[key] ??= {};
  return { app, classes, actions, scripts, ledger, ledgerPath };
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

    if (!["TopLevel", "Embedded"].includes(cls.type)) error(where, `type must be TopLevel or Embedded, got ${cls.type}`);
    if (!Array.isArray(cls.indexedFields)) error(where, "indexedFields is required (use [] for embedded classes)");
    if (cls.baseObjectType && root && !cls.baseObjectType.startsWith(`${root}.`)) error(where, `baseObjectType must live under ${root}`);
    if (cls.baseObjectType && !byName.has(cls.baseObjectType)) warn(where, `base class ${cls.baseObjectType} has no local manifest`);

    const schema = cls.schema;
    if (!schema || typeof schema !== "object") { error(where, "schema is required"); continue; }
    if (schema.type !== "object" && !schema.allOf) error(where, 'schema.type must be "object"');
    checkSchemaNode(schema, "schema", where, error, warn, true);

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

  return problems;
}

function checkSchemaNode(node, path, where, error, warn, isRoot = false) {
  if (!node || typeof node !== "object") return;
  if (node.$ref) error(where, `${path}: $ref is not resolved by add_object_class; inline the shape`);
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
    items.push({ kind: "action", name: data.actionName, hash: hashJson(data), state: !prev ? "new" : prev.hash === hashJson(data) ? "applied" : "changed" });
  }
  for (const script of state.scripts) {
    const prev = ledger.scripts[script.name];
    items.push({ kind: "script", name: script.name, hash: hash(script.text), state: !prev ? "new" : prev.hash === hash(script.text) ? "applied" : "changed" });
  }
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
  for (const item of items.filter((i) => i.kind === "class")) {
    const { data } = state.classes.find((c) => c.data.fullObjectType === item.name);
    if (item.state === "new") {
      const { fullObjectType, type, baseObjectType, indexedFields, foreignKeys, schema } = strip(data);
      calls.push({ tool: "add_object_class", record: ["class", item.name], args: { appName, fullObjectType, type, ...(baseObjectType ? { baseObjectType } : {}), indexedFields, ...(foreignKeys?.length ? { foreignKeys } : {}), schema } });
    } else if (item.state === "changed") {
      blocked.push({ kind: "class", name: item.name, reason: "already registered; MCP cannot update classes" });
    }
  }
  const registered = new Set();
  for (const item of items.filter((i) => i.kind === "action")) {
    const { data } = state.actions.find((a) => a.data.actionName === item.name);
    if (item.state === "new") {
      calls.push({ tool: "register_action", record: ["action", item.name], args: strip(data) });
    } else if (item.state === "changed") {
      blocked.push({ kind: "action", name: item.name, reason: "already registered; registering again creates a duplicate" });
    }
    registered.add(item.name);
  }
  for (const item of items.filter((i) => i.kind === "script" && i.state !== "applied")) {
    const action = state.actions.find((a) => a.data.actionName === item.name)?.data;
    if (!action || !registered.has(item.name)) {
      blocked.push({ kind: "script", name: item.name, reason: "no action manifest for this script" });
      continue;
    }
    calls.push({ tool: "update_action_script", record: ["script", item.name], args: { fullObjectType: action.fullObjectType, actionName: item.name, actionScript: `<contents of ${join(dir, "scripts", `${item.name}.ts`)}>` } });
  }
  return { calls, blocked };
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
    const key = { class: "classes", action: "actions", script: "scripts" }[kind];
    ledger[key][name] = { hash: item.hash, appliedAt: now };
  }
  const ordered = { app: ledger.app, classes: ledger.classes, actions: ledger.actions, scripts: ledger.scripts };
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
    for (const kind of ["app", "class", "action", "script"]) {
      const group = items.filter((i) => i.kind === kind && kind !== "app");
      if (!group.length) continue;
      console.log(`\n${kind === "class" ? "Classes" : `${kind[0].toUpperCase()}${kind.slice(1)}s`}:`);
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
    if (!["app", "class", "action", "script"].includes(kind) || !names.length) fail("usage: record <app|class|action|script> <name...>");
    record(state, kind, names);
    break;
  }
  default:
    fail(`unknown command ${command} (status | check | plan | record)`);
}
