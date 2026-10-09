---
name: bootstrapp-apiscript
description: Write and check ApiScripts, the small TypeScript dialect that implements BootstrApp actions - the grammar, the execution model (input global, return value), the per-app function surface from platform.d.ts (filterX, createX, updateXById, other actions), and atomic multi-write scripts with system.mongodb transactions. Use whenever writing, reviewing, fixing or porting server logic into a BootstrApp action script.
---

# Writing ApiScripts

An ApiScript is the body of one action. It runs on the server with the
action's request body in a global named `input`, may call only the functions
declared in the app's platform definitions, and returns the action's output.

## Ground truth, in order

1. **The app's `bootstrapp/generated/platform.d.ts`**: every module, type and
   function the script may use, generated from the app's registered classes
   and actions. Regenerate it (`generate_platform_definitions`, save the URL's
   content to that path) whenever classes or actions changed since it was
   saved, or if it is missing. Grep it; don't read it whole.
2. **The server's grammar and rule-book resources** (ApiScript grammar,
   ApiScript rule book). Read them when the MCP server is reachable.
3. **This skill's [references/language.md](references/language.md)**: a
   snapshot of the rules plus the runtime behavior the grammar doesn't say.

If a script needs something the `.d.ts` doesn't declare (email, HTTP, files,
current user), say so and stop on that part. Never invent a module or
function.

## Shape of every script

```ts
import * as app from "app.expense_tracker";
import * as actions from "app.expense_tracker.actions";

function execute(input: ApproveExpenseInput): ApproveExpenseOutput {
  const found = app.filterExpense(
    [{ field: "_id", operator: "Eq", value: input.id }],
    ["_id", "status", "amountCents", "submittedById"]
  );
  if (found.length == 0) {
    throw { code: "NOT_FOUND", message: "Expense not found" };
  }
  const expense: Expense = found[0];
  if (expense.status != "submitted") {
    throw { code: "INVALID_STATE", message: "Only submitted expenses can be approved" };
  }
  app.updateExpenseById(expense._id, { status: "approved" });
  return { approved: true, expenseId: expense._id };
}

return execute(input);
```

- Import a module per namespace you use. The module name is the namespace
  (`app.<app>` for domain classes, `app.<app>.actions` for payload classes
  and for calling other actions).
- Bare type names (`ApproveExpenseInput`, `Expense`) resolve only against
  imported namespaces, so import the actions namespace when you annotate with
  its types.
- `execute` is not called automatically: **end with `return execute(input);`**
  The action's result is the top-level `return` value.
- Abort with `throw { code: "UPPER_SNAKE", message: "human readable" }`.
  There is no try/catch; the runtime turns it into the API error. A throw
  does not undo writes already made, unless they were made in a
  transaction that isn't committed yet (see Atomic writes).
- Return an object that matches the output class exactly.

## Function surface (confirm names in `platform.d.ts`)

For each top-level class `X` in namespace `ns` the profile can access:

| Function | Returns | Notes |
|---|---|---|
| `filterX(conditions, fields, orderBy?, reverseOrder?, top?, skip?)` | `X[]` | AND of `{ field, operator, value }`; `field` and `orderBy` must be indexed; `fields` is the projection (always name what you read). |
| `createX(fields, t?)` | new id (string) | Server-assigned fields (`_id`) are omitted. |
| `updateXById(id, fields, t?)` | boolean | Partial update: only the fields you pass change. |
| `deleteXById(id, t?)` | boolean | Hard delete. |
| `<actionName>(input)` | the action's output | Other registered actions, in their input class's namespace. |

Operators in scripts: `Eq, Ne, Gt, Gte, Lt, Lte, In, Nin`.

`t` is an optional transaction from the `system.mongodb` module, always the last
argument. `filterX` takes none.

## Atomic writes (transactions)

Each create, update and delete commits on its own, so a script that throws
half-way leaves its earlier writes behind. When several writes must happen
together or not at all, use a transaction:

```ts
import * as app from "app.expense_tracker";
import * as actions from "app.expense_tracker.actions";
import * as mongodb from "system.mongodb";

function execute(input: ApproveExpenseInput): ApproveExpenseOutput {
  // 1. read and validate everything
  const found = app.filterExpense([{ field: "_id", operator: "Eq", value: input.id }], ["_id", "status", "amountCents", "monthId"]);
  if (found.length == 0) {
    throw { code: "NOT_FOUND", message: "Expense not found" };
  }
  const expense: Expense = found[0];
  const months = app.filterMonthTotal([{ field: "_id", operator: "Eq", value: expense.monthId }], ["_id", "approvedCents"]);
  if (months.length == 0) {
    throw { code: "NOT_FOUND", message: "Month not found" };
  }

  // 2. write, passing t as the last argument of every write
  const t = mongodb.createTransaction();
  app.updateExpenseById(expense._id, { status: "approved" }, t);
  app.updateMonthTotalById(months[0]._id, { approvedCents: months[0].approvedCents + expense.amountCents }, t);

  // 3. commit before returning
  mongodb.commitTransaction(t);
  return { approved: true, expenseId: expense._id };
}

return execute(input);
```

- `mongodb.createTransaction()` starts one; `mongodb.commitTransaction(t)`
  commits it; `mongodb.abortTransaction(t)` rolls it back.
- Only writes that receive `t` are in it. A write without `t` commits at
  once and is never rolled back.
- **Commit before returning.** A transaction still open when the script
  ends is aborted, even if the script succeeded, so a missing commit
  silently loses every write in it.
- A `throw` before the commit rolls everything back; no need to call
  `abortTransaction` first. Call it only to undo the writes and still
  return a normal result.
- `filterX` reads committed data only: it doesn't see the transaction's own
  writes. Read and validate first, keep values in variables, then write.
- Object events (flows, triggers) of writes in `t` fire after the commit,
  and never on abort.
- A committed or aborted `t` can't be used again. If the commit fails (for
  example a write conflict with a concurrent request) nothing is applied and
  the action fails.
- Calling another action doesn't join the transaction; its writes commit on
  their own. Call writing actions after the commit, or inline their logic.
- A single write doesn't need one. Open the transaction after the reads and
  keep it short.
- It needs the `system.mongodb` module in `platform.d.ts` (BootstrApp PRs #36
  and #43). A server between those two declares it as plain `mongodb`;
  import whichever name the file declares. If neither is there after
  regenerating, the server is older: say so, and order the script as
  validate everything, then write.

## Workflow

1. Read the action manifest, its input/output class manifests, and the
   classes it touches (property names, `indexedFields`).
2. Make sure `generated/platform.d.ts` is current, then grep it for the
   functions you need (`grep -n "function filterExpense" ...`).
3. Write `bootstrapp/scripts/<actionName>.ts` (only the script; no Markdown).
4. Run the checker from this skill's folder:
   `node <this skill's folder>/scripts/check-apiscript.mjs bootstrapp/scripts/<actionName>.ts`
   It flags syntax outside the published grammar, imports and functions not
   in `platform.d.ts`, a missing `return execute(input);`, and a
   transaction that is never committed. It is a lint,
   not the real type checker; fix what it reports, then reason through the
   rest.
5. Push with `replace_action_script` (safe to repeat). The server type-checks
   the script against the real classes and modules and returns errors with
   line and column instead of saving a broken script; fix and push again.
   Record it with `bootstrapp-state.mjs record script <actionName>`, then call
   the action once through the client, or ask the user to, to see it run.

## Porting existing server code

When migrating a handler from an existing backend, translate the logic, not
the syntax: replace ORM queries with `filterX` calls on indexed fields,
`async`/`await` with plain calls (calls are synchronous in scripts), `try`/
`catch` with up-front checks and `throw`, database transactions with a
`system.mongodb` transaction passed to every write (see Atomic writes), classes and closures with plain
functions, `for…of` with index loops, template strings with `+`. More
examples: [references/examples.md](references/examples.md).
