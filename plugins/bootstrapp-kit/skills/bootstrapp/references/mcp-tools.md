# bootstrapp MCP tools

Arguments and behavior as implemented in `crochik/BootstrApp`
(`src/MCP.BootstrApp/Tools/*.cs`). If a call's schema in your session differs
from this page, the live schema wins.

## `init_app`

| Arg | Notes |
|---|---|
| `appName` | snake_case. Becomes the OIDC `client_id` and the `app.<appName>` namespace. |
| `appTitle` | Human-readable. |
| `appDescription` | Paragraph. |

Creates the app, a default user profile, and an OIDC client (authorization
code + PKCE; Microsoft, Google, Salesforce, GitHub sign-in with user
auto-provisioning). Calling it again for an app you already own returns the
existing app; a name owned by someone else returns an error. Grants the
calling user a profile on the app so they can log in.

## `add_object_class`

| Arg | Notes |
|---|---|
| `appName` | The app's name. |
| `fullObjectType` | Must start with `app.<appName>`. |
| `type` | `TopLevel` or `Embedded`. |
| `indexedFields` | Required. Only these fields can be used in filter conditions and `orderBy`. `[]` for embedded. |
| `foreignKeys` | Optional `[{ localFieldName, referenceObjectType, referenceFieldName }]`. Each `localFieldName` must be a property in the schema (else the call fails). Turns the field into a reference and adds a one-to-one relation. |
| `baseObjectType` | Optional parent class (must also be under `app.<appName>`). |
| `schema` | JSON Schema of the object (parsed as an OpenAPI 3.1 schema object). |

Fails if the class already exists. `_id` gets a server-generated UUID on
create. Scalar `default` values are kept as field defaults.

## `register_action`

| Arg | Notes |
|---|---|
| `fullObjectType` | Target class. The app is taken from its second segment (`app.<appName>.…`). |
| `actionName` | camelCase verb phrase. Also the script function name other scripts can call. |
| `actionSummary` | Short phrase. |
| `actionDescription` | 1–3 sentences: purpose, side effects, invariants. |
| `scope` | `Instance` (input has `id`), `Bulk` (input has `ids`), `Class` (neither). |
| `actionInputObjectType` | Full name of the input class. |
| `actionOutputObjectType` | Full name of the output class. |

Refuses an action name the class already has (older servers inserted a
duplicate instead). It does not take a script.

## `replace_object_class`

Same arguments as `add_object_class`. Fails if the class doesn't exist or if
`type` differs from the stored class. Replaces properties, indexes, foreign
keys, base class, title and description; keeps the class id, collection and
flow. Inline nested classes are replaced or added. Stored records are not
migrated.

## `replace_action`

Same arguments as `register_action`, for an action that exists. Keeps the
action id and its script.

## `get_actions`

`get_actions(fullObjectType)` → `{ objectClass, actions: [{ name, summary,
description, inputObjectType, outputObjectType, scope, hasScript }] }`.

## `replace_action_script` (and `update_action_script`)

| Arg | Notes |
|---|---|
| `fullObjectType` | The action's target class. |
| `actionName` | As registered. |
| `actionScript` | The full ApiScript source. |

Validates the script against the app's classes and the system modules
(`input` is a global), and rejects it with `Syntax`/`Type`/`Reference` errors
and line/column when invalid, leaving the stored script unchanged.
Otherwise stores it and adds or updates the step that runs it when the action
is invoked (top-level classes in `app.<app_name>` only). Safe to repeat.
`update_action_script` is the older name; on servers before PR #28 it only
stores the script.

## `get_action_script`

`get_action_script(fullObjectType, actionName)` → the stored script text.
Use it to pull scripts written elsewhere into `scripts/<actionName>.ts`.

## `get_namespaces` / `get_object_classes`

`get_namespaces()` lists namespaces visible to the account.
`get_object_classes(namespace?)` lists classes under a namespace prefix
(must start with `app.`): name, namespace, description, base class. **It does
not return schemas, indexed fields, or actions.** To see full shapes on the
backend, generate the OpenAPI spec.

## `generate_platform_definitions`

| Arg | Notes |
|---|---|
| `applicationName` | The app's name. |

Returns `{ downloadURL, suggestedPath, instruction }`. The file is a `.d.ts`
listing every module, type, and function an ApiScript can use for this app.
Save it to `bootstrapp/generated/platform.d.ts`.

## `generate_openapi_spec`

| Arg | Notes |
|---|---|
| `applicationName` | The app's name. |

Returns `{ downloadURL, suggestedPath, instruction }` for an OpenAPI 3.0
**YAML** document covering every `app.*` class the app's profile can access
(filter, create, update, delete) plus the app's actions. Save it to
`bootstrapp/generated/openapi.yaml`. Generating the spec also creates the
default flow for each top-level class and the forms for actions.

## `add_oidc_client_redirect`

| Arg | Notes |
|---|---|
| `appName` | The app's name. |
| `redirectUrl` | Absolute URL the identity provider redirects back to after login. |

Idempotent. Needed for every dev and deployed origin before login works there.
