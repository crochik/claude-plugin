# Platform notes and known gaps

Observed by reading `crochik/BootstrApp` and `crochik/script-parser` source
(October 2026). The platform moves quickly: when something here matters for
the user's task, confirm against the live server (resources, a generated
spec or `.d.ts`, a quick test) and tell the user what you verified versus
what you are relying on from this page.

## Classes

- **No update or delete.** `add_object_class` refuses an existing name; there
  is no tool to change or remove a class. Plan names carefully and keep the
  manifests as the record.
- **`get_object_classes` returns names only.** The OpenAPI spec is the only
  MCP route to see full backend shapes.
- **Nested objects inside one schema.** The schema parser turns an inline
  object property into an embedded type named `<ParentFullName>.<property>`,
  but `add_object_class` stores only the root class. `$ref` properties are
  dropped (the single-schema parse has no components to resolve them). How a
  property should point at a separately registered embedded class is not
  supported yet; the platform owner expects to change `add_object_class` for
  it. Until then, write nested objects inline, check the generated spec or
  `.d.ts` shows the nested shape before building on it, and flag it to the
  user if it does not.
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

- **`register_action` is not idempotent**: a second call creates a duplicate.
- Scripts are stored on the action by `update_action_script`. At the time of
  writing, wiring a stored script into the class flow (so invoking the action
  runs it) happens in a server validation step that no MCP tool calls. After
  attaching scripts, invoke one action through the generated client to
  confirm it runs; if it returns nothing or does not execute, tell the user
  the platform has not wired it yet.

## Script runtime

- The request body is available as a global variable named `input`. The
  action's result is the value of a top-level `return`, or else the value of
  the last statement. A declared `function execute(...)` is **not** called
  automatically, so scripts end with `return execute(input);` (confirmed by
  the platform owner).
- Functions per top-level class (module = the class's namespace):
  `filter<Class>(conditions, fields, orderBy?, reverseOrder?, top?, skip?)`
  → array, `create<Class>(fields)` → new id, `update<Class>ById(id, fields)`
  → boolean (partial update), `delete<Class>ById(id)`. Registered actions
  are also callable, as `<actionName>(input)` in the input class's namespace.
- `delete<Class>ById` is declared but at the time of writing the runtime
  invoker has no delete branch, so it may do nothing. Prefer a status field
  (soft delete) until confirmed.
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

## Ideas the platform could add (from the original plugin's notes)

Validation tools (`validate_schema`, `validate_api_script`), update/delete for
classes and actions, an app-state resource returning full schemas, an
`invoke_action` tool for testing, bulk registration. If the user owns the
platform, these are worth raising when a gap blocks them.
