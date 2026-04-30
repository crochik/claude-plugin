# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is a **Claude Code plugin** (not an application). There is no build step,
test runner, or lint configuration — every artifact is Markdown or JSON, loaded
directly by Claude Code at runtime. Changes ship by committing files in the
correct locations; the plugin host picks them up on next session.

## Local development

To try changes live, from a repo checkout:

```
claude --plugin-dir .
```

From anywhere else, point `--plugin-dir` at the absolute path of this repo.
There is nothing to compile or install beyond that.

The MCP server (`bootstrapp`) is remote — configured in [.mcp.json](./.mcp.json)
as streamable HTTP with OAuth. The first tool call opens a browser to log in to
bootstrapp.cloud; sessions are cached afterward.

## Architecture

The plugin bundles four artifact types. Each has a fixed location and file
format — add new ones by following the existing pattern, not by inventing a new
layout.

- **[.claude-plugin/plugin.json](./.claude-plugin/plugin.json)** — plugin
  manifest. **[.claude-plugin/marketplace.json](./.claude-plugin/marketplace.json)**
  lets users install via `/plugin marketplace add crochik/claude-plugin`.
- **[.mcp.json](./.mcp.json)** — MCP server config. The `bootstrapp` server is
  the control plane for all backend work; agents and commands reference it by
  that name.
- **[agents/](./agents/)** — subagents (YAML frontmatter + Markdown system
  prompt). Declare `name`, `description`, and `tools` in frontmatter. Keep the
  tool list minimal — a design-only agent should not have Bash or Write access
  to source files.
- **[commands/](./commands/)** — slash commands invoked as
  `/bootstrapp:<name>`. Frontmatter declares `description` and
  `argument-hint`. The body is instructions to Claude; `$ARGUMENTS` interpolates
  user input.
- **[skills/](./skills/)** — auto-loaded guidance. Each skill is a directory
  containing `SKILL.md` whose frontmatter `description` triggers the load.

## Agent responsibility split

The three agents are intentionally separate and should stay that way:

- **[bootstrapp-schema-architect](./agents/bootstrapp-schema-architect.md)** —
  design-only. Produces a backend blueprint (namespaces, classes, inheritance
  with discriminator, embeddings as single/array/dictionary, references,
  relations, and server-side actions — each with an input class and output
  class in a dedicated actions namespace). Never calls MCP tools, never
  writes application code. Invoked from
  [/bootstrapp:new-app](./commands/new-app.md) (Phase 4) for new apps,
  and from [/bootstrapp:design-model](./commands/design-model.md) for
  schema-only changes on existing apps.
- **[bootstrapp-action-scripter](./agents/bootstrapp-action-scripter.md)** —
  design-only, action-implementation layer. Reads `BOOTSTRAPP.md` and the
  actions-namespace schemas files, then writes one
  `scripts/<ActionsNamespace>.md` per actions namespace with an ApiScript
  pseudo-implementation of each action. ApiScript is a simplified TypeScript
  dialect (grammar at [ApiScript.g4](./ApiScript.g4)) that the
  bootstrapp.cloud runtime executes server-side. The agent uses a small
  set of conventional runtime imports (`platform/objects`,
  `platform/email`, `platform/auth`, `platform/time`, `platform/errors`,
  `platform/log`, `platform/http`, `platform/uuid`) and may invent
  additional ones when an action genuinely needs them — flagging the new
  helpers in the script's **External functions used** line. Never touches
  the MCP server, the schemas files, or client code.
- **[bootstrapp-architect](./agents/bootstrapp-architect.md)** —
  discovery, implementation, and iteration. Runs the upfront discovery
  exchange (clarifying scope, offering feedback), hands off to the schema
  architect, then to the action scripter, then drives the `bootstrapp`
  MCP server to create classes from `BOOTSTRAPP.md` and register actions,
  invokes the [openapi-client-generator skill](./skills/openapi-client-generator/SKILL.md)
  to emit the typed client, scaffolds the UI app, wires auth, then starts
  the dev server and stays in chat to iterate with the user. Driven
  end-to-end by [/bootstrapp:new-app](./commands/new-app.md).

Design flows *through* the schema architect, then *through* the action
scripter, *into* the implementation architect — do not collapse them. The
architect handles app-concept discovery (features, scope, users); the
schema architect handles model design (classes, relations, actions); the
action scripter handles each action's pseudo-code body.

## Operating conventions encoded in the plugin

These appear across the agents, commands, and skill. Preserve them when
extending:

- **Backend-first, discover-don't-guess.** Client code only emits endpoints,
  fields, and auth flows that the MCP server confirmed. Never invent API
  shapes.
- **Thin client, fat backend.** Business logic lives in bootstrapp.cloud
  actions (named server-side operations with an input class and an output
  class, and full access to every class). The client handles presentation
  and input validation; it does not orchestrate multi-step workflows by
  chaining CRUD calls.
- **Namespaces are load-bearing.** Domain model and action I/O classes live
  in separate namespaces, both rooted at `app.<app_name>` (the literal
  prefix `app.` followed by the app name); action payload classes are
  never reused domain classes.
- **`BOOTSTRAPP.md` anchors the app; `schemas/` holds the definitions;
  `scripts/` holds the action bodies.** The blueprint is split:
  `BOOTSTRAPP.md` at the project root is the **index** (app identity +
  registry tables for classes, actions, embeddings, references, relations
  — no JSON Schemas), one `schemas/<Namespace>.md` file per namespace
  holds the full class definitions (the actions namespace file also holds
  the full action definitions), and one `scripts/<ActionsNamespace>.md`
  per actions namespace holds the ApiScript pseudo-implementation of
  each action. The schema architect writes the index and schemas files;
  the action scripter writes the script files; the implementation
  architect and any other reader load the index first, then only the
  schemas/scripts files relevant to the change. Invariant: every class
  and action appears in exactly one schemas file *and* exactly one row
  of the matching registry — never one without the other. Every action
  also appears in exactly one script file (in the namespace matching
  its input/output classes). When a user's project already has a
  `BOOTSTRAPP.md`, the index plus schemas/scripts files are the source
  of truth — read them before proposing changes, and never rename the
  app silently.
- **One working vertical slice.** Auth + one real read + one real write beats
  elaborate stubs.
- **Secrets hygiene.** `.env.example` is committed; `.env` is gitignored.
- **Top-level vs embedded is load-bearing.** In the data model, promote to
  top-level only when a class must be queried independently or referenced by
  multiple parents.
- **`/bootstrapp:new-app` creates the app folder.** The orchestrator
  runs intake (name, platform, description) from a parent directory, then
  `mkdir bootstrapp && cd bootstrapp` before invoking any agent. The
  folder is **always** named `bootstrapp` — it is decoupled from the
  app name (the app name is the namespace suffix `app.<app_name>`, not
  the folder). If a `bootstrapp` folder already exists in the cwd, the
  orchestrator stops and asks the user how to proceed. Existing apps
  are detected by the presence of `BOOTSTRAPP.md`; running new-app
  inside an existing app stops and redirects the user to `design-model`
  or direct architect invocation. The empty-folder guard now applies only
  to `/bootstrapp:design-model` and to direct invocation of either
  agent — those entry points still refuse to write into a non-empty
  directory without `BOOTSTRAPP.md`. Preserve this split when editing
  commands or agents.

## Outstanding item

[README.md:72](./README.md#L72) flags a TODO to confirm the canonical
production URL for the bootstrapp.cloud MCP endpoint. Verify before relying on
[.mcp.json](./.mcp.json) in a published release.
