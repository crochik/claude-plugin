# ApiScript — agent-facing rules

ApiScript is the deliberately small TypeScript subset the
bootstrapp.cloud runtime executes for every action. The canonical
grammar is `bootstrapp://reference/api-script.g4`; this document is
the curated subset agents should match when generating scripts.

## Allowed at the top of a file

- `import * as <alias> from "<module-path>";` — bring in the
  declarations from a runtime module. The set of modules available
  is whatever the **locally saved** `scripts/platform.d.ts` file
  currently declares — the architect generates that file by calling
  `mcp__bootstrapp__generate_platform_definitions` (which returns a
  URL the architect downloads and saves alongside the action
  scripts) and the scripter reads it on every run. Read it at
  authoring time and emit imports only for modules it actually
  contains. Do not assume modules exist; the surface evolves with
  the app — in particular the app's own namespace (with
  `<app_name>.create__X` / `update__X` / `delete__X` /
  `filter__X` per top-level class) only appears after the architect
  has registered every class and action and regenerated the file.
- `function <name>(<params>): <returnType> { ... }` — top-level
  function declarations. Every action's entry point is
  `function execute(input: <Input>): <Output>`.

## Allowed statements

| Form | Notes |
|---|---|
| `const x = expr;` / `const x: T = expr;` | Prefer `const`; the type annotation is optional — add it when the type isn't obvious from the right-hand side. |
| `let x = expr;` / `let x: T = expr;` | Use `let` only when reassigning. Annotation is optional — add it when the type isn't obvious from the RHS. |
| `<expr>;` | Function calls, assignments. |
| `if (cond) { ... } else { ... }` | `else` optional. Always brace the body — the grammar accepts a single bare statement, but always-brace keeps things boring and predictable. |
| `for (let i = 0; i < n; i = i + 1) { ... }` | C-style only — no `for…of` / `for…in`. |
| `while (cond) { ... }` | |
| `return <expr>;` / `return;` | Every `execute` must return the declared output shape. Bare `return;` is grammatical in helpers but unusual — keep it explicit. |
| `throw <expr>;` | Aborts the action. The runtime is the only catcher — there is no `try`/`catch` in the grammar. Because `new` is also forbidden, `<expr>` is a literal value: prefer an object literal of the form `{ code: "<CODE>", message: "<human readable>" }`. The runtime serializes the thrown value into the API error envelope. |

## Allowed expressions

Member access (`a.b`), index (`a[i]`), function call (`f(x, y)`),
unary (`!`, `+`, `-`), arithmetic (`+ - * / %`), comparison
(`< > <= >=`), equality (`== !=`), logical (`&& ||`), null coalescing
(`a ?? b`), ternary (`c ? a : b`), assignment to identifiers, member
targets, or index targets. Object literals (`{ a: 1, ...rest }`) and
array literals (`[1, 2, ...rest]`) with spread. Trailing commas are
allowed in array literals, object literals, and argument lists.
Primaries: `IDENTIFIER`, `NUMBER`, `STRING`, `true`, `false`, `null`.

## Type annotations

Annotations are **optional** and may appear on:

- `let` and `const` declarations: `let count: number = 0;`
- function parameters: `function execute(input: SubmitOrderInput) { … }`
- function return types: `function execute(input: SubmitOrderInput): SubmitOrderOutput { … }`

Allowed forms:

| Form | Example |
|---|---|
| `number` | `let n: number = 0;` |
| `string` | `let s: string = "";` |
| `boolean` | `let ok: boolean = true;` |
| `any` | `let v: any = expr;` (escape hatch — prefer a real type) |
| `T[]` | `let xs: string[] = [];` (any allowed type, including custom IDENTIFIERs and nested arrays — `Order[]`, `number[][]`) |
| `Record<string, T>` | `let m: Record<string, number> = {};` (string-keyed map; `T` is any allowed type) |
| `IDENTIFIER` | `let order: Order = …;` |

For namespace-qualified class names, annotate with the trailing
identifier only: `SubmitOrderInput`, not
`app.expense_tracker.actions.SubmitOrderInput`. The runtime infers
the namespace from the action's registered input/output classes;
the annotation is for human readers.

Generic types beyond `Record<string, T>` are **not** supported.

## Not allowed

- `class`, `interface`, `enum`, `type`
- generics other than `Record<string, T>`, decorators
- `async` / `await`, `try` / `catch`, `switch`
- arrow functions, default parameters, destructuring in declarations
- template literals, `new`, optional chaining (`?.`)
- `for…of` / `for…in`

Comments (`//` and `/* */`) are stripped by the runtime — fine for
human readers in the script's markdown, but never load-bearing.

When in doubt, write it the boring C-style way.

## Array Support

Supported methods:

| Method | Signature | Mutates? | Return |
|---|---|---|---|
| `length` | property | no | `number` (item count) |
| `push` | `(...items) => number` | yes | new length |
| `pop` | `() => T \| undefined` | yes | removed last item, or `undefined` if empty |
| `indexOf` | `(item, fromIndex?) => number` | no | index or `-1` |
| `lastIndexOf` | `(item, fromIndex?) => number` | no | index or `-1` |
| `includes` | `(item, fromIndex?) => boolean` | no | |
| `slice` | `(start?, end?) => T[]` | no | shallow copy; negative indices wrap |
| `join` | `(separator?) => string` | no | default sep is `,` |
| `concat` | `(...arrays) => T[]` | no | flattens one level of array args |
| `at` | `(index) => T \| undefined` | no | supports negatives |

Plus structural support:

| Feature | Example |
|---|---|
| Index read | `arr[i]` |
| Index assign | `arr[i] = value` |
| Spread in array literal | `[...arr, newItem]` |
| Spread in object literal | `{ ...obj, k: v }` |
