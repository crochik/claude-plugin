# ApiScript language reference (snapshot)

Snapshot of the grammar the BootstrApp MCP server publishes, plus runtime
behavior read from the interpreter. The server's grammar and rule-book
resources win where they differ.

## Top level

- `import * as <alias> from "<namespace>";` for each module used.
- `function <name>(<params>): <type> { ... }` declarations (hoisted).
- Any statement. A top-level `return <expr>;` ends the script and is its
  result; otherwise the result is the value of the last statement.

The request body is the global `input`. Convention: put the logic in
`function execute(input: <Input>): <Output>` and end with
`return execute(input);`.

## Statements

| Form | Notes |
|---|---|
| `const x = expr;` / `const x: T = expr;` | Prefer `const`. |
| `let x = expr;` / `let x: T = expr;` | When reassigning. Always initialize. |
| `expr;` | Calls and assignments. |
| `if (c) { ... } else { ... }` | Use braces; `else if (...) { ... }` also works. |
| `for (let i = 0; i < n; i = i + 1) { ... }` | C-style only. No `i++`, no `+=`. |
| `while (c) { ... }` | |
| `return expr;` / `return;` | |
| `throw expr;` | Use `{ code, message }`. No try/catch. |

## Expressions

Member `a.b`, index `a[i]`, call `f(x, y)`, unary `! + -`, arithmetic
`+ - * / %`, comparison `< > <= >=`, equality `== !=` (no `===`), logical
`&& ||`, `??`, ternary `c ? a : b`, assignment `=` (to identifiers, members,
indexes), object literals with spread `{ ...o, k: v }`, array literals with
spread `[...a, x]`, trailing commas allowed. Literals: numbers, single or
double quoted strings, `true`, `false`, `null`.

## Types (optional annotations)

`number`, `string`, `boolean`, `any`, `T[]`, `Record<string, T>`, and type
names declared in an imported module. Annotate `execute`'s parameter and
return type; annotate locals when the right side doesn't make the type
obvious. An unknown type name is an error.

## Arrays

`length`, `push`, `pop`, `indexOf`, `lastIndexOf`, `includes`, `slice`,
`join`, `concat`, `at`, index read and write, spread.

## Not available

`class`, `interface`, `type`, `enum`, generics other than `Record`, arrow
functions, `async`/`await`, `try`/`catch`, `switch`, `for…of`/`for…in`,
`break`/`continue`, destructuring, default parameters, template literals,
`new`, optional chaining `?.`, `===`/`!==`, `++`/`--`, compound assignment
(`+=`), regular expressions, `undefined`, `typeof`. (The interpreter library
already supports `for…of`, `switch`, `break` and `continue`, but the
published grammar does not; don't use them until the server's grammar
resource lists them.)

Comments `//` and `/* */` are allowed and ignored.
