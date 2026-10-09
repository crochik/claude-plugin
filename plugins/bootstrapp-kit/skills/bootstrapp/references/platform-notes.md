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

## Script runtime

- The request body is available as a global variable named `input`. The
  action's result is the value of a top-level `return`, or else the value of
  the last statement. A declared `function execute(...)` is **not** called
  automatically, so scripts end with `return execute(input);` (confirmed by
  the platform owner).
- Functions per top-level class (module = the class's namespace):
  `filter<Class>(conditions, fields, orderBy?, reverseOrder?, top?, skip?)`
  → array, `create<Class>(fields, t?)` → new id,
  `update<Class>ById(id, fields, t?)` → boolean (partial update),
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
- The runtime also exposes `system.session` (`getUserId()`, `getAccountId()`,
  `getOrganizationId()`, `getProfileId()`, `getRole()`, `getClientId()`,
  `getEntityId()`), but the generated `.d.ts` may not declare it (it ships a
  stale `session` module with `currUser()`). Use `system.session` only after
  confirming with the user or a test that it validates.

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

## Ideas the platform could add (from the original plugin's notes)

Validation tools (`validate_schema`, `validate_api_script`), update/delete for
classes and actions, an app-state resource returning full schemas, an
`invoke_action` tool for testing, bulk registration. If the user owns the
platform, these are worth raising when a gap blocks them.
