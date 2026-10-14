---
name: bootstrapp-apiscript
description: Write and check ApiScripts, the small TypeScript dialect that implements BootstrApp actions - the grammar, the execution model (input global, return value), the per-app function surface from platform.d.ts (filterX, createX, updateXById, other actions), atomic multi-write scripts with system.mongodb transactions, and whether a script runs elevated or with the caller's access. Use whenever writing, reviewing, fixing or porting server logic into a BootstrApp action script.
license: Proprietary. Copyright (c) 2026 Crochik Software Solutions, LLC. Use requires agreement to its license terms and its prior written authorization; see LICENSE.
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
| `filterX(conditions, fields, orderBy?, reverseOrder?, top?, skip?)` | `X[]` | AND of `{ field, operator, value }`; `field` and `orderBy` must be indexed; `fields` is the projection (always name what you read). `#text` with `Eq` searches the class's text fields. |
| `createX(fields, t?)` | new id (string) | Server-assigned fields (`_id`) are omitted. |
| `updateXById(id, fields, t?)` | boolean | A patch: pass only the fields you are changing, never the whole record read back. Fields you leave out or set to `null` don't change; `0`, `""` and `false` are written; an embedded object or array is replaced whole. |
| `deleteXById(id, t?)` | boolean | Hard delete. |
| `bulkCreateX(items, t?)` | `{ success, id?, error? }[]` | `createX` for each item. One result per item, in the order of `items`; a failing item doesn't stop the rest or throw. |
| `bulkUpdateX(items, t?)` | `{ success, id?, error? }[]` | `updateXById` for each item; an item is the patch plus the `_id` it applies to (`{ _id: p._id, stock: 3 }`). Same results as `bulkCreateX`. |
| `<actionName>(input)` | the action's output | Other registered actions, in their input class's namespace. |

Operators in scripts: `Eq, Ne, Gt, Gte, Lt, Lte, In, Nin`. On an array
field, `Eq` with `[x, y]` means it holds both and `In` that it holds any.
A range on one field is two conditions. Filtering and paging rules (no
total, `top`/`skip`): the platform notes, "Filtering and reading data".

Other system modules, when `platform.d.ts` declares them:
`system.session` (the caller: `getUserId()`, `getOrganizationId()`, …,
also in elevated scripts) and `system.user` (`invite(email, profile,
name?, organizationId?)` → user id; check who the caller is before
inviting from an elevated script, and pick the profile in the script)
and `system.files` (`create(bucket, path, name, contentType?,
downloadProfiles?)`, `confirmUpload(id)`, `getDownloadUrl(id)` and
`createFolder(bucket, path)`, see
Uploading files).

Strings have no methods (`trim`, `toLowerCase`, `split`, …): have the
caller send normalized values. Property names that are keywords (`from`,
`as`, `of`, `string`, …) can't be used after a `.`; rename the field in
the class instead. The checker flags both.

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
- `bulkCreateX` / `bulkUpdateX` don't throw for a bad item, so a transaction
  around them is only all-or-nothing if the script checks every result's
  `success` and throws when one is `false`. After a database error inside
  the transaction, the rest of the items can fail too.
- It needs the `system.mongodb` module in `platform.d.ts` (BootstrApp PRs #36
  and #43). A server between those two declares it as plain `mongodb`;
  import whichever name the file declares. If neither is there after
  regenerating, the server is older: say so, and order the script as
  validate everything, then write.

## Elevated or the caller's access

Every script is pushed with `elevated`, set in the action manifest
(`"elevated": false` or `true`). Decide it for each action; don't copy it
from another one.

- **`false`, the caller's access.** `filterX`, `createX`, `updateXById` and
  `deleteXById` run as the user who invoked the action, with their profile's
  permissions and constraints. The script can't do anything the caller
  couldn't do through the CRUD endpoints.
- **`true`, elevated.** Those calls ignore the caller's profile: they see and
  change every record of the app's classes, hidden fields and other users'
  and organizations' records included. Writes are still attributed to the
  caller, and `system.session` still returns the caller's ids.

Pick `false` unless the action needs what the caller's profile doesn't give:

- a total, count or uniqueness check over records the caller can't see (a
  member who only sees their own expenses submits one against a team
  budget);
- a write to a class or field the caller may only read (a stock level, a
  balance, a status only the action sets, an audit record);
- a controlled change to someone else's record (accept an invite, approve a
  request).

If the action would run fine with the caller's access, it is `false`. A
permission error a profile should allow is fixed with access (the
`bootstrapp-access` skill), never by elevating.

An elevated script is the only guard on what it touches, so it does the
checks the profile would have done:

```ts
import * as app from "app.expense_tracker";
import * as actions from "app.expense_tracker.actions";
import * as session from "system.session";

function execute(input: WithdrawExpenseInput): WithdrawExpenseOutput {
  const found = app.filterExpense([{ field: "_id", operator: "Eq", value: input.id }], ["_id", "submittedById", "status"]);
  if (found.length == 0) {
    throw { code: "NOT_FOUND", message: "Expense not found" };
  }
  const expense: Expense = found[0];
  // the Member profile's "submittedById Eq UserId" constraint doesn't apply here
  if (expense.submittedById != session.getUserId()) {
    throw { code: "NOT_FOUND", message: "Expense not found" };
  }
  ...
}
```

- Filter by the caller (`session.getUserId()`, `session.getOrganizationId()`)
  wherever the profile has a constraint, and check state the profile's field
  permissions would have protected.
- Return only what the caller may see; elevated reads include hidden fields.
- Who may run the action is still its action access (`access/actions/`),
  elevated or not. Elevated actions are usually limited to the profiles
  that need them.
- `system.session` is in `platform.d.ts` on current servers (ignore the
  stale `session` module with `currUser()` at the top of the file). If it
  is missing, the server is older: say so instead of elevating without the
  checks.

## Uploading files

Scripts never carry file contents. An action creates the file record and
hands the client a presigned url; the client sends the bytes straight to
storage:

```typescript
import * as files from "system.files";
import * as actions from "app.<app>.actions";

function execute(req: StartUploadInput): StartUploadOutput {
  if (req.fileName == null || req.fileName == "") {
    throw { code: "NAME_REQUIRED", message: "fileName is required" };
  }
  // bucket and folder are app configuration, never taken from input
  const file = files.create("<bucket>", "attachments/2026", req.fileName, req.contentType);
  return { fileId: file.id, uploadUrl: file.uploadUrl };
}

return execute(input);
```

- `create(bucket, path, name, contentType?, downloadProfiles?)` returns
  `{ id, name, uploadUrl }`. `bucket` is the bucket's name or id, `path`
  the folder's path in it; missing levels are created under the deepest
  existing folder and copy its upload permissions, but the first level
  must exist. `downloadProfiles` lists the profiles (names
  or ids, from `profiles/`) that may also download the file; the caller
  always may.
  The client `PUT`s the raw bytes to `uploadUrl` (no auth header), which
  expires 10 minutes after it is created. The `Content-Type` header of that
  `PUT` is what the confirm stores, so the client sends the real one.
- Then the file's size and content type are confirmed, either by the
  client calling `PUT /files/api/File({id})/Upload` with its token, or by a
  second action calling `files.confirmUpload(id)`, which returns
  `{ id, name, contentType, size }`. An unconfirmed file has no size.
- Keep the file id on the domain object it belongs to (a string field such
  as `attachmentFileId`), in the same action or after the confirm.
- The folder comes from the MCP tools: `get_buckets` (or `add_bucket`,
  which adds it without credentials; the platform owner sets the keys
  outside MCP and `hasCredentials` turns true), then `create_folder` with the
  profiles that may upload (`replace_folder_access` changes them later)
  for the top folder. Keep the bucket and path in the script, not in
  `input`. Never ask for bucket keys.
- `files.createFolder(bucket, path)` makes the folders without a file and
  returns `{ id, name, path }`.
- The caller needs upload access to the folder (the deepest existing one
  when levels are created). In an elevated script the
  account's access is checked instead, and the file then belongs to the
  account: the caller can't confirm or download it through REST, so
  confirm with `confirmUpload` from an elevated action too, and pass
  `downloadProfiles` so the caller's profile can read it.
- `files.getDownloadUrl(fileId)` returns `{ id, name, contentType,
  downloadUrl }`, a presigned `GET` url valid for 10 minutes. It needs read
  access to the file (its creator or a listed download profile), or an
  elevated script; an elevated script checks the caller via
  `system.session` before returning the url, since the url needs no token.
  Clients can also use `GET /files/api/File({id})/Download` with their
  token under the same rule.

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
5. Push with `replace_action_script` (safe to repeat), passing `elevated`
   from the action manifest (`bootstrapp-state.mjs plan` fills it in). The server type-checks
   the script against the real classes and modules and returns errors with
   line and column instead of saving a broken script; fix and push again.
   Record it with `bootstrapp-state.mjs record script <actionName>`, then call
   it once with `invoke_action` (real writes; pick input that is safe to
   create), or through the client on servers without that tool. A runtime error names the line and the
   call stack; on an older server it names the last line, so throw
   `{ code, message }` with distinct messages to find the spot.

## Porting existing server code

When migrating a handler from an existing backend, translate the logic, not
the syntax: replace ORM queries with `filterX` calls on indexed fields,
`async`/`await` with plain calls (calls are synchronous in scripts), `try`/
`catch` with up-front checks and `throw`, database transactions with a
`system.mongodb` transaction passed to every write (see Atomic writes), classes and closures with plain
functions, `for…of` with index loops, template strings with `+`. More
examples: [references/examples.md](references/examples.md).
