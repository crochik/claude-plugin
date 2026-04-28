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
- **The backend exposes two kinds of operations.** Auto-generated CRUD and
  a **filter** endpoint for every top-level class, plus named *actions*
  for anything else. The filter endpoint takes an AND-array of conditions
  (`{field, operator, value?}`) over the operator set
  `Eq, Ne, Gt, Gte, Lt, Lte, In, Exists` **and a required `fields`
  array** naming the top-level properties to return on each match
  (the backend projects to that list — it does not return the full
  document by default; `_id` is always included). **Conditions are
  only valid on a class's indexed fields** (declared at registration
  time via `add_object_class`'s `indexedFields` argument and recorded
  in the schemas file); the backend rejects conditions on non-indexed
  properties. See the
  [`bootstrapp-schema-architect`](../../agents/bootstrapp-schema-architect.md)
  agent for the full contract — value rules per operator, type-matching
  against the field's JSON Schema, and `Exists`/`In` specifics. Actions
  carry the business logic: each has an input class and an output class
  (both defined as JSON Schema in a dedicated actions namespace), full
  read/write access to every class, and runs atomically on the server.
  If a workflow spans multiple documents or enforces invariants, it is
  an action, not a client-side orchestration.
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

For **on-demand filter calls** (queries that aren't registered as a view),
build the request body as `{ conditions: [...], fields: [...] }`. Each
condition's `value` must match the target class's property type: omit
it for `Exists`, pass an array for `In`, pass a scalar otherwise. The
`fields` array is required and must explicitly list every top-level
property the caller intends to read on the response (`_id` always comes
back; everything else only comes back if named). Reject any condition
whose `field` is not on the target class **or is not in the class's
`indexedFields` list** — the filter will reject it server-side too.
Reject any entry in `fields` that is not a property of the target
class for the same reason. If a query needs a non-indexed field, route through
`/bootstrapp:design-model` to add the field to `indexedFields`
and re-run class creation; if the same query keeps reappearing,
register it as a named view at the same time.

**Sort and limit:** if the OpenAPI spec exposes sort/limit params on the
filter endpoint, pass them. Otherwise sort and slice client-side after
the call. Discover, don't guess.

## Authentication and authorization

bootstrapp.cloud apps authenticate users through **OpenID Connect**.

- **Issuer:** `https://idp.fci.cloud`. Resolve endpoints via OIDC
  discovery (`/.well-known/openid-configuration`) — never hardcode
  authorize / token / userinfo paths.
- **Flow — TypeScript clients (web/Vite/React/Next/etc.):** OAuth 2.0
  **Implicit** grant. The client redirects to the issuer's authorize
  endpoint with `response_type=token id_token`, receives tokens in the
  redirect fragment, and presents the access token on every backend
  call. The OIDC **`client_id` is the app name** (the same snake_case
  identifier that anchors `app.<app_name>` — lowercase letters, digits,
  and underscores only; no hyphens) — do not invent a separate client
  ID and do not load it from env.
- **Flow — every other platform (Flutter, mobile, desktop, CLI):**
  Authorization Code with PKCE. Load the OIDC `client_id` from env.
- **Scopes:** the issuer **does not accept the `email` scope** (or
  any other profile-style scope) in the authorize request — asking
  for it will fail the flow. Request only `openid` (plus `id_token`
  via `response_type` for the Implicit flow). User profile data
  (`name`, `email`, group membership, etc.) is already embedded as
  claims in the access token; decode the JWT and read claims directly
  rather than calling a userinfo endpoint or asking for extra scopes.
- **Session storage:** platform-appropriate. For TypeScript web apps,
  the implicit-flow access token lives in memory plus
  `sessionStorage` (cleared on tab close) — not `localStorage`, and
  not exposed to third-party scripts. For Flutter/mobile/desktop, use
  the OS keychain or `flutter_secure_storage`. For CLIs, an
  OS-standard config dir. Refresh on expiry where the flow allows;
  clear on logout in every case.

The platform already provides the **User** and **Group** classes — they
are not part of any app's `app.<app_name>` namespace and apps must not
redefine them.

- **User** — has an `id` (UUID string) and belongs to exactly one
  Group. Apps reference users by storing the UUID in a string field
  (e.g. `ownerId: string`), the same way any other cross-document
  reference works.
- **Group** — has an `id` and a `name`. Group membership is what
  governs access.
- **Authorization is group-based and enforced by the backend** on
  every object, action, and view. The client never decides what a
  user is allowed to do; it issues the call and surfaces whatever
  the backend returns (including authorization rejections). Do not
  replicate the access policy on the client.

When the client needs the current user (to show their name or
email, filter "my X", etc.), decode the access-token JWT and read
it from the claims after login — do not infer it from app data, do
not request extra scopes (the issuer rejects `email`/profile
scopes), and do not call a userinfo endpoint. `name`, `email`, and
group membership all arrive as claims on the token.

**Every app must expose a user-initiated way to start the login
flow** — a Login button on web, a sign-in screen on mobile/desktop,
a `login` subcommand on a CLI. Unauthenticated users (first visit,
expired session, post-logout) must always see an obvious affordance
to begin authentication; do not rely on automatic redirects alone.

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
   re-run class creation via `mcp__bootstrapp__add_object_class` and
   regenerate the API client via the
   [openapi-client-generator skill](../openapi-client-generator/SKILL.md)
   before touching client code that depends on the new shape.
4. **Generate the client.**
   - Use the openapi-client-generator skill — never hand-edit generated
     files.
   - Isolate backend access in a `bootstrapp/` module or package.
   - Load the base URL and any public keys from env vars — never hardcode.
5. **Wire auth first.** OIDC login against `https://idp.fci.cloud`
   (Implicit flow with `client_id = <app_name>` for TypeScript
   clients; Authorization Code with PKCE for everything else),
   logout, and authenticated requests must work end-to-end before you
   build feature screens. See "Authentication and authorization"
   above for the per-platform flow, the `client_id` rule, the
   User/Group model, and storage rules.
6. **Ship a vertical slice, then iterate.** One real read + one real write
   against the backend, not stubs. Then start the dev server and stay in
   chat to extend the app.
7. **Document.** Update the README with how to run the app and the env
   vars required.

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

- Don't invent endpoints, field names, or auth flows. Always verify through
  the MCP server first. The OIDC issuer is fixed at
  `https://idp.fci.cloud`; everything else is discovered.
- Don't redefine `User` or `Group` in the app namespace — they are
  platform classes. Reference users by storing their UUID in a string
  field. Don't reimplement group-based access control on the client;
  the backend enforces it.
- Don't check secrets into git. Use `.env.example` + gitignored `.env`.
- Don't build a parallel backend on the client (local DBs, business logic).
  Push that work into bootstrapp.cloud — usually as an action.
- Don't orchestrate multi-step business workflows from the client by
  chaining CRUD calls. If two or more writes must succeed together, or any
  decision depends on data the client shouldn't be trusted with, it's an
  action on the backend.
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
