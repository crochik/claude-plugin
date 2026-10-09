#!/usr/bin/env node
// Lint ApiScript files against the published grammar subset and the app's
// generated platform.d.ts. Not a type checker: it catches the common mistakes
// (TypeScript features the dialect lacks, imports or functions the platform
// doesn't declare, filters on non-indexed fields, a script that never returns).
//
// Usage: node check-apiscript.mjs <script.ts...> [--dts <platform.d.ts>] [--classes <dir>]
// Defaults: --dts <script dir>/../generated/platform.d.ts, --classes <script dir>/../classes
// Exit code 1 when any error is found. Node 18+, no dependencies.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const files = argv.filter((a, i) => !a.startsWith("--") && !["--dts", "--classes"].includes(argv[i - 1]));
if (!files.length) {
  console.error("usage: check-apiscript.mjs <script.ts...> [--dts platform.d.ts] [--classes dir]");
  process.exit(2);
}

const BUILTIN_TYPES = new Set(["number", "string", "boolean", "any", "Record"]);

// Unsupported syntax, matched against code with comments and string contents removed.
const FORBIDDEN = [
  [/=>/, "arrow functions are not supported; declare a function"],
  [/\basync\b|\bawait\b/, "async/await is not supported; platform calls are synchronous"],
  [/\btry\b|\bcatch\b|\bfinally\b/, "try/catch is not supported; validate first and throw"],
  [/\bswitch\b|\bcase\b/, "switch is not in the published grammar; use if/else"],
  [/\bbreak\b|\bcontinue\b/, "break/continue are not in the published grammar; use a loop condition"],
  [/\bclass\b|\binterface\b|\benum\b|\btype\s+[A-Za-z_]\w*\s*=/, "class/interface/enum/type declarations are not supported"],
  [/\bnew\b/, "new is not supported"],
  [/\bvar\b/, "use const or let"],
  [/\bexport\b/, "export is not supported in scripts"],
  [/\?\./, "optional chaining is not supported; use x != null ? x.y : null"],
  [/===|!==/, "use == and !="],
  [/\+\+|--/, "++/-- are not supported; use i = i + 1"],
  [/[+\-*/%]=(?!=)/, "compound assignment is not supported; use x = x + y"],
  [/\bfor\s*\(\s*(const|let)\s+\w+\s+(of|in)\b/, "for…of / for…in are not in the published grammar; use an index loop"],
  [/\b(const|let)\s*[\[{]/, "destructuring is not supported"],
  [/\bundefined\b/, "undefined is not a literal; use null"],
  [/\btypeof\b|\binstanceof\b/, "typeof/instanceof are not supported"],
  [/:\s*(Array|Promise|Map|Set|Partial|Pick|Omit)\s*</, "only Record<string, T> generics are supported; use T[]"],
];

function stripCode(source) {
  // Replace comments and string contents with spaces, keeping line breaks so
  // line numbers survive. Backticks are reported separately.
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (c === "/" && n === "/") {
      while (i < source.length && source[i] !== "\n") { out += " "; i++; }
    } else if (c === "/" && n === "*") {
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) { out += source[i] === "\n" ? "\n" : " "; i++; }
      out += "  "; i += 2;
    } else if (c === '"' || c === "'") {
      out += c; i++;
      while (i < source.length && source[i] !== c && source[i] !== "\n") {
        if (source[i] === "\\") { out += " "; i++; }
        out += " "; i++;
      }
      out += c; i++;
    } else {
      out += c; i++;
    }
  }
  return out;
}

function parseDts(text) {
  // module name -> { functions:Set, types:Set }
  const modules = new Map();
  const globalTypes = new Set();
  const re = /declare\s+module\s+"([^"]+)"\s*\{/g;
  let m;
  let lastEnd = 0;
  const outside = [];
  while ((m = re.exec(text))) {
    outside.push(text.slice(lastEnd, m.index));
    let depth = 1;
    let j = re.lastIndex;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    const body = text.slice(re.lastIndex, j - 1);
    const mod = modules.get(m[1]) ?? { functions: new Set(), types: new Set() };
    for (const f of body.matchAll(/\bfunction\s+([A-Za-z_]\w*)\s*\(/g)) mod.functions.add(f[1]);
    for (const t of body.matchAll(/\b(?:interface|type|enum|class)\s+([A-Za-z_]\w*)/g)) mod.types.add(t[1]);
    modules.set(m[1], mod);
    lastEnd = j;
    re.lastIndex = j;
  }
  outside.push(text.slice(lastEnd));
  for (const t of outside.join("\n").matchAll(/\b(?:interface|type|enum|class)\s+([A-Za-z_]\w*)/g)) globalTypes.add(t[1]);
  return { modules, globalTypes };
}

function loadIndexes(classesDir) {
  // short class name -> indexedFields (top-level classes only)
  const map = new Map();
  if (!classesDir || !existsSync(classesDir)) return map;
  for (const f of readdirSync(classesDir).filter((x) => x.endsWith(".json"))) {
    try {
      const c = JSON.parse(readFileSync(join(classesDir, f), "utf8"));
      if (c.type === "TopLevel" && c.fullObjectType) map.set(c.fullObjectType.split(".").at(-1), c.indexedFields ?? []);
    } catch {
      // the state helper reports broken manifests
    }
  }
  return map;
}

function matchingParen(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) return i;
  }
  return code.length;
}

let errorCount = 0;
for (const file of files) {
  const problems = [];
  const report = (level, line, message) => problems.push({ level, line, message });
  const source = readFileSync(file, "utf8");
  const code = stripCode(source);
  const lineOf = (index) => code.slice(0, index).split("\n").length;
  const scriptDir = dirname(file);
  const dtsPath = opt("--dts") ?? join(scriptDir, "..", "generated", "platform.d.ts");
  const indexes = loadIndexes(opt("--classes") ?? join(scriptDir, "..", "classes"));

  if (source.includes("`")) report("error", lineOf(source.indexOf("`")), "template literals are not supported; concatenate with +");
  if (/^\s*```/m.test(source)) report("error", 1, "remove Markdown fences; the file must contain only the script");
  code.split("\n").forEach((text, i) => {
    for (const [re, message] of FORBIDDEN) if (re.test(text)) report("error", i + 1, message);
  });

  // imports
  const aliases = new Map();
  for (const im of code.matchAll(/^\s*import\b[^;]*;?/gm)) {
    const ok = /^\s*import\s+\*\s+as\s+([A-Za-z_]\w*)\s+from\s+["']([^"']+)["']\s*;/.exec(im[0]);
    const line = lineOf(im.index);
    if (!ok) { report("error", line, 'imports must look like: import * as alias from "namespace";'); continue; }
    const name = /from\s+["']([^"']+)["']/.exec(source.split("\n")[line - 1])?.[1] ?? ok[2];
    aliases.set(ok[1], { module: name, line });
  }

  // platform surface
  let dts = null;
  if (existsSync(dtsPath)) dts = parseDts(readFileSync(dtsPath, "utf8"));
  else report("warning", 1, `no platform definitions at ${dtsPath}; skipped import/function/type checks (regenerate with generate_platform_definitions)`);

  if (dts) {
    for (const [alias, { module, line }] of aliases) {
      if (!dts.modules.has(module)) report("error", line, `module "${module}" is not declared in platform.d.ts (declared: ${[...dts.modules.keys()].join(", ") || "none"})`);
      if (alias === "input") report("error", line, "do not shadow the input global");
    }
    for (const call of code.matchAll(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(/g)) {
      const imp = aliases.get(call[1]);
      if (!imp) continue;
      const mod = dts.modules.get(imp.module);
      if (mod && !mod.functions.has(call[2])) report("error", lineOf(call.index), `${call[1]}.${call[2]} is not declared in module "${imp.module}"`);
    }
    const visibleTypes = new Set([...dts.globalTypes]);
    for (const { module } of aliases.values()) for (const t of dts.modules.get(module)?.types ?? []) visibleTypes.add(t);
    const annotations = [
      ...code.matchAll(/\b(?:const|let)\s+[A-Za-z_]\w*\s*:\s*([^=;]+)=/g),
      ...code.matchAll(/\bfunction\s+[A-Za-z_]\w*\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\{/g),
    ];
    for (const a of annotations) {
      const text = a[0].startsWith("function")
        ? [...(a[1] ?? "").split(",").map((p) => p.split(":")[1] ?? ""), a[2] ?? ""].join(" ")
        : a[1];
      for (const id of text.matchAll(/\b([A-Za-z_]\w*)(?:\.[A-Za-z_]\w*)*/g)) {
        const name = id[0].split(".").at(-1);
        if (BUILTIN_TYPES.has(name) || visibleTypes.has(name)) continue;
        report("error", lineOf(a.index), `type ${id[0]} is not declared in an imported module`);
      }
    }
  }

  // filters on indexed fields (uses local class manifests)
  for (const call of code.matchAll(/\b([A-Za-z_]\w*)\.filter([A-Z]\w*)\s*\(/g)) {
    if (!aliases.has(call[1])) continue;
    const indexed = indexes.get(call[2]);
    if (!indexed) continue;
    const open = call.index + call[0].length - 1;
    const argsText = source.slice(open, matchingParen(code, open));
    for (const f of argsText.matchAll(/\bfield\s*:\s*["']([^"']+)["']/g)) {
      if (!indexed.includes(f[1])) report("error", lineOf(call.index), `filter on "${f[1]}" but ${call[2]} does not index it (indexedFields: ${indexed.join(", ")})`);
    }
  }

  // result
  const hasExecute = /\bfunction\s+execute\s*\(/.test(code);
  const lines = code.split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines.at(-1) ?? "";
  if (hasExecute && !/^return\s+execute\s*\(\s*input\s*\)\s*;$/.test(last)) {
    report("error", lines.length, "execute is not called automatically; end the script with: return execute(input);");
  }
  if (!hasExecute && !/\breturn\b/.test(code)) report("warning", 1, "no return found; the action result will be the last statement's value");
  for (const t of code.matchAll(/\bthrow\s+([^;]*);/g)) {
    if (!t[1].trim().startsWith("{")) report("warning", lineOf(t.index), "throw an object: { code: \"...\", message: \"...\" }");
  }

  // transactions: an open one is aborted when the run ends, even on success
  const begin = code.match(/\b\w+\.createTransaction\s*\(/);
  if (begin && !/\b\w+\.commitTransaction\s*\(/.test(code)) {
    report("error", lineOf(begin.index), "transaction is never committed; it is aborted when the script ends, discarding its writes. Call commitTransaction(t) before returning");
  }

  problems.sort((a, b) => a.line - b.line);
  const errors = problems.filter((p) => p.level === "error").length;
  errorCount += errors;
  console.log(`${file}: ${errors ? `${errors} error(s)` : "ok"}${problems.length - errors ? `, ${problems.length - errors} warning(s)` : ""}`);
  for (const p of problems) console.log(`  ${p.level === "error" ? "ERROR" : "warn "} line ${p.line}: ${p.message}`);
}

process.exit(errorCount ? 1 : 0);
