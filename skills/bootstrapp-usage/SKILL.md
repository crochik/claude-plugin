---
name: bootstrapp-usage
description: How to build client applications (web, Flutter, CLI, mobile) on top of bootstrapp.cloud. Load this whenever the user is designing, scaffolding, wiring, or debugging an app whose backend is bootstrapp.cloud, or when they invoke any tool from the `bootstrapp` MCP server.
---

# Building on bootstrapp.cloud

This plugin wires up the `bootstrapp` MCP server (streamable HTTP, OAuth login).
Use it to **discover and drive the backend**, then generate idiomatic client code.

## First thing on every session: look for `BOOTSTRAPP.md`

Before doing any bootstrapp work, check the project root for a file named
`BOOTSTRAPP.md`. If it exists:

- Read it in full. It records the app's name, namespaces, classes, and
  actions. Treat it as the authoritative design for the current app —
  this is an ongoing app, not a fresh start.
- The **app name** at the top of the file anchors the base namespace
  `app.<app_name>` under which every class lives (`app.<app_name>.Order`,
  `app.<app_name>.actions.SubmitOrderInput`, etc.). Do not rename it. Keep
  all new classes consistent with this namespace.
- Schema changes go through `/bootstrapp:design-model`, which
  delegates to the `bootstrapp-schema-architect` to evolve the same
  `BOOTSTRAPP.md` in place.

If `BOOTSTRAPP.md` does not exist, this is a new app. Run
`/bootstrapp:new-app` — that command handles the full flow: intake
(name, platform, description), folder creation, discovery, schema design,
class creation on the backend via the MCP server, API client generation,
UI scaffold, and starting the dev server.

## Mental model

- **bootstrapp.cloud is the backend.** Data model, auth, storage, and business
  logic live there. You never reimplement those on the client.
- **The MCP server is the control plane.** It lets you inspect the
  user's app, create resources, and read the concrete API surface the
  client will call.
- **Your code lives on the client.** Claude's job is to generate a thin,
  idiomatic client that talks to the bootstrapp backend — nothing more.
- **The backend exposes two kinds of operations.** Auto-generated
  CRUD and a **filter** endpoint for every top-level class, plus
  named *actions* for the work the client cannot accomplish by
  chaining those calls. The full filter contract — request shape,
  AND combinator, the operator set, per-operator value rules, the
  indexed-fields constraint, and the required `fields` projection
  — lives in `Reference/filter-operators.json` on the `bootstrapp`
  MCP server; load it before generating any filter call. Actions
  each have an input class and an output class (both defined as
  JSON Schema in a dedicated actions namespace), full read/write
  access to every class, and run on the server; several writes are
  atomic only when the script puts them in a `mongodb` transaction
  (`createTransaction` / `commitTransaction`). Actions
  come in three **scopes** (`instance` / `bulk` / `class`); the
  per-scope required-input-field rules and selection guidance live
  in `Reference/action-scopes.json`. **The default is to do the
  work from the client with CRUD + filter calls** — even when the
  workflow spans multiple classes or several writes. Reach for an
  action only when the client genuinely cannot do the work that
  way: server-side side effects (email, third-party APIs, file
  processing), atomic multi-write transactions where partial
  failure would corrupt state, or computations over data the
  client shouldn't or can't reasonably fetch. Authorization is
  **not** a reason — the backend enforces access rules on every
  CRUD, filter, and action call equally.
- **Classes live in namespaces rooted at `app.<app_name>`.** The domain
  model sits under `app.<app_name>` and action I/O classes sit under
  `app.<app_name>.actions`. Reference classes in generated code with their
  fully qualified name to stay consistent with the backend.
- **The client handles presentation and input validation.** Rendering,
  UX state, and form-level validation belong on the client. Anything that
  decides *what is true* about the data belongs on the backend.

## Named views and filter calls

Named views are saved query configs recorded in `BOOTSTRAPP.md` (registry)
and the target's namespace schemas file (full definition). A view bundles
filter conditions, visible fields, an optional primary label field, and
optional sort/limit. When generating UI, treat each view as a list-screen
specification: a screen named after the view that calls the target's
filter endpoint with the recorded conditions, passes the view's
`visibleFields` as the request's required `fields` projection (adding
any sort/label field that the screen needs but is not already in the
list), renders those fields (using `primaryField` for row labels when
present), and applies the view's sort and limit.

For **on-demand filter calls** (queries that aren't registered as a
view), follow the contract in `Reference/filter-operators.json`
verbatim — request shape, condition shape, per-operator value
rules, and the indexed-fields / `fields` projection requirements
all live there. If a query needs a non-indexed field, route
through `/bootstrapp:design-model` to add the field to
`indexedFields` and re-run class creation; if the same query
keeps reappearing, register it as a named view at the same time.

**Sort and limit:** if the OpenAPI spec exposes sort/limit params on the
filter endpoint, pass them. Otherwise sort and slice client-side after
the call. Discover, don't guess.

## Authentication and authorization

bootstrapp.cloud apps authenticate users through **OpenID Connect**.
The canonical configuration — issuer, OIDC discovery endpoint,
grant type, scope policy (which scopes to request, which the
issuer rejects), `client_id` derivation rules per platform, token
storage guidance, the platform-provided User/Group classes, the
group-based authorization model, and the user-initiated login
entry-point requirement — lives in **`Reference/auth-config.json`**
on the `bootstrapp` MCP server. Load that resource before wiring
auth and treat it as authoritative; do not invent or hardcode any
of it.

The mental model that surrounds the resource:

- Authorization is enforced by the backend on every object, action,
  and view. The client never decides what a user is allowed to do;
  it issues the call and surfaces whatever the backend returns
  (including authorization rejections). Do not replicate the access
  policy on the client.
- Reference users by storing their UUID in a string field
  (e.g. `ownerId: string`), the same way any other cross-document
  reference works. Never redefine `User` or `Group` in the app
  namespace.
- Decode current-user info from access-token JWT claims after login;
  the resource explains why (extra scopes are rejected by the
  issuer, profile claims are already on the token).
- The OIDC client itself is provisioned automatically when the app
  is initialized (`mcp__bootstrapp__init_app`). Each redirect URL
  the client uses (dev origin, deployed origins) must be added to
  the client's allow-list via
  `mcp__bootstrapp__add_oidc_client_redirect` before login will
  succeed against that URL — the issuer rejects redirects that
  aren't on the list.

## Default workflow

For a brand-new app, run `/bootstrapp:new-app` — it orchestrates
intake → folder creation → discovery → schema design → backend class
creation → client generation → scaffold → auth + slice → dev server +
iteration. The steps below apply when you are working directly on an
existing app (post-orchestration) or when invoking the architect on its
own:

1. **Confirm the MCP server is connected.** If tool calls fail with an auth
   error, tell the user to complete the OAuth browser flow.
2. **Discover before coding.** Call the MCP tools to enumerate the
   app's classes, actions, endpoints, and schemas. Never guess API
   shapes.
3. **Sync the backend with `BOOTSTRAPP.md`.** When the blueprint changes,
   add new classes and actions (`mcp__bootstrapp__add_object_class`,
   `mcp__bootstrapp__register_action`), replace changed ones
   (`mcp__bootstrapp__replace_object_class`,
   `mcp__bootstrapp__replace_action`), attach scripts with
   `mcp__bootstrapp__replace_action_script`, and
   regenerate the API client via the
   [openapi-client-generator skill](../openapi-client-generator/SKILL.md)
   before touching client code that depends on the new shape.
4. **Generate the client.**
   - Use the openapi-client-generator skill — never hand-edit generated
     files.
   - Isolate backend access in a `bootstrapp/` module or package.
   - Load the base URL and any public keys from env vars — never hardcode.
5. **Wire auth first.** OIDC login, logout, and authenticated
   requests must work end-to-end before you build feature screens.
   Follow `Reference/auth-config.json` (issuer, grant, scopes,
   `client_id` rule, token storage, User/Group model) — see the
   "Authentication and authorization" section above for the
   surrounding mental model.
6. **Ship a vertical slice, then iterate.** One real read + one real write
   against the backend, not stubs. Then start the dev server and stay in
   chat to extend the app.
7. **Document.** Update the README with how to run the app and the env
   vars required.

## MCP tools at a glance

Tool names follow `get_` (read), `add_` (create; refuses an existing
name), `replace_` (overwrite an existing one), `remove_` (delete).
Only the app's owner can call the per-app tools; anyone else gets an
error.

- **Read the backend:** `get_namespaces`, `get_object_classes` (class
  names in a namespace, no schemas), `get_object_class` (one class in
  full: type, base, indexed fields, foreign keys, OpenAPI schemas),
  `get_actions` (a class's actions, whether each has a script, and who
  can run it), `get_action_script`.
- **Change the model:** `init_app` (once per app), `add_object_class` /
  `replace_object_class` (no record migration; can't change
  TopLevel/Embedded), `register_action` / `replace_action`,
  `replace_action_script` (type-checks the script and wires it so the
  action runs it; rejects invalid scripts with line/column errors).
  Nothing deletes a class or action.
- **Access and sign-in:** `get_profiles`, `add_profile`,
  `replace_profile`, `remove_profile`, `get_class_access`,
  `replace_class_access`, `remove_class_access`,
  `replace_action_access`, `get_app_auth`, `replace_app_auth`,
  `add_oidc_client_redirect`, `add_oidc_client_origin`.
- **Users and organizations** (account-wide, shared by the
  developer's apps): `get_users`, `invite_user`,
  `assign_user_profile`, `remove_user_access`,
  `set_user_organization`, `get_organizations`, `add_organization`.
- **Generate:** `generate_openapi_spec` (client), and
  `generate_platform_definitions` (`scripts/platform.d.ts` for the
  action scripter).

## Client patterns by platform

- **Web (React/Vite/Next):** a `lib/bootstrapp.ts` module exporting a typed
  client. Use React Query / SWR for caching. Store session in httpOnly cookies
  or a secure store — never in plain localStorage for anything sensitive.
- **Flutter:** a `lib/bootstrapp/` package with a `BootstrappClient` class.
  Use `dio` or `http` + `flutter_secure_storage` for tokens. Expose
  repositories, not raw HTTP, to the UI layer.
- **CLI / scripts:** a single module that reads credentials from env or a
  config file in the OS-standard location (e.g. `~/.config/bootstrapp/`).

## Things to never do

- Don't invent endpoints, field names, or auth flows. Always
  verify through the MCP server first. The OIDC config (issuer,
  grant, scopes, `client_id` rule) is fixed by
  `Reference/auth-config.json`; everything else is discovered.
- Don't redefine `User` or `Group` in the app namespace — they are
  platform classes. Reference users by storing their UUID in a string
  field. Don't reimplement group-based access control on the client;
  the backend enforces it.
- Don't check secrets into git. Use `.env.example` + gitignored `.env`.
- Don't build a parallel backend on the client (local DBs, business logic).
  Push that work into bootstrapp.cloud — usually as an action.
- Don't reach for an action when a chain of CRUD + filter calls from
  the client can do the same work — the client is allowed to
  orchestrate multi-step workflows, including across multiple
  classes. Reserve actions for the cases the client genuinely
  cannot cover: server-side side effects (email, third-party APIs,
  file processing), atomic multi-write transactions where partial
  failure would corrupt state, or computations over data the client
  shouldn't or can't reasonably fetch. Authorization is not on
  that list — the backend enforces access rules on every call
  regardless.
- Don't fabricate filter conditions on fields that aren't in the target
  class's JSON Schema, and don't filter on a property that isn't in the
  class's `indexedFields` list — both are server-side rejections.
  Don't invent sort/limit params on the filter endpoint — discover
  from the OpenAPI spec or apply client-side.
- Don't omit the `fields` array on a filter call, and don't expect
  fields you didn't list to come back — the filter response is
  projected to exactly the requested top-level fields (plus `_id`).
  If a screen needs a property, it must be named in `fields`.
- Don't skip the OAuth flow message the first time a user runs an MCP tool —
  they need to know a browser window is coming.

## When to escalate to the user

- The backend is missing a resource or field the requested feature needs
  (ask whether to add it on bootstrapp.cloud or adapt the client).
- Auth configuration is ambiguous (which providers, redirect URIs, etc.).
