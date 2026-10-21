---
name: bootstrapp-apiscript
description: Write and check ApiScripts, the small TypeScript dialect that implements BootstrApp actions, shared scripts and class event scripts (run when an object is created or updated) - the grammar, the execution model (input global, return value), the per-app function surface from platform.d.ts (filterX, createX, updateXById, updateManyX, shared scripts, other actions), reusable code in shared scripts, atomic multi-write scripts with system.mongodb transactions, and whether a script runs elevated or with the caller's access. Use whenever writing, reviewing, fixing or porting server logic into a BootstrApp action script.
license: Proprietary. Copyright (c) 2026 Crochik Software Solutions, LLC. Use requires agreement to its license terms and its prior written authorization; see LICENSE.
---

# Writing ApiScripts

An ApiScript is the body of one action, a shared script (reusable code
the app's other scripts call as a function), or a class event script (run
after an object of a class is created or updated). It runs on the server
with the action's request body (the caller's argument, or the event's run
context) in a global named `input`, may call only the functions declared in
the app's platform definitions, and returns the action's output (or the
function's result).

## Ground truth, in order

1. **The app's `bootstrapp/generated/platform.d.ts`**: every module, type and
   function the script may use, generated from the app's registered classes,
   actions and shared scripts. Regenerate it (`generate_platform_definitions`,
   save the URL's content to that path) whenever those changed since it was
   saved, or if it is missing. Grep it; don't read it whole.
2. **The server's rule book**: `bootstrapp://reference/api-script.md`, and
   the grammar `api-script.g4`. It is the only copy of the language rules
   and of how shared scripts, action calls, transactions, elevated scripts,
   class event scripts, users, organizations, files and HTTP calls behave. **Read it
   before writing a script**, and the section for any of those you use.
3. **The server's `platform-notes.md`**, "Script runtime" and "Filtering and
   reading data".

If a script needs something the `.d.ts` doesn't declare (email, for example),
say so and stop on that part. Never invent a module or function.

## Shape of every script

```ts
import * as app from "app.expense_tracker";
import * as actions from "app.expense_tracker.actions";

function execute(input: ApproveExpenseInput): ApproveExpenseOutput {
  const found = app.filterExpense(
    [{ field: "_id", operator: "Eq", value: input.id }],
    ["_id", "status"]
  );
  if (found.length == 0) {
    throw { code: "NOT_FOUND", message: "Expense not found" };
  }
  if (found[0].status != "submitted") {
    throw { code: "INVALID_STATE", message: "Only submitted expenses can be approved" };
  }
  app.updateExpenseById(input.id, { status: "approved" });
  return { approved: true, expenseId: input.id };
}

return execute(input);
```

The mistakes that matter most (the rule book has the rest):

- `execute` is not called for you: **end with `return execute(input);`**.
- Import every namespace you use; bare type names resolve only through
  imports.
- `filterX` conditions and `orderBy` use indexed fields only, and `fields`
  names everything you read.
- `updateXById` is a patch: send only the changed fields.
- The same change to every record matching a filter (archive all open
  tasks of a project, `Inc` a counter, `AddToSet` a tag) is one
  `updateManyX(filter, operations, max?)` call, not a loop of `updateXById`.
  It isn't paged: every match changes, not the first 100 (that's
  `filterX`'s default `top`; pass a larger `top` or page with `skip`). It updates only what the caller's constraints
  allow and fails whole (nothing written) on a field it can't change or
  over `max` matches (1000 by default; pass more when the set can be
  bigger). Rule book, "Update many".
- A transaction still open when the script ends is aborted: commit before
  returning.
- No string methods, no `try`/`catch`, no arrow functions, `++`, `===`,
  `?.` or template literals.

## Where scripts live

| Kind | File | Pushed with |
|---|---|---|
| Action script | `bootstrapp/scripts/<actionName>.ts` | `replace_action_script`, with `elevated` from the action manifest |
| Shared script | `bootstrapp/shared/<name>.ts` + `<name>.json` (`scriptName`, `description`, optional `inputObjectType`, `outputObjectType`, `profiles`) | `replace_script`, before the scripts that call it |
| Class event script | `bootstrapp/events/<fullObjectType>.<created\|updated>.<scriptName>.ts` | `replace_class_event_script` |

Formats: the `bootstrapp` skill's `references/manifests.md`. Shared
scripts' payload classes follow the action ones: embedded classes in
`app.<app>.actions` named `<ScriptName>Input` / `<ScriptName>Output`, or a
domain class when it returns records.

## Choosing the tool for reused or follow-up logic

- **Logic two scripts need** goes in a shared script both call, never
  copied and never in an action registered only so scripts can call it.
- **Call another action** only when that action itself must run (its
  access check, its input validation, its own `elevated` setting), for
  example one checked step the caller's profile can't do freely.
- **Work that must follow every create or update** of a class, whichever
  client made it, is a class event script, one per behavior. It runs after
  the write with access to all of the app's data, so it can't reject the
  write; validation a client must not skip stays in an action.
- **Writes that must happen together** go in one `system.mongodb`
  transaction; to include a shared script's writes, pass it the transaction
  (rule book, "Shared scripts").

## Elevated or the caller's access

Every action script is pushed with `elevated`, set in the action manifest
(`"elevated": false` or `true`). Decide it for each action; don't copy it.

Pick `false` (the caller's access) unless the action needs what the
caller's profile doesn't give: a total, count or uniqueness check over
records the caller can't see; a write to a class or field the caller may
only read (a balance, a status only the action sets); a controlled change
to someone else's record (accepting an invite). A permission error a
profile should allow is fixed with access (the `bootstrapp-access` skill),
never by elevating.

An elevated script is the only guard on what it touches: filter by
`system.session` (`getUserId()`, `getOrganizationId()`) wherever the
profile has a constraint, check the record before changing it wherever it
has an update or delete constraint, return only what the caller may see, and say in
the action's `actionDescription` what it checks. Elevated also reaches
every record of classes shared from other apps. Rule book: "Elevated
scripts".

## Files

Scripts never carry file contents: an action calls `system.files`
`create(...)` and returns the presigned `uploadUrl` the client `PUT`s to
(rule book, "Uploading files" and "Downloading files"). Keep the bucket and
path in the script, never from `input`; set up the bucket and folder with
the MCP tools (`get_buckets`, `create_folder`, `replace_folder_access`) and
never ask for bucket keys. Store the file id on the domain object
(`receiptFileId`). The client side is in the `bootstrapp-client` skill.

## HTTP calls

A script calls another service with `system.http.fetch(url, init?)`,
shaped like `fetch` but returning the finished response with the body in
`res.text` and `res.json` (rule book, "Calling HTTP APIs"). Check
`res.ok`; error statuses don't throw. A run can only call what the
network policy of the script that started it allows, and that policy
binds the whole run: a shared script or a called action uses its
caller's. Write `network/<name>.json` with the hosts, schemes and
methods needed, and list the actions and class event scripts that start
those runs (manifest formats in the `bootstrapp` skill). Allow only the
hosts and methods the run uses. A policy allows nothing until someone
activates it outside the MCP server, so tell the user it needs approval. API keys never come from `input` or the script source:
keep them in a record only elevated scripts read, and call the API from
an elevated action that checks the caller. Prefer the client calling a
public API itself when nothing secret or server-side is involved.

## Workflow

1. Read the action manifest, its input/output class manifests, and the
   classes it touches (property names, `indexedFields`).
2. Make sure `generated/platform.d.ts` is current, then grep it for the
   functions you need (`grep -n "function filterExpense" ...`).
3. Write the script file (only the script; no Markdown). Logic another
   script already has, or that a second one will need, goes in a shared
   script.
4. Run the checker from this skill's folder:
   `node <this skill's folder>/scripts/check-apiscript.mjs <file>`.
   It flags syntax outside the published grammar, imports and functions not
   in `platform.d.ts`, a missing `return execute(input);`, and a
   transaction that is never committed. It is a lint, not the real type
   checker; fix what it reports, then reason through the rest.
5. Push it as `bootstrapp-state.mjs plan` lists it (shared scripts first).
   The server type-checks against the real classes and modules and returns
   errors with line and column instead of saving a broken script; fix and
   push again. Record it (`record script <actionName>`, `record
   shared-script <name>`, `record event-script <file name without .ts>`).
6. Run an action once with `invoke_action` (real writes; pick input that is
   safe to create; `profileName` runs it with a restricted profile's
   access). A class event script runs when you create or update an object
   of its class. A runtime error names the line, the source and the call
   stack.

## Porting existing server code

Translate the logic, not the syntax: ORM queries become `filterX` calls on
indexed fields, `async`/`await` plain calls (calls are synchronous),
`try`/`catch` up-front checks and `throw`, database transactions a
`system.mongodb` transaction passed to every write, helpers several
handlers use shared scripts, model hooks and triggers class event scripts.
Examples and a cheatsheet: [references/examples.md](references/examples.md).
