# bootstrapp MCP tools

Arguments and behavior as implemented in `crochik/BootstrApp`
(`src/MCP.BootstrApp/Tools/*.cs`). If a call's schema in your session differs
from this page, the live schema wins.

## `init_app`

| Arg | Notes |
|---|---|
| `appName` | snake_case. Becomes the OIDC `client_id` and the `app.<appName>` namespace. On servers with BootstrApp PR #73: a letter, then letters, digits or `_` (up to 40), and unique across the platform (it is refused if any account already uses that client id). |
| `appTitle` | Human-readable. |
| `appDescription` | Paragraph. |

Creates the app, its `Admin` profile (full access, can't be restricted), and an OIDC client (authorization
code + PKCE; Microsoft, Google, Salesforce, GitHub sign-in with user
auto-provisioning into `Admin`; change that with `replace_app_auth`). Calling it again for an app you already own returns the
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
| `discriminatorField` | Optional. Makes the class a discriminated base: the name of one of its own required string properties (an enum is best) whose value says which class a record is. Can't change while classes use it. |
| `discriminatorValue` | Required when the base has a `discriminatorField`, else not allowed: this class' value of that field (one of its enum values, different for each class of the base). Leave the field itself out of this schema. |
| `schema` | JSON Schema of the object (parsed as an OpenAPI 3.1 schema object). |
| `isFullTextSearchable` | Optional, default `true`. Top-level classes with text fields get a `#text` index for full text search; `false` turns it off. |

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
description, inputObjectType, outputObjectType, scope, hasScript, elevated,
profiles }] }`.

## `replace_action_script` (and `update_action_script`)

| Arg | Notes |
|---|---|
| `fullObjectType` | The action's target class. |
| `actionName` | As registered. |
| `actionScript` | The full ApiScript source. |
| `elevated` | Required boolean. `false`: the script's reads and writes run with the caller's access. `true`: they ignore the caller's profile (permissions and constraints); writes are still attributed to the caller. Optional on `update_action_script`, where omitting it keeps the current setting. |

Validates the script against the app's classes and the system modules
(`input` is a global). On servers with BootstrApp PR #73, imports other than
`system.*` and the app's own `app.<app_name>` modules are refused. Invalid scripts are rejected with `Syntax`/`Type`/`Reference` errors
and line/column, leaving the stored script unchanged.
Otherwise stores it and adds or updates the step that runs it when the action
is invoked (top-level classes in `app.<app_name>` only). Safe to repeat.
`update_action_script` is the older name; on servers before PR #28 it only
stores the script. On servers with PR #67, `update_action_script` without
`actionScript` keeps the stored script, so it can change only `elevated`.

## `invoke_action`

`invoke_action(fullObjectType, actionName, input?, profileName?)` (BootstrApp
PR #66) runs the action's stored script now, as the app owner, with the
default profile's access or `profileName`'s, and returns the script's value
or its error (line, source, call stack). Elevated actions still run
elevated. It is a real run: writes change the app's data. Input is checked
for required fields like an API call; an Instance action's object isn't
loaded, so pass its `id` in `input`.

## `get_action_script`

`get_action_script(fullObjectType, actionName)` → the stored script text.
Use it to pull scripts written elsewhere into `scripts/<actionName>.ts`.

## `get_object_class`

`get_object_class(fullObjectType, compact?)` → `{ fullObjectType, type, baseObjectType,
discriminatorField?, discriminatorValue?, discriminatedClasses?, label,
description, indexedFields, foreignKeys: [{ localFieldName,
referenceObjectType, referenceFieldName }], schemas }`.
`discriminatedClasses` (on a discriminated base) maps each value to its
class.

`schemas` is the OpenAPI 3.1 `components.schemas` the app's API exposes for
the class, keyed by full class name: `<fullObjectType>` (read model),
`create--<fullObjectType>--request`, `update--<fullObjectType>--request`, and
every embedded or base class it depends on. `$ref`s use
`#/components/schemas/<full class name>`, the same form `add_object_class`
takes. The read model also carries generated fields (`{field}|Name` per
reference field, relation fields); leave them out when turning it into a
manifest. Use it to adopt a class built elsewhere, or to compare the backend
with `classes/<Class>.json`. The output is large (read, create and update
schemas for the class and every class it relates to), so read the local
manifest when there is one and call this only when it is missing or
suspect. `compact: true` (PR #67) keeps only the class's read schema and
the embedded and base classes it uses.

## `set_class_full_text_search`

`set_class_full_text_search(fullObjectType, isFullTextSearchable)` (PR #67)
turns `#text` search on or off for a top-level class without sending the
class again. Update the manifest's `isFullTextSearchable` to match.

## `get_namespaces` / `get_object_classes`

`get_namespaces()` lists namespaces visible to the account.
`get_object_classes(namespace?)` lists classes under a namespace prefix
(must start with `app.`): name, namespace, description, base class. **It does
not return schemas, indexed fields, or actions.** Use `get_object_class` for
one class in full.

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

## Access, sign-in and users

Owner only: anyone but the app's owner gets an error. All take names, never
ids. The `access-control.md` server resource explains the model; the
`bootstrapp-access` skill explains how to use it.

### Profiles

| Tool | Args | Notes |
|---|---|---|
| `get_profiles` | `appName` | Each profile with description, `inheritsFrom`, user count, `isDefault` (`Admin`), `isSignupProfile`. |
| `add_profile` | `appName`, `profileName`, `description`, `inheritsFrom?`, `copyAccessFrom?` | New profiles have no access. `copyAccessFrom` copies class, field, relation, constraint and action access from another profile. |
| `replace_profile` | `appName`, `profileName`, `description`, `inheritsFrom?` | Omitting `inheritsFrom` removes it. |
| `remove_profile` | `appName`, `profileName`, `reassignUsersTo?` | Deletes the profile and all its access, and drops it from other profiles' `inheritsFrom`. Refuses `Admin`, and refuses a profile with users unless `reassignUsersTo` is given. |

### Class and action access

| Tool | Args | Notes |
|---|---|---|
| `get_class_access` | `fullObjectType`, `profileName?` | Per profile: class permissions, field and relation permissions, constraints. Role entries (account, admin) come back under `otherEntries` and can't be changed through MCP. |
| `replace_class_access` | `fullObjectType`, `profileName`, `permissions`, `fieldPermissions?`, `defaultFieldPermissions?`, `relationPermissions?`, `constraints?` | Replaces everything the profile has on the class. Validates fields (own fields only; base-class fields go on the base class), relations, operators and context keys before writing. `permissions: []` removes access. Refuses `Admin`. Returns the hidden fields, the constraint, and the fields an `Eq` constraint stamps on create. |
| `remove_class_access` | `fullObjectType`, `profileName` | Same as `permissions: []`. |
| `replace_action_access` | `fullObjectType`, `actionName`, `profiles` | Profiles that can see and run the action besides `Admin`. |

`get_actions` lists each action's `profiles`. `replace_object_class` reports
fields it added that other profiles can't see yet and constraints its change
broke; apply the class's access files again after it.

### Sign-in

| Tool | Args | Notes |
|---|---|---|
| `get_app_auth` | `appName` | Providers, sign-up mode, signup profile, tenants, claims, origins and redirects. |
| `replace_app_auth` | `appName`, `providers`, `signup` (`open` \| `invite_only`), `signupProfile`, `providerTenants?`, `calculatedClaims?` | Rewrites providers and their tenants. Keeps redirect URIs, secrets and token settings. Warns when open sign-up uses `Admin`. |
| `add_oidc_client_origin` | `appName`, `origin` | Allows a browser origin (CORS) for the client. Idempotent. |

### Users and organizations

| Tool | Args | Notes |
|---|---|---|
| `get_users` | `appName`, `profileName?`, `search?` | Users holding a profile of the app: name, email, profile, organization, `active` / `invited` / `inactive`. |
| `invite_user` | `appName`, `email`, `profileName`, `name?`, `organizationName?` | Creates an invitation (an inactive user with no sign-ins) that becomes the user on their first sign in with a provider that verifies the email, keeping the same id; if the account already has that email, sets their profile instead. Sends nothing. Reports the user id since PR #67 (`system.user.invite` returns it in scripts). |
| `assign_user_profile` | `appName`, `email`, `profileName` | Applies from the next sign in. |
| `remove_user_access` | `appName`, `email` | Removes the app from the user; the user stays in the account. Refuses the caller. |
| `set_user_organization` | `appName`, `email`, `organizationName` | |
| `get_organizations` | `appName`, `search?` | Every organization in the account, with how many of the app's users are in each. |
| `add_organization` | `appName`, `name`, `email?`, `phone?` | Names are unique in the account. |

### File buckets and folders (BootstrApp PR #69)

Owner only, like the tools above. Buckets and folders belong to the account
and are shared by its apps. Buckets take an id or a name. Only S3 buckets can
be added, since `system.files` needs presigned urls.

| Tool | Args | Notes |
|---|---|---|
| `get_buckets` | `appName` | Id, name, provider, S3 bucket name, `supportsUploadUrls`, `hasCredentials`. Never the keys. |
| `add_bucket` | `appName`, `name`, `remoteName` | `remoteName` is the S3 bucket. Added without credentials: no tool takes keys, so they never pass through the model. The platform owner sets them outside MCP (a key with `s3:PutObject` and `s3:GetObject`); until then `create_folder` refuses the bucket. |
| `update_bucket` | `appName`, `bucket`, `name?`, `remoteName?` | Changes only what is given. Changing `remoteName` clears the bucket's credentials (the platform owner sets new ones outside MCP) and doesn't move stored files. |
| `get_folders` | `appName`, `bucket?` | Id, name, path, bucket and `uploaders` (profile names, plus `elevated scripts`). `system.files.create` takes the bucket and path (the id on servers without BootstrApp PR #71). |
| `create_folder` | `appName`, `bucket`, `path`, `uploadProfiles?` | Creates the missing levels of `path` (`uploads/invoices`) and returns the folder id. `uploadProfiles` are the profiles that may upload to new folders: all of the app's when omitted, none (only elevated scripts) for `[]`. Elevated scripts always may. An existing folder keeps its permissions unless it has none. |
| `get_folder_access` | `appName`, `folder`, `bucket?` | `folder` is an id or a path (`bucket` when the path is in several buckets). Returns `uploadProfiles`, `elevatedScripts` and `otherEntries` (other apps' profiles, users, roles). |
| `replace_folder_access` | `appName`, `folder`, `uploadProfiles`, `bucket?` | Replaces this app's profiles; keeps `otherEntries` and elevated scripts. Folders scripts create under it later copy the new list; existing subfolders keep theirs. |

