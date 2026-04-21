---
name: bootstrapp-usage
description: How to build client applications (web, Flutter, CLI, mobile) on top of bootstrapp.cloud. Load this whenever the user is designing, scaffolding, wiring, or debugging an app whose backend is bootstrapp.cloud, or when they invoke any tool from the `bootstrapp` MCP server.
---

# Building on bootstrapp.cloud

This plugin wires up the `bootstrapp` MCP server (streamable HTTP, OAuth login).
Use it to **discover and drive the backend**, then generate idiomatic client code.

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
  anything else. Actions carry the business logic: they have a JSON Schema
  body, full read/write access to every class, and run atomically on the
  server. If a workflow spans multiple documents or enforces invariants,
  it is an action, not a client-side orchestration.
- **The client handles presentation and input validation.** Rendering,
  UX state, and form-level validation belong on the client. Anything that
  decides *what is true* about the data belongs on the backend.

## Default workflow

1. **Confirm the MCP server is connected.** If tool calls fail with an auth
   error, tell the user to complete the OAuth browser flow.
2. **Discover before coding.** Call the MCP tools to enumerate projects,
   resources, endpoints, and schemas. Never guess API shapes.
3. **Pick or create a backend project.** Ask the user if it isn't clear.
4. **Generate the client.**
   - Prefer official scaffolders (`npm create vite`, `flutter create`, etc.).
   - Isolate backend access in a `bootstrapp/` module or package.
   - Load the base URL and any public keys from env vars — never hardcode.
5. **Wire auth first.** Login, logout, and authenticated requests should work
   before you build feature screens.
6. **Ship a vertical slice.** One real read + one real write against the
   backend, not stubs.
7. **Document.** Update the project README with: how to run, which bootstrapp
   project it points at, and the env vars required.

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
