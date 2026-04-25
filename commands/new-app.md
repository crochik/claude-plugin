---
description: Scaffold a new app (web, Flutter, CLI, ...) wired to bootstrapp.cloud as its backend.
argument-hint: [web|flutter|cli|other] <app-name>
---

# /bootstrapp-cloud:new-app

The user wants to create a new application that uses **bootstrapp.cloud** as its backend.

Arguments passed by the user: `$ARGUMENTS`

## Your job

0. **Pre-flight: verify the working directory.** Before any other step:
   - If `BOOTSTRAPP.md` is present in the current directory, this is an
     existing app — treat that file as the source of truth and proceed.
   - If `BOOTSTRAPP.md` is **absent** and the directory is **not empty**
     (ignoring `.git/` and other dotfiles is fine), **stop**. Tell the user
     a new app must be scaffolded into an empty folder, and ask them to
     either `cd` into an empty directory or create one
     (`mkdir <app-name> && cd <app-name>`). Do not write any files until
     the user is in an empty directory or confirms `BOOTSTRAPP.md` should
     be created here despite the existing contents.

1. **Clarify the target** if it isn't obvious from `$ARGUMENTS`:
   - Platform: `web` (React/Vite/Next), `flutter`, `cli`, `mobile-native`, or something else.
   - App name (kebab-case).
   - One-line description of what the app does.

2. **Connect to bootstrapp.cloud** via the MCP server that ships with this plugin
   (server name: `bootstrapp`). On the first tool call the user will be sent through
   an OAuth browser flow — tell them to expect it.

3. **Discover backend capabilities** using the MCP tools. Typical workflow:
   - List the user's existing bootstrapp.cloud projects / workspaces.
   - Either create a new backend project or reuse an existing one.
   - Inspect the backend's data model, auth config, and endpoints.
   - Note any SDK, OpenAPI spec, or client-generation tool bootstrapp exposes.

4. **Scaffold the client project** in the current working directory:
   - Use the idiomatic toolchain for the platform (Vite/Next for web, `flutter create`
     for Flutter, etc.). Prefer running the real scaffolding CLI over hand-writing files.
   - Drop in a thin `bootstrapp` client module that wraps the backend endpoints /
     SDK / OpenAPI client. Keep credentials out of source — read from env.
   - Wire up auth (login / logout / session) end-to-end against the bootstrapp backend.
   - Add one working example screen/route that reads and writes real data via the MCP-discovered API.

5. **Leave the user with**:
   - A `README.md` explaining how to run the app, where backend credentials live,
     and which bootstrapp.cloud project it is wired to.
   - An `.env.example` listing required variables.
   - A short summary in chat: what was created, what still needs the user's input,
     and the exact commands to run it.

## Rules

- Don't invent bootstrapp.cloud APIs — always confirm via the MCP server first.
- If the MCP server is not connected, stop and ask the user to enable the
  `bootstrapp-cloud` plugin / complete the OAuth flow before continuing.
- Don't commit secrets. `.env` must be gitignored; only `.env.example` is committed.
- Don't over-engineer. Ship a minimal, working vertical slice, not a framework.

If the user hands you specific intent (e.g. "flutter app for tracking expenses"),
treat that as source of truth and skip the clarifying questions.
