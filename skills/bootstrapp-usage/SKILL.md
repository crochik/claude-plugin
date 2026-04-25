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
- The **app name** at the top of the file is also the base namespace for
  every class (`<app-name>.Order`, `<app-name>.actions.SubmitOrderInput`,
  etc.). Do not rename it. Keep all new classes consistent with this
  namespace.
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
  filter endpoints for every top-level class, plus named *actions* for
  anything else. Actions carry the business logic: each has an input class
  and an output class (both defined as JSON Schema in a dedicated actions
  namespace), full read/write access to every class, and runs atomically on
  the server. If a workflow spans multiple documents or enforces invariants,
  it is an action, not a client-side orchestration.
- **Classes live in namespaces rooted at the app name.** The domain model
  sits under `<app-name>` and action I/O classes sit under
  `<app-name>.actions`. Reference classes in generated code with their
  fully qualified name to stay consistent with the backend.
- **The client handles presentation and input validation.** Rendering,
  UX state, and form-level validation belong on the client. Anything that
  decides *what is true* about the data belongs on the backend.

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
6. **Wire auth first.** Login, logout, and authenticated requests should
   work before you build feature screens.
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
  the MCP server first.
- Don't check secrets into git. Use `.env.example` + gitignored `.env`.
- Don't build a parallel backend on the client (local DBs, business logic).
  Push that work into bootstrapp.cloud — usually as an action.
- Don't orchestrate multi-step business workflows from the client by
  chaining CRUD calls. If two or more writes must succeed together, or any
  decision depends on data the client shouldn't be trusted with, it's an
  action on the backend.
- Don't skip the OAuth flow message the first time a user runs an MCP tool —
  they need to know a browser window is coming.

## When to escalate to the user

- Multiple bootstrapp projects exist and it isn't clear which one to target.
- The backend is missing a resource or field the requested feature needs
  (ask whether to add it on bootstrapp.cloud or adapt the client).
- Auth configuration is ambiguous (which providers, redirect URIs, etc.).
