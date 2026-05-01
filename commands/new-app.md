---
description: Create a new app on bootstrapp.cloud end-to-end — intake, schema design, backend class creation, client generation, UI scaffold, and iterate.
argument-hint: [<short intent, optional>]
---

# /bootstrapp:new-app

The user wants to create a new application that uses **bootstrapp.cloud**
as its backend. This command orchestrates the entire flow from a blank
parent directory through a running, iterating UI.

Arguments passed by the user: `$ARGUMENTS`

If `$ARGUMENTS` is non-empty, treat it as the user's initial intent and
**skip any intake question it already answers** (e.g. "flutter app for
tracking expenses" answers platform and gives a description — only the
app name still needs asking).

## Phase 0 — Pre-flight

Before any other step, look at the current working directory:

- If `BOOTSTRAPP.md` is present in the cwd, the user is already inside an
  existing app. **Stop** and tell them:
  - For schema-only changes, run `/bootstrapp:design-model`.
  - For implementation work, invoke the `bootstrapp-architect` agent
    directly.
  Do not run the new-app flow on top of an existing app.
- Otherwise, proceed. Do **not** check whether the directory is empty —
  this command will create its own folder in Phase 2.

## Phase 1 — Intake (3 questions)

Ask the user, in order, only the questions not already answered by
`$ARGUMENTS`. **Use the `AskUserQuestion` tool for any question that
has a discrete set of options** (platform, mobile/desktop/CLI choice,
desktop framework). Use plain text for open-ended questions (app name,
detailed description).

1. **App name** — must be **snake_case**: lowercase letters, digits, and
   underscores only, **no hyphens, no spaces, no camelCase**. The app
   name is reused as a namespace segment, and namespace segments must be
   plain identifiers. Examples: `expense_tracker`, `franchisor`,
   `order_book`. This becomes the suffix of the base namespace
   `app.<app_name>`. **It is not the folder name** — the folder is
   always `bootstrapp` (see Phase 2). Open-ended; ask in plain text. If
   you propose a name yourself, propose it already in snake_case. If
   the user replies with a name containing hyphens, spaces, or
   camelCase, convert it to snake_case and confirm the corrected name
   before proceeding.
2. **Platform** — `web` or `other`. Use `AskUserQuestion`.
   - If `web`: default to React + Vite (TypeScript). Ask only if the user
     signals a preference for something else (Next.js, SvelteKit, etc.).
   - If `other`: drill down once with `AskUserQuestion`.
     - **Mobile** → default to Flutter.
     - **Desktop** → ask which framework via `AskUserQuestion`
       (Tauri, Electron, native — no default; the choice is too
       workload-dependent).
     - **CLI** → only if the user explicitly asks.
3. **Detailed description** — what the app does, who uses it, and the
   handful of features that matter for the first slice. Encourage a
   paragraph, not a one-liner. Open-ended; ask in plain text.

## Phase 2 — Create the directory

From the current working directory, run `mkdir bootstrapp && cd bootstrapp`.
The folder is **always** named `bootstrapp` — independent of the app name
chosen in Phase 1. If a `bootstrapp` folder already exists in the cwd,
stop and ask the user how to proceed (pick a different parent directory,
remove the existing folder, or rename it) rather than writing into it.
After this point all subsequent work happens inside the new folder. Tell
the user the folder you created.

## Phase 3 — Discovery via `bootstrapp-architect`

Invoke the **`bootstrapp-architect`** subagent. Pass it:

- The app name, platform (and sub-choice), and full description.
- Any other context the user has shared in this conversation.

The agent will:

- Confirm the `bootstrapp` MCP server is connected (and surface the OAuth
  browser flow if not).
- Ask 1–2 short rounds of clarifying questions about scope, target users,
  and the smallest meaningful first slice.
- Offer concrete feedback or alternative scoping when the description is
  fuzzy or over-broad.

Do not let the agent skip the discovery exchange — the schema architect
needs the clarified description.

## Phase 4 — Schema design via `bootstrapp-schema-architect`

Once discovery is settled, invoke the **`bootstrapp-schema-architect`**
subagent. Pass it the app name, platform, and the clarified description.
It will:

- Design namespaces, classes, embeddings, references, relations, and
  actions.
- **Present the proposed design in chat** and wait for the user's
  confirmation before writing.
- Write the blueprint as **`BOOTSTRAPP.md`** (the index) plus one
  **`schemas/<Namespace>.md`** file per namespace in the project root.
  The index holds registry tables; the schemas files hold the full
  JSON Schemas (and, for an actions namespace, full action
  definitions).

## Phase 5 — Create classes and register actions on the backend

Hand back to the **`bootstrapp-architect`**. It will:

- **Initialize the app on the backend** by calling
  `mcp__bootstrapp__init_app` exactly once with `appName`,
  `appTitle`, and `appDescription` from the App section of
  `BOOTSTRAPP.md`. This must run **before** any
  `add_object_class` or `register_action` call — it provisions the
  app record and its OIDC client. `init_app` is a one-time
  creation step; only `/bootstrapp:new-app` calls it.
  `/bootstrapp:design-model` and incremental architect runs on an
  existing app must skip it.
- Read `BOOTSTRAPP.md` and every `schemas/*.md` it references, then
  call `mcp__bootstrapp__add_object_class` once per row of the class
  registry — passing `appName` (from `BOOTSTRAPP.md`),
  `fullObjectType`, `type` (`TopLevel` / `Embedded`), `schema` (with
  `title` + `description` on the root and on every property),
  `indexedFields` (verbatim from the schemas file — `[]` for
  embedded classes), `foreignKeys` (built from the References
  registry rows whose source is this class — entries of
  `{ localFieldName: <sourceField>,
  referenceObjectType: <target.FullClassName>,
  referenceFieldName: <targetField> }`), and `baseObjectType` for
  classes that extend another. Then call
  `mcp__bootstrapp__register_action` once per row of the action
  registry — passing `fullObjectType`, `actionName`,
  `actionSummary`, `actionDescription`, `actionInputObjectType`,
  `actionOutputObjectType`, and `scope` (capitalized to match the
  tool's enum: `Instance` / `Bulk` / `Class`). **`register_action`
  no longer takes `actionScript`** — the body is attached
  separately in Phase 9 via `mcp__bootstrapp__update_action_script`,
  after the OpenAPI spec has been refreshed so the scripter can
  draft against an up-to-date `Reference/platform-modules.d.ts`.
  **All `add_object_class` and `register_action` calls in this
  phase are independent of each other and of class-to-class
  dependencies — fire them in parallel.** The backend resolves
  inheritance, embeddings, references, and action
  input/output/target links after the fact, so order does not
  matter; a class does not need to exist before another references
  it, and an action does not need to wait for its target/input/output
  classes.
- Verify with `mcp__bootstrapp__get_object_classes` (and
  `mcp__bootstrapp__get_class_schema` /
  `mcp__bootstrapp__get_namespaces` when finer-grained checks help)
  only after the parallel batch finishes.

## Phase 6 — Generate the OpenAPI spec

Once Phase 5 has registered every class and action, the architect
calls `mcp__bootstrapp__generate_openapi_spec` with
`applicationName` set to the app name in `BOOTSTRAPP.md`. This
call returns a URL pointing at the freshly regenerated spec for
the app, **and** as a side effect refreshes the
`Reference/platform-modules.d.ts` MCP resource so it includes the
typed runtime helpers for the app's classes — the action scripter
will read it in Phase 8. The architect downloads the spec to a
local file (default: `openapi.json` at the project root) and
confirms the file is non-empty and well-formed.

## Phase 7 — Generate the typed API client

The architect resumes the
[openapi-client-generator](../skills/openapi-client-generator/SKILL.md)
skill from the saved-spec step: it runs `generate_api.sh` against
the spec file written in Phase 6 to emit the typed client. The
spec already reflects every class and action (registered in
Phase 5); action scripts are server-side bodies that do not
appear in the API surface, so client generation does not depend
on them and a second `generate_openapi_spec` call is never
needed.

## Phase 8 — Action scripts via `bootstrapp-action-scripter`

With the spec generated in Phase 6 (and therefore
`Reference/platform-modules.d.ts` refreshed), the
`bootstrapp-architect` invokes the **`bootstrapp-action-scripter`**
subagent. It reads `BOOTSTRAPP.md`, every
`schemas/app.<app_name>[.<sub>].actions.md`,
`Reference/platform-modules.d.ts`, and any domain schemas the
actions touch. It drafts an ApiScript pseudo-implementation for
each action in the registry, presents the drafts in chat for
confirmation, and writes `scripts/<ActionsNamespace>.md` — one
file per actions namespace, parallel to `schemas/`. These scripts
are **server-side action bodies** that Phase 9 ships to the
backend via `mcp__bootstrapp__update_action_script`. The scripter
does not call any MCP tool that mutates the backend.

Phases 7 (client generation), 8 (scripter), and 9 (attach scripts)
are independent of each other — nothing in client generation or UI
scaffolding depends on action scripts being on disk or attached,
and the scripter only needs `Reference/platform-modules.d.ts` to
have been refreshed in Phase 6. The architect can run Phases 7–9
in any order (or in parallel) as long as Phase 9 follows Phase 8
and all three precede the user invoking any action. The order
shown is the canonical readable default.

## Phase 9 — Attach action scripts to the backend

The `bootstrapp-architect` walks the action registry and calls
`mcp__bootstrapp__update_action_script` once per action — passing
`fullObjectType` (the action's target class), `actionName`, and
`actionScript` (the fenced ```typescript block from the action's
section in `scripts/<ActionsNamespace>.md`, passed verbatim — the
`import` statements and the `execute` function). **Fire every
`update_action_script` call in parallel** — they are independent
of each other. Until a script is attached, the action endpoint
exists in the OpenAPI spec but executing it is a no-op; this
phase must therefore complete before the user invokes any action.
If a `scripts/*.md` file is missing or has no matching section
for an action, stop and re-invoke `bootstrapp-action-scripter`
before retrying.

## Phase 10 — Scaffold the UI app

The architect runs the platform's official scaffolder in the project
folder:

- **Web** → `npm create vite@latest` (TypeScript + React by default).
- **Mobile (Flutter)** → `flutter create`.
- **Desktop** → the framework the user picked in Phase 1.
- **CLI** → the platform's idiomatic generator.

Then it drops in the generated client + a thin `bootstrapp` module,
wires login / logout / session against the backend, and adds one real
read + one real write screen against live data. As part of auth
wiring it calls `mcp__bootstrapp__add_oidc_client_redirect` once
per redirect URL the client will use (the dev server URL plus
OIDC callback path, and any production origin the user names) so
the OIDC issuer accepts login redirects.

## Phase 11 — Start the UI and iterate

The architect starts the dev server in the background, surfaces the URL
or output, and **stays in chat** to add features, fix issues, and respond
to user feedback until the user signals the app is complete.

## Rules

- **Don't invent bootstrapp.cloud APIs.** Always confirm via the MCP
  server.
- **Don't commit secrets.** `.env` must be gitignored; only `.env.example`
  is committed.
- **Don't over-engineer.** Ship a minimal, working vertical slice — not
  a framework — before iterating.
- **If the MCP server is not connected**, stop and ask the user to enable
  the `bootstrapp` plugin / complete the OAuth flow before continuing.
