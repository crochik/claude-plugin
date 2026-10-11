# Platform notes and known gaps

Observed by reading `crochik/BootstrApp` and `crochik/script-parser` source
(October 2026). The platform moves quickly: when something here matters for
the user's task, confirm against the live server (resources, a generated
spec or `.d.ts`, a quick test) and tell the user what you verified versus
what you are relying on from this page.

## Classes

- **Replace, but no delete.** `add_object_class` refuses an existing name;
  `replace_object_class` changes an existing class (not its TopLevel/Embedded
  type) without migrating stored records. Nothing deletes a class or action.
  These need a server with crochik/BootstrApp PR #28; older ones cannot
  change a class at all.
- **`get_object_classes` returns names only.** `get_object_class` returns one
  class in full (PR #28 servers); on older servers the OpenAPI spec is the
  only MCP route to see backend shapes.
- **`get_object_class` returns the API form**, not the stored manifest. The
  read schema adds a `{field}|Name` string for every reference field and the
  fields of related classes; those are generated, so drop them before using
  the schema as `add_object_class`/`replace_object_class` input. Field
  formats and descriptions come back as the platform stores them, which may
  differ in wording from what was sent.
- **Embedding a registered class.** A property points at an embedded class
  that was already added with `{"$ref": "#/components/schemas/<full class
  name>"}`: directly (one object), as array `items` (a list), or as
  `additionalProperties` of an object (a dictionary keyed by string). The
  referenced class must exist, be `Embedded`, and live under `app.<app_name>`;
  `add_object_class` rejects anything else with a message saying which.
  Register embedded classes before the classes that use them (`plan` orders
  them).
- **Inline nested objects** become embedded classes named
  `<ParentFullName>.<property>` and are stored together with the parent, so
  they cannot be reused and their names clash if a manifest uses the same
  one. Prefer a `$ref` to a named embedded class for anything reused or worth
  naming in the client.
- These two behaviors come from crochik/BootstrApp PR #20. A server without
  it silently drops `$ref` properties and inline nested classes. After
  registering a class that embeds, check the generated spec or `.d.ts` shows
  the nested shape; if it does not, the server is older, so tell the user.
- **Inheritance is `baseObjectType`.** A class extends another through the
  `baseObjectType` argument of `add_object_class` (the manifest's
  `baseObjectType`), not through `allOf` in the schema. Embedding is a
  different relationship and is not expressed by `baseObjectType`.
- **Supported property shapes.** `string` (formats `date`, `date-time`,
  `email`, `uri`, `password`, `uuid`; `enum` becomes a select), `integer`,
  `number`, `boolean`, arrays of strings/numbers/objects, string arrays with
  `enum` (multi-select), objects. `anyOf`/`oneOf` with more than one branch is rejected. Formats
  `byte`/`binary` are not supported.
- **`integer` is 32-bit signed** whatever `minimum`/`maximum`/`format`
  say (it is stored as an Int32). Values beyond ±2,147,483,647, such as
  ARGB colors or byte counts, need a string (hex for colors) or `number`.
  `bootstrapp-state.mjs check` rejects an integer whose bounds exceed it.
- **Full text search is on by default** for top-level classes with text
  fields (BootstrApp PR #64): a MongoDB text index named `#text` over the
  class's string fields. `isFullTextSearchable: false` on
  `add_object_class`/`replace_object_class` (the manifest key of the same
  name) turns it off. Search with the filter condition `{ field: "#text",
  operator: "Eq", value: "words" }`, in the REST filter and in scripts:
  whole words, any of them (OR); wrap the value in double quotes for a
  phrase. Results then sort by relevance. Nothing changes the flag alone:
  it goes through `replace_object_class` with the full class.
- **Property names that are ApiScript keywords** (`from`, `as`, `of`,
  `number`, `string`, `boolean`, `any`, `Record`, and `if`, `for`,
  `return`, `null`, …) can't be read or written by a script (`input.from`
  is a syntax error), so don't use them in classes an action touches,
  above all action input classes. `to`, `default` and `case` are fine.
  `bootstrapp-state.mjs check` warns about them.
- **Top-level classes belong directly in `app.<app_name>`.** Generating the
  spec creates the default flow only for top-level classes whose namespace is
  exactly `app.<app_name>`, and actions run through that flow. Put top-level
  classes in sub-namespaces only after confirming actions on them work.

## Actions

- `register_action` refuses a name the class already has; `replace_action`
  changes one. Before PR #28 a second `register_action` created a duplicate.
- `replace_action_script` validates on the server before storing and wires
  the script into the class flow, so invoking the action runs it.
  `generate_openapi_spec` also wires any stored scripts. On servers before
  PR #28, storing a script did not wire it: invoke one action through the
  generated client to confirm it runs, and tell the user if it doesn't.
- Each action has two routes in the generated spec: the plain one streams
  the run as server-sent events, and the same path plus `/Result` (PR #59)
  answers once with JSON. Use `/Result` unless the client shows progress of
  a long action. Actions are under `/openapi/api/Object/<class>/CustomAction(<id>)`
  (class scope) or `/openapi/api/Object/<class>(<objectId>)/CustomAction(<id>)`
  (instance and bulk); objects and filter are under `/app/api/Object/...`.
  Call what the generated client exposes rather than building paths.
- An action's input is checked for its top-level required fields only;
  nested values (an embedded object by `$ref`, which works in input
  classes since PR #63) reach the script unconverted and unvalidated.
  Validate them in the script.
- `replace_action_script` takes `elevated` since BootstrApp PR #46. It sets
  the runtime's `ElevateContext` on the script's flow step: the object
  functions then run with an account-level context (no profile, so no
  permissions or constraints) that keeps the caller as the actor;
  `system.session` still reads the caller. Older servers ignore the
  argument and every script runs with the caller's access. `get_actions`
  shows `elevated` on servers that have it. There is no call that changes
  only the flag: `replace_action_script` sends the script again with it.
- Nothing in MCP runs an action. Test one through the generated client (or
  ask the user to), and read the error it returns.

## Script runtime

- The request body is available as a global variable named `input`. The
  action's result is the value of a top-level `return`, or else the value of
  the last statement. A declared `function execute(...)` is **not** called
  automatically, so scripts end with `return execute(input);` (confirmed by
  the platform owner).
- Functions per top-level class (module = the class's namespace):
  `filter<Class>(conditions, fields, orderBy?, reverseOrder?, top?, skip?)`
  → array, `create<Class>(fields, t?)` → new id,
  `update<Class>ById(id, fields, t?)` → boolean (a patch: fields set to
  `null` or left out are untouched, `0`, `""` and `false` are written, and
  an embedded object or array is replaced whole, never merged; so a field
  can't be cleared back to null through an update),
  `delete<Class>ById(id, t?)` → boolean. Registered actions are also
  callable, as `<actionName>(input)` in the input class's namespace.
- `delete<Class>ById` works since BootstrApp PR #36 (2026-10-09); before
  that the invoker had no delete branch and it did nothing.
- Transactions (PR #36): the `system.mongodb` module has `createTransaction()`,
  `commitTransaction(t)` and `abortTransaction(t)`. Create, update and
  delete take the transaction as an optional last argument. Writes in it and
  their object events (flows) only take effect on commit. Every transaction
  still open when the run ends is aborted, whether the script threw or
  returned, so a script must commit before returning. `filter<Class>` takes
  no transaction and doesn't see its uncommitted writes; update and delete
  in the transaction do. Actions called from a script don't join it. How to
  write one: the `bootstrapp-apiscript` skill, "Atomic writes".
- The transaction module was named `mongodb` when PR #36 shipped and moved
  under `system` in PR #43 (`import * as mongodb from "system.mongodb";`).
  Use whichever name the app's `platform.d.ts` declares.
- Strings have no methods: no `trim`, `toLowerCase`, `split`, `replace`,
  `startsWith`. Anything normalized (a lowercase key for uniqueness, a
  trimmed name) comes from the caller as its own field, or is compared as
  given. Arrays have the methods `language.md` lists.
- `system.user` (PR #61): `invite(email, profile, name?, organizationId?)`
  gives a person the app's profile like `invite_user` and returns their
  user id, which they keep after their first sign-in. It needs the
  caller's right to create users unless the script is elevated.
- A failing script reports the line, column and source line where it
  failed, plus the call stack when it failed inside a function (PRs #53,
  #54). A server without them reports the script's last line
  (`return execute(input);`); throw `{ code, message }` with a distinct
  message to find the spot there.
- Script filter operators: `Eq, Ne, Gt, Gte, Lt, Lte, In, Nin`. The REST
  filter endpoint documents `Exists` instead of `Nin`. Use what the `.d.ts`
  lists for scripts.
- Bare type names in annotations resolve only against **imported**
  namespaces. Annotating with `ApproveExpenseInput` requires
  `import * as actions from "app.<app>.actions";`.
- The interpreter library supports more syntax (`for…of`, `switch`,
  `break`/`continue`, qualified type names) than the grammar the server
  publishes. Write to the published grammar; the deployed runtime may be
  older.
- `system.session` (`getUserId()`, `getAccountId()`,
  `getOrganizationId()`, `getProfileId()`, `getRole()`, `getClientId()`,
  `getEntityId()`) is declared in `platform.d.ts`, validates, and returns
  the caller, in elevated scripts too (PR #52). The same file still starts
  with a stale `session` module (`currUser()`); ignore that one.

## Filtering and reading data

Same rules in the REST filter and in `filter<Class>`:

- Conditions are ANDed and only on indexed fields. Several conditions on
  one field all apply, so a range is two conditions (`Gte` and `Lt`).
  Date and date-time values are converted and compared as dates.
- Array fields: `Eq` means the array holds every given value and `In` that
  it holds any. Pass the value as an array, `[x]` for "contains x"; a bare
  scalar is rejected. Multi-select (string array with `enum`) fields are
  the exception: there `Eq` with a scalar is "contains".
- There is no total count. Page with `top` and `skip` until a page comes
  back short. The REST filter caps `top` at 99; `0`, a missing value or
  anything above 99 returns 100 rows.
- `fields` is the projection: only those fields come back, plus `_id`.
  Name only what the screen or script uses; `["_id"]` for a count.
- Sorting: script `orderBy` must be an indexed field (the type check says
  so). The REST filter sorts by any field and silently ignores one it
  doesn't know. Enums are stored as their strings and sort alphabetically,
  so a rank order (priority) needs a numeric rank field.

## Auth

- OIDC authorization code + PKCE for every platform. Request only `openid`;
  user claims are in the access token. `client_id` is the app name for
  TypeScript web apps; other platforms load it from env. Read the server's
  auth config resource for the issuer and current rules.
- Every redirect URL must be allowed with `add_oidc_client_redirect`.
- `init_app` sets sign-up open to everyone, into the full-access `Admin`
  profile. Before real users arrive, add a restricted profile and point
  sign-up at it (or make it invite only) with `replace_app_auth`.

## Access control

These need crochik/BootstrApp PRs #30–#33. On an older server the tools are
missing; access can then only be set in the BootstrApp admin.

- Permissions resolve **first match** over the user's profile and then its
  `inheritsFrom` list, in order; entries are not merged. A field or class
  with no entry anywhere means no access. Constraints of all those profiles
  are combined with AND.
- A field added by `replace_object_class` has no entry for existing profiles,
  so it is hidden from them until their access is applied again.
- Users and organizations are account-wide: every app the developer has in
  the account shares them. A user's access to one app is their profile for
  it.
- A user's profile and organization are in their token, so changing them
  reaches the user at their next sign in.
- Only the app owner can call the access, sign-in and user tools, and the
  class, action, script and generate tools for an app.
- The access tools manage profiles only. `get_class_access` also lists role
  entries (account, admin) under `otherEntries`; nothing in MCP changes
  them.
- A profile constraint such as `ownerId Eq {{context "UserId"}}` gives each
  user only their own rows on every read, filter and action of that
  profile. That is the way to make data private per user (the
  `bootstrapp-access` skill).

## MCP errors

A tool error that the server didn't anticipate reaches you as
`Tool '<name>' failed unexpectedly. See server logs.`, with no cause. Check
the arguments against this page and the live schema, then ask the user to
look at the server log; don't guess a cause.

## Gaps (October 2026)

No MCP tool runs an action, deletes a class or action, changes only the
`elevated` or `isFullTextSearchable` flag, edits role access entries, or
returns a compact `get_object_class`. Scripts are sent in full on every
save. MCP sessions can drop when the server restarts, and a client may not
pick up new tool parameters until it reconnects. If the user owns the
platform, these are worth raising when a gap blocks them.
