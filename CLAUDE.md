# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A **Claude Code plugin marketplace** (not an application) for the BootstrApp
PaaS. Plugins live under [plugins/](./plugins/) and are listed in
[.claude-plugin/marketplace.json](./.claude-plugin/marketplace.json), which lets
users install them via `/plugin marketplace add crochik/claude-plugin`.

There is no build step or lint configuration: artifacts are Markdown, JSON and
a few dependency-free Node 18+ helper scripts, loaded by Claude Code at
runtime. Changes ship by committing files in the correct locations.

The root [.mcp.json](./.mcp.json) only makes the `bootstrapp` MCP server
available when working in this repo; each plugin bundles its own `.mcp.json`.

## Plugins

- **[plugins/bootstrapp-kit](./plugins/bootstrapp-kit/)** — the developer
  plugin: design and apply the backend (classes, actions, scripts, access),
  generate the typed client, scaffold a UI, and migrate existing apps. It
  replaced the original rigid-flow `bootstrapp` plugin that used to sit at the
  repo root.
- A future **`bootstrapp`** plugin will access an app's data from the
  user/app perspective. The name is reserved for it; don't reuse it for
  developer tooling.

## License

The repo is proprietary to Crochik Software Solutions, LLC (see
[LICENSE](./LICENSE) and the copy in the plugin). Never add MIT or any other
open-source license text, badge or `"license"` value. New skills carry the
`license:` frontmatter line and new scripts the copyright header, like the
existing ones.

## Local development

```
claude --plugin-dir ./plugins/bootstrapp-kit
```

The `bootstrapp` MCP server is remote (streamable HTTP with OAuth). The first
tool call opens a browser to log in; sessions are cached afterward.

## bootstrapp-kit conventions

The kit's own files are the source of truth; preserve these when extending:

- Knowledge lives in **skills** (Agent Skills format, usable by other
  harnesses); agents and commands are thin and optional. Commands are
  shortcuts that load skills (`/bootstrapp-kit:new-app` is the guided path
  for a new app; the rest work from any state).
- The app record is `bootstrapp/` in the user's repo: JSON manifests that are
  the exact MCP tool arguments (`classes/`, `actions/`), `scripts/*.ts`,
  `generated/`, and an `applied.json` ledger.
- Helper scripts are dependency-free Node 18+ (`bootstrapp-state.mjs`,
  `check-apiscript.mjs`). Test them against a scratch `bootstrapp/` folder
  after changing them.
- Access control (profiles, class/field access, constraints, action access,
  sign-in) is manifests too: `profiles/`, `access/<Profile>/`,
  `access/actions/`, `auth.json`, taught by the `bootstrapp-access` skill.
  Users and organizations are data and have no manifests.
- Platform facts it relies on (tool behavior, script runtime, known gaps) are
  in `skills/bootstrapp/references/platform-notes.md`; update that file when
  the platform changes.
- **Discover, don't guess.** Client code and scripts only use endpoints,
  fields, functions and auth settings that the manifests, `generated/` files
  or the MCP server confirm.
- **Default to the client; use actions only when forced** (server-side side
  effects, atomic multi-write work, computation over data the client
  shouldn't fetch). Authorization is never the reason: the backend enforces
  access on every CRUD, filter and action call.
- **Scripts run with the caller's access unless elevated.** Elevated is only
  for steps the caller's profile must not do freely, and the script then
  checks the caller via `system.session`.
- **Namespaces are load-bearing.** Domain classes live in `app.<app_name>`,
  action I/O classes in `app.<app_name>.actions`; payload classes are never
  reused domain classes.
- **One working vertical slice** (sign-in, one real read, one real write)
  before anything elaborate. `.env.example` is committed, `.env` is gitignored.

## Outstanding item

Confirm the canonical production URL for the bootstrapp.cloud MCP endpoint
before relying on the `.mcp.json` files in a published release.
