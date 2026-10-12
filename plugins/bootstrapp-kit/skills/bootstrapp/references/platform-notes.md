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
- **`baseObjectType` alone only reuses fields.** The child gets the base's
  fields (their access is set on the base) but keeps its records in its
  own collection: listing the base never returns them.
- **Discriminated classes share the base's records** (crochik/BootstrApp
  PR #75). The base passes `discriminatorField` (an own, required,
  indexed string property); each class extending it passes its
  `discriminatorValue`. Then:
  - The server keeps the base's discriminator property an enum (a select)
    of the variants' values, each described by its variant's class name
    (`x-enum-descriptions` in the spec). Values the base's own schema
    lists in an `enum` that no variant uses stay in it as plain base
    records; any other value is rejected. `get_object_class` returns the
    same map as `discriminatedClasses`.
  - A top-level variant shares the base's collection. Its value is part of
    its account constraint: create always stores it, whatever the body
    says, and reading, filtering, updating or deleting through the
    variant only touches records with that value.
  - Listing or filtering the base returns every variant's records with the
    base's fields. `GET` by id through the base returns the variant's
    fields too, and `PATCH` through the base updates the record as its
    variant. `POST` to the base creates the variant whose value matches
    the body's discriminator; a value no variant has creates a plain base
    record (only values the base's enum lists).
  - Embedded bases work the same way: a `$ref`, array or dictionary of a
    discriminated embedded class stores and reads each object as the
    variant its value names.
  - The base's `discriminatorField` can't change while variants use it,
    and each variant of a base needs a different value. A top-level class
    that already has its own collection can't become a variant (add a new
    class), and a variant can't stop being one.
  - Full text search uses one text index per collection, built for the
    first class that needed it (normally the base), so put searchable
    text on the base.
  - A server without PR #75 rejects or ignores the two arguments; then
    use one flat class with a `kind` enum instead.
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
  phrase. Results then sort by relevance. `set_class_full_text_search`
  (PR #67) changes the flag alone; older servers need
  `replace_object_class` with the full class.
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
  shows `elevated` on servers that have it. To change only the flag, call
  `update_action_script` with `elevated` and no `actionScript` (BootstrApp
  PR #67); older servers need the script sent again.
- `invoke_action(fullObjectType, actionName, input?, profileName?)`
  (PR #66) runs the stored script as the app owner and returns its result
  or the script error. Its writes are real. Without it, test through the
  generated client (or ask the user to) and read the error it returns.

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
- `system.files` (PR #65, 2026-10-11): `create(folderId, name,
  contentType?)` inserts a RemoteFile in the folder and returns
  `{ id, name, uploadUrl }`, a presigned `PUT` url valid for 10 minutes;
  `confirmUpload(id)` reads size and content type back from the bucket and
  returns `{ id, name, contentType, size }` (the same check as the REST
  `PUT /files/api/File({id})/Upload`). Creating needs the folder's upload
  permission for the caller, or the account's when elevated. The creator
  gets Read and Upload on the file; when elevated there is no user, so the
  account's Admin role gets them instead. The bucket must support presigned
  urls (S3). How to use it: the `bootstrapp-apiscript` skill, "Uploading
  files".
- Downloads (PR #70): `create` takes `downloadProfiles` (profile names or
  ids), which get Read on the file. `getDownloadUrl(fileId)` returns
  `{ id, name, contentType, downloadUrl }`, a presigned `GET` valid for 10
  minutes, when the caller has Read on the file, the file allows anonymous
  download, the caller uploaded it, or the script is elevated.
- Buckets and folders (PR #69): the MCP tools `get_buckets`, `add_bucket`,
  `update_bucket`, `get_folders`, `create_folder`, `get_folder_access` and
  `replace_folder_access` manage them (buckets are added without
  credentials; the platform owner sets keys outside MCP), and
  `system.files.createFolder` makes subfolders that copy the parent's
  upload permissions. Since PR #71, `create(bucket, path, name, ...)` and
  `createFolder(bucket, path)` take a bucket name or id and a folder path
  instead of folder ids, creating missing levels under the deepest
  existing folder (servers without it take `create(folderId, name, ...)`
  and `createFolder(parentFolderId, path)`). Buckets have no permissions of
  their own. A folder's uploaders are app profiles (by id) plus the Admin
  role, which elevated scripts run as. Folders made before PR #69 (or
  through PI.Files) have no permissions, so nobody can upload to them
  through `system.files` until `create_folder` or `replace_folder_access`
  is run for them.
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
`Tool '<name>' failed unexpectedly`. Since PR #66 it carries the exception
type and message; before that it had no cause. Check the arguments against
this page and the live schema, then ask the user to look at the server log;
don't guess a cause.

## Gaps (October 2026)

No MCP tool deletes a class or action or edits role access entries.
Servers without BootstrApp PR #69 have no bucket or folder tools, so a
script's folder id comes from the user. Servers without PR #70 let only a
file's creator download it (no `downloadProfiles` or `getDownloadUrl`), and
servers without
BootstrApp PR #68 fail `invoke_action` on scripts that import
`system.files` (the action itself runs them).
Servers without BootstrApp PRs #66 and #67 also lack `invoke_action`, the
flag-only changes and `get_object_class(compact)`. Scripts are sent in full
on every save. MCP sessions can drop when the server restarts, and a client may not
pick up new tool parameters until it reconnects. If the user owns the
platform, these are worth raising when a gap blocks them.
