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
  `/bootstrapp-cloud:<name>`. Frontmatter declares `description` and
  `argument-hint`. The body is instructions to Claude; `$ARGUMENTS` interpolates
  user input.
- **[skills/](./skills/)** — auto-loaded guidance. Each skill is a directory
  containing `SKILL.md` whose frontmatter `description` triggers the load.

## Agent responsibility split

The two agents are intentionally separate and should stay that way:

- **[bootstrapp-schema-architect](./agents/bootstrapp-schema-architect.md)** —
  design-only. Produces a backend blueprint (classes, inheritance with
  discriminator, embeddings as single/array/dictionary, references, relations,
  and server-side actions). Never calls MCP tools, never writes application
  code. Invoked via [/bootstrapp-cloud:design-model](./commands/design-model.md).
- **[bootstrapp-architect](./agents/bootstrapp-architect.md)** —
  implementation. Drives the `bootstrapp` MCP server to inspect/modify the
  backend, then scaffolds idiomatic client code. Invoked via
  [/bootstrapp-cloud:new-app](./commands/new-app.md).

Design flows *through* the schema architect *into* the implementation architect
— do not collapse the two.

## Operating conventions encoded in the plugin

These appear across the agents, commands, and skill. Preserve them when
extending:

- **Backend-first, discover-don't-guess.** Client code only emits endpoints,
  fields, and auth flows that the MCP server confirmed. Never invent API
  shapes.
- **Thin client, fat backend.** Business logic lives in bootstrapp.cloud
  actions (named server-side operations with a JSON Schema body and full
  access to every class). The client handles presentation and input
  validation; it does not orchestrate multi-step workflows by chaining CRUD
  calls.
- **One working vertical slice.** Auth + one real read + one real write beats
  elaborate stubs.
- **Secrets hygiene.** `.env.example` is committed; `.env` is gitignored.
- **Top-level vs embedded is load-bearing.** In the data model, promote to
  top-level only when a class must be queried independently or referenced by
  multiple parents.

## Outstanding item

[README.md:72](./README.md#L72) flags a TODO to confirm the canonical
production URL for the bootstrapp.cloud MCP endpoint. Verify before relying on
[.mcp.json](./.mcp.json) in a published release.
