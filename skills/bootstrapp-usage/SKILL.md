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
  actions. Treat it as the authoritative design for the current app — the
  project is an ongoing one, not a fresh start.
- The **app name** at the top of the file anchors the base namespace
  `app.<app-name>` under which every class lives (`app.<app-name>.Order`,
  `app.<app-name>.actions.SubmitOrderInput`, etc.). Do not rename it. Keep
  all new classes consistent with this namespace.
- Schema changes go through `/bootstrapp-cloud:design-model`, which
  delegates to the `bootstrapp-schema-architect` to evolve the same
  `BOOTSTRAPP.md` in place.

If `BOOTSTRAPP.md` does not exist, this is a new app. Run
`/bootstrapp-cloud:new-app` — that command handles the full flow: intake
(name, platform, description), folder creation, discovery, schema design,
class creation on the backend via the MCP server, API client generation,
UI scaffold, and starting the dev server.

## Mental model

- **bootstrapp.cloud is the backend.** Data model, auth, storage, and business
  logic live there. You never reimplement those on the client.
- **The MCP server is the control plane.** It lets you inspect a user's
  bootstrapp projects, create resources, and read the concrete API surface the
  client will call.
- **Your code lives on the client.** Claude's job is to generate a thin,
  idiomatic client that talks to the bootstrapp backend — nothing more.
- **The backend exposes two kinds of operations.** Auto-generated CRUD and
  a **filter** endpoint for every top-level class, plus named *actions*
  for anything else. The filter endpoint takes an AND-array of conditions
  (`{field, operator, value?}`) over the operator set
  `Eq, Ne, Gt, Gte, Lt, Lte, In, Exists`. See the
  [`bootstrapp-schema-architect`](../../agents/bootstrapp-schema-architect.md)
  agent for the full contract — value rules per operator, type-matching
  against the field's JSON Schema, and `Exists`/`In` specifics. Actions
  carry the business logic: each has an input class and an output class
  (both defined as JSON Schema in a dedicated actions namespace), full
  read/write access to every class, and runs atomically on the server.
  If a workflow spans multiple documents or enforces invariants, it is
  an action, not a client-side orchestration.
- **Classes live in namespaces rooted at `app.<app-name>`.** The domain
  model sits under `app.<app-name>` and action I/O classes sit under
  `app.<app-name>.actions`. Reference classes in generated code with their
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
filter endpoint with the recorded conditions, renders the view's
`visibleFields` (using `primaryField` for row labels when present), and
applies the view's sort and limit.

For **on-demand filter calls** (queries that aren't registered as a view),
build the request body as `{ conditions: [...] }`. Each condition's
`value` must match the target class's property type: omit it for
`Exists`, pass an array for `In`, pass a scalar otherwise. Reject any
condition whose `field` is not on the target class — the filter will
reject it server-side too. If a query keeps reappearing, route through
`/bootstrapp-cloud:design-model` to register it as a view.

**Sort and limit:** if the OpenAPI spec exposes sort/limit params on the
filter endpoint, pass them. Otherwise sort and slice client-side after
the call. Discover, don't guess.

## Authentication and authorization

bootstrapp.cloud apps authenticate users through **OpenID Connect**.

- **Issuer:** `https://idp.fci.cloud`. Resolve endpoints via OIDC
  discovery (`/.well-known/openid-configuration`) — never hardcode
  authorize / token / userinfo paths.
- **Flow:** Authorization Code with PKCE for browsers and devices. The
  client redirects to the issuer to log in, exchanges the code for
  tokens, and presents the access token on every backend call.
- **Session storage:** platform-appropriate secure store — httpOnly
  cookies on web, OS keychain / `flutter_secure_storage` on
  desktop/mobile, OS-standard config dir for CLIs. Refresh on expiry;
  clear on logout.

The platform already provides the **User** and **Group** classes — they
are not part of any app's `app.<app-name>` namespace and apps must not
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

When the client needs the current user (to show their name, filter
"my X", etc.), read it from the access-token claims after login — do
not infer it from app data.

## Default workflow

For a brand-new app, run `/bootstrapp-cloud:new-app` — it orchestrates
intake → folder creation → discovery → schema design → backend class
creation → client generation → scaffold → auth + slice → dev server +
iteration. The steps below apply when you are working directly on an
existing app (post-orchestration) or when invoking the architect on its
own:

1. **Confirm the MCP server is connected.** If tool calls fail with an auth
   error, tell the user to complete the OAuth browser flow.
2. **Discover before coding.** Call the MCP tools to enumerate projects,
   resources, endpoints, and schemas. Never guess API shapes.
3. **Pick or create a backend project.** Ask the user if it isn't clear.
4. **Sync the backend with `BOOTSTRAPP.md`.** When the blueprint changes,
   re-run class creation via `mcp__bootstrapp__add_object_class` and
   regenerate the API client via the
   [openapi-client-generator skill](../openapi-client-generator/SKILL.md)
   before touching client code that depends on the new shape.
5. **Generate the client.**
   - Use the openapi-client-generator skill — never hand-edit generated
     files.
   - Isolate backend access in a `bootstrapp/` module or package.
   - Load the base URL and any public keys from env vars — never hardcode.
6. **Wire auth first.** OIDC login (Authorization Code with PKCE
   against `https://idp.fci.cloud`), logout, and authenticated requests
   must work end-to-end before you build feature screens. See
   "Authentication and authorization" above for the User/Group model
   and storage rules.
7. **Ship a vertical slice, then iterate.** One real read + one real write
   against the backend, not stubs. Then start the dev server and stay in
   chat to extend the app.
8. **Document.** Update the project README with: how to run, which
   bootstrapp project it points at, and the env vars required.

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
  class's JSON Schema. Don't invent sort/limit params on the filter
  endpoint — discover from the OpenAPI spec or apply client-side.
- Don't skip the OAuth flow message the first time a user runs an MCP tool —
  they need to know a browser window is coming.

## When to escalate to the user

- Multiple bootstrapp projects exist and it isn't clear which one to target.
- The backend is missing a resource or field the requested feature needs
  (ask whether to add it on bootstrapp.cloud or adapt the client).
- Auth configuration is ambiguous (which providers, redirect URIs, etc.).
