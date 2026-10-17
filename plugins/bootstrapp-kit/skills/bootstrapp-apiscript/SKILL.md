---
name: bootstrapp-apiscript
description: Write and check ApiScripts, the small TypeScript dialect that implements BootstrApp actions, shared scripts and class event scripts (run when an object is created or updated) - the grammar, the execution model (input global, return value), the per-app function surface from platform.d.ts (filterX, createX, updateXById, shared scripts, other actions), reusable code in shared scripts, atomic multi-write scripts with system.mongodb transactions, and whether a script runs elevated or with the caller's access. Use whenever writing, reviewing, fixing or porting server logic into a BootstrApp action script.
license: Proprietary. Copyright (c) 2026 Crochik Software Solutions, LLC. Use requires agreement to its license terms and its prior written authorization; see LICENSE.
---

# Writing ApiScripts

An ApiScript is the body of one action, or a shared script: reusable code
the app's other scripts call as a function. It runs on the server with the
action's request body (or the caller's argument) in a global named `input`,
may call only the functions declared in the app's platform definitions, and
returns the action's output (or the function's result).

## Ground truth, in order

1. **The app's `bootstrapp/generated/platform.d.ts`**: every module, type and
   function the script may use, generated from the app's registered classes
   and actions and shared scripts. Regenerate it (`generate_platform_definitions`, save the URL's
   content to that path) whenever classes, actions or shared scripts changed since it was
   saved, or if it is missing. Grep it; don't read it whole.
2. **The server's rule book and grammar**: `bootstrapp://reference/api-script.md`
   (the language, what isn't allowed, strings and reserved names, bulk
   writes, shared scripts, calling actions, transactions, elevated scripts,
   users, files) and
   `api-script.g4`. Read the rule book before writing a script.
3. **The server's `platform-notes.md`**, "Script runtime": what the runtime
   does around the language.

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
- A run is stopped after 60 seconds, everything it calls included. A
  stopped run usually means a loop or recursion that doesn't end;
  otherwise split the work across runs. When testing a script you know
  is slow, pass `invoke_action` a `timeoutSeconds` (at most 600).

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
| `scripts.<name>(args)` | the script's output class, or `any` | One of the app's shared scripts, in `app.<app>.scripts`. See Shared scripts. |
| `<actionName>(input)` / `<actionName>(id, input)` | the action's output | Another registered action of the app, in its input class's namespace; instance actions take the object's id first. See Calling other actions. |

Operators in scripts: `Eq, Ne, Gt, Gte, Lt, Lte, In, Nin`. On an array
field, `Eq` with `[x, y]` means it holds both and `In` that it holds any.
A range on one field is two conditions. Filtering and paging rules (no
total, `top`/`skip`): the server's `platform-notes.md`, "Filtering and
reading data".

Other system modules, when `platform.d.ts` declares them:
`system.session` (the caller: `getUserId()`, `getOrganizationId()`, …,
also in elevated scripts) and `system.user` (`invite(email, profile,
name?, organization?)` → user id, where `organization` is an
organization's id or name; `getOrganizations(search?)`,
`createOrganization(name, email?, phone?)` and
`updateOrganization(organization, name?, email?, phone?, isActive?)` →
`{ id, name, email, phone, isActive }`, account-wide, needing the
caller's permission on organizations unless elevated; see the server's
`api-script.md`, "Organizations". Check who the caller is before
inviting or changing organizations from an elevated script, and pick the
profile in the script)
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

## Shared scripts (reusable code)

Code more than one script needs (a calculation, a lookup, a validation, a
sequence of writes) goes in a **shared script**, never copied into each
action and never in an action registered only so scripts can call it. Write
it in `bootstrapp/shared/<name>.ts`, next to its manifest
`bootstrapp/shared/<name>.json` (`scriptName`, `description`, optional
`inputObjectType`, `outputObjectType` and `profiles`; format in the
`bootstrapp` skill's `references/manifests.md`). Every script of the app
calls it from the `app.<app>.scripts` module:

```ts
// bootstrapp/shared/orderTotal.ts (inputObjectType app.shop.actions.OrderTotalInput,
// outputObjectType app.shop.actions.OrderTotalOutput)
import * as app from "app.shop";
import * as actions from "app.shop.actions";

function execute(input: OrderTotalInput): OrderTotalOutput {
  const lines = app.filterOrderLine([{ field: "orderId", operator: "Eq", value: input.orderId }], ["quantity", "unitPriceCents"]);
  let totalCents = 0;
  for (let i = 0; i < lines.length; i = i + 1) {
    totalCents = totalCents + lines[i].quantity * lines[i].unitPriceCents;
  }
  return { totalCents: totalCents, lineCount: lines.length };
}

return execute(input);
```

```ts
// in any action script or another shared script
import * as scripts from "app.shop.scripts";

const total = scripts.orderTotal({ orderId: input.id });
```

- It is written like an action script: the caller's argument is `input`,
  the top-level `return` is the result, so it ends with
  `return execute(input);`, and it has its own imports.
- One argument. With `inputObjectType` the argument is type checked against
  that class, and with `outputObjectType` the result is typed; without them
  both are `any`. Give it classes whenever it takes or returns an object, so
  its callers are checked. Its payload classes follow the action ones:
  embedded classes in `app.<app>.actions` named `<ScriptName>Input` /
  `<ScriptName>Output` (PascalCase), or a domain class when it returns
  records. The argument is passed as is, not validated like a request.
- It runs as its caller's code: with the caller's access, elevated only
  when the calling script is, so it has no `elevated` flag and can never do
  more than its caller. When the caller is elevated, the caller's checks
  must cover what it touches.
- `profiles` limits which profiles' scripts may call it (the default
  profile and elevated scripts always may); leave it out to let every
  script call it. It needs no action access.
- If it throws, the caller fails too. Calls nest at most 16 deep, like
  action calls, but don't count against the 200 action calls per run, so
  a helper can be called once per row.
- Its writes join the caller's transaction only when the caller passes it
  in. Give its input class an optional `t` property with
  `"format": "transaction"` and no `type` (scripts see it as
  `Transaction`); the shared script passes `input.t` as the last argument
  of its writes, and the caller calls
  `scripts.saveOrder({ orderId: id, t: t })`, or leaves `t` out to write
  without one. Commit in the script that created the transaction.
- Push it with `replace_script` before the scripts that call it (the server
  checks a script against what it already has), then regenerate
  `platform.d.ts`. Full rules: the server's `api-script.md`, "Shared
  scripts".

## Calling other actions

A script can run another action of the app by calling it. Do this when you
need that action itself (its access check, its input validation, its own
`elevated` setting), typically a step the caller's access doesn't allow; to
reuse code, use a shared script instead:

```ts
// instance action: the object's id, then its input
const label = actions.createShippingLabel(input.id, { id: input.id, carrier: "ups" });
// class action: just its input
actions.recordAuditEntry({ kind: "shipped", orderId: input.id });
```

- Use the name `platform.d.ts` declares (regenerate it after registering
  the action). Bulk actions can't be called, and neither can an action
  whose flow is more than its script.
- The call returns the called script's result. Its input is checked like a
  request: fill its input class from `platform.d.ts` as an API client
  would, required fields included. The `id` argument only picks the object
  (the called script's `input.Object`); nothing is copied from it into the
  input.
- The caller's profile must be allowed to run it (elevated scripts always
  are). It runs with its own `elevated` setting, and its `system.session`
  is still the original caller, so an elevated action granted to a profile
  lets that profile's scripts do one checked step their own access
  doesn't allow.
- If it fails, the calling script fails too; there is no catch. Its writes
  commit on their own, outside your transaction.
- Recursion is allowed: at most 16 nested calls and 200 action calls per
  run (shared script calls aren't counted).
  The full rules are in the server's `api-script.md`, "Calling other
  actions".

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
  their own. Call writing actions after the commit, or move their logic
  into a shared script and pass it the transaction (see Shared scripts).
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

Classes shared with the app from another app or namespace (the
`bootstrapp-access` skill, "Classes from another app") are in
`platform.d.ts` under their own module, e.g. `import * as catalog from
"app.catalog";`. With the caller's access a script reaches what the
caller's profile was granted there; elevated, it reaches every record of
the class, shared or not, so weigh that when deciding `elevated`. Another
app's `scripts` module is never importable.

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

## Class event scripts

A class event script runs after an object of a class is created or
updated, whichever client wrote it. A class can have several per event,
one per independent behavior: each lives in
`bootstrapp/events/<fullObjectType>.<created|updated>.<scriptName>.ts`
and is pushed with `replace_class_event_script(fullObjectType,
classEvent, scriptName, script)`; nothing is registered first. They run
in no set order and one failing doesn't stop the others, so steps that
depend on each other go in one script. Read "Class event scripts" in the
server's `api-script.md` before writing one. What differs from an action:

- It runs asynchronously, after the write was saved and answered. It
  can't reject or change the write, and nothing reads what it returns.
- It always runs with access to all of the app's data (no `elevated`
  flag, no user in `system.session`). The user who made the change is
  `input.Event.Actor.UserId`.
- `input` is the flow run context, typed `any`: `input.Object` (the object
  as stored now), `input.Event.TargetId` (its id), and on updates
  `input.Event.ModifiedFields` and `input.Event.UpdatedValues`.
- Its own writes fire events, for every script of that event. An
  updated script that writes its own object returns early unless a field
  it depends on is in `ModifiedFields`; a created script never creates
  an object of its own class.

```ts
// bootstrapp/events/app.shop.OrderLine.updated.updateOrderTotal.ts
import * as app from "app.shop";
import * as scripts from "app.shop.scripts";

function execute(input: any): number {
  const fields: string[] = input.Event.ModifiedFields ?? [];
  if (fields.indexOf("quantity") < 0 && fields.indexOf("unitPriceCents") < 0) {
    return 0;
  }
  const orderId: string = input.Object.orderId;
  const total = scripts.orderTotal({ orderId: orderId });
  app.updateOrderById(orderId, { totalCents: total.totalCents });
  return total.totalCents;
}

return execute(input);
```

Check it with `check-apiscript.mjs` like any script,
push it as `plan` lists it, record it with `record event-script
<fullObjectType>.<created|updated>.<scriptName>`, then create or update an object to
see it run.

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
   Logic another script already has, or that a second script will need,
   goes in a shared script (`bootstrapp/shared/<name>.ts` plus its
   manifest) that both call.
4. Run the checker from this skill's folder:
   `node <this skill's folder>/scripts/check-apiscript.mjs bootstrapp/scripts/<actionName>.ts`
   (shared scripts the same way)
   It flags syntax outside the published grammar, imports and functions not
   in `platform.d.ts`, a missing `return execute(input);`, and a
   transaction that is never committed. It is a lint,
   not the real type checker; fix what it reports, then reason through the
   rest.
5. Push with `replace_action_script` (safe to repeat), passing `elevated`
   from the action manifest (`bootstrapp-state.mjs plan` fills it in). The server type-checks
   the script against the real classes and modules and returns errors with
   line and column instead of saving a broken script; fix and push again.
   Record it with `bootstrapp-state.mjs record script <actionName>`
   (shared scripts go first, with `replace_script` as `plan` lists it, and
   `record shared-script <name>`), then call
   it once with `invoke_action` (real writes; pick input that is safe to
   create), or through the client on servers without that tool. A runtime error names the line and the
   call stack; on an older server it names the last line, so throw
   `{ code, message }` with distinct messages to find the spot.

## Porting existing server code

When migrating a handler from an existing backend, translate the logic, not
the syntax: replace ORM queries with `filterX` calls on indexed fields,
`async`/`await` with plain calls (calls are synchronous in scripts), `try`/
`catch` with up-front checks and `throw`, database transactions with a
`system.mongodb` transaction passed to every write (see Atomic writes), helpers and services
several handlers use with shared scripts, classes and closures with plain
functions, `for…of` with index loops, template strings with `+`. More
examples: [references/examples.md](references/examples.md).
