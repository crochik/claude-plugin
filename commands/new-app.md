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

## Phase 4b — Action scripts via `bootstrapp-action-scripter`

Once the schema is settled, the `bootstrapp-architect` invokes the
**`bootstrapp-action-scripter`** subagent. It reads `BOOTSTRAPP.md`
plus every `schemas/app.<app_name>[.<sub>].actions.md`, drafts an
ApiScript pseudo-implementation for each action in the registry,
presents the drafts in chat for confirmation, and writes
`scripts/<ActionsNamespace>.md` — one file per actions namespace,
parallel to `schemas/`. The scripts are design artifacts that travel
with the blueprint; they are not compiled into the client and do not
require the backend to be live yet.

## Phase 5 — Create classes on the backend

Hand back to the **`bootstrapp-architect`**. It will:

- Read `BOOTSTRAPP.md` and every `schemas/*.md` it references, then
  walk the class registry and call
  `mcp__bootstrapp__add_object_class` once per class — passing
  `appName` (from `BOOTSTRAPP.md`), `fullObjectType`, `type`
  (`TopLevel` / `Embedded`), `schema` (with `title` + `description`
  on the root and on every property), `indexedFields` (verbatim
  from the schemas file — `[]` for embedded classes), `foreignKeys`
  (built from the References registry rows whose source is this
  class — entries of `{ localFieldName: <sourceField>,
  referenceObjectType: <target.FullClassName>,
  referenceFieldName: <targetField> }`), and
  `baseObjectType` for classes that extend another.
- Verify with `mcp__bootstrapp__get_object_classes` (and
  `mcp__bootstrapp__get_class_schema` /
  `mcp__bootstrapp__get_namespaces` when finer-grained checks help).
- Walk the action registry and call
  `mcp__bootstrapp__register_action` once per action — passing
  `fullObjectType`, `actionName`, `actionSummary`,
  `actionDescription`, `actionInputObjectType`,
  `actionOutputObjectType`, and the action's **scope**
  (`instance` / `bulk` / `class`) on the corresponding
  `register_action` parameter.

## Phase 6 — Generate the API client

The architect invokes the
[openapi-client-generator](../skills/openapi-client-generator/SKILL.md)
skill. Phase 6 strictly depends on Phase 5: the OpenAPI spec is
generated from current backend state, so every class and action must
already be registered before calling
`mcp__bootstrapp__generate_openapi_spec` (with `applicationName` set
to the app name in `BOOTSTRAPP.md`). The skill then downloads and
saves the spec locally, and **only after the spec file is on disk**
runs `generate_api.sh` against it to emit the typed client. Do not
collapse these into one step or run the generator against a stale
file.

## Phase 7 — Scaffold the UI app

The architect runs the platform's official scaffolder in the project
folder:

- **Web** → `npm create vite@latest` (TypeScript + React by default).
- **Mobile (Flutter)** → `flutter create`.
- **Desktop** → the framework the user picked in Phase 1.
- **CLI** → the platform's idiomatic generator.

Then it drops in the generated client + a thin `bootstrapp` module,
wires login / logout / session against the backend, and adds one real
read + one real write screen against live data.

## Phase 8 — Start the UI and iterate

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
