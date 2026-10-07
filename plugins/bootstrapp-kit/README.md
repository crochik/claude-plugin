# bootstrapp-kit

A Claude Code plugin (whose skills also work in other agent harnesses) for
building apps on the [BootstrApp](https://bootstrapp.cloud) PaaS, or moving an
existing app's backend onto it.

It is the successor experiment to the `bootstrapp` plugin at the root of this
repository. Same platform, different approach:

| | `bootstrapp` (original) | `bootstrapp-kit` |
|---|---|---|
| Entry | `/bootstrapp:new-app` runs a fixed 12-phase flow from an empty folder | Any command or plain request, from any state; nothing is required to run first |
| Existing apps | Refuses non-empty folders without `BOOTSTRAPP.md` | First-class: `/bootstrapp-kit:migrate` inventories the codebase and plans slices |
| Source of truth | Markdown blueprint (`BOOTSTRAPP.md` + `schemas/*.md`) | JSON manifests that are the exact MCP tool arguments, plus an `applied.json` ledger |
| Knowledge | Mostly inside agent prompts | In skills (portable), with agents as optional helpers |
| Checks | Manual checklists | `bootstrapp-state.mjs` (manifests, diff, sync plan) and `check-apiscript.mjs` (script lint against `platform.d.ts`) |
| Script runtime | `function execute` only | Matches the runtime: `input` global, `return execute(input);` |

## What's inside

```
skills/
  bootstrapp/                core guide: folder layout, MCP tools, state, sync, platform notes
  bootstrapp-object-types/   ObjectType design for MongoDB (data model = API model)
  bootstrapp-actions/        when an action is needed; scope, input/output classes
  bootstrapp-apiscript/      writing and checking ApiScripts against platform.d.ts
  bootstrapp-client/         OpenAPI spec → typed client → wrapper → auth
  bootstrapp-migration/      inventory, mapping and slice plan for existing apps
agents/
  bootstrapp-migration-analyst   read-only codebase analysis → MIGRATION.md
  bootstrapp-modeler             drafts class/action manifests
  bootstrapp-script-author       writes/ports ApiScripts
commands/
  /bootstrapp-kit:status   /bootstrapp-kit:init     /bootstrapp-kit:model
  /bootstrapp-kit:action   /bootstrapp-kit:sync     /bootstrapp-kit:client
  /bootstrapp-kit:migrate
```

The commands are shortcuts. Asking in plain words ("add an approval action
to expenses", "move the orders API of this app to BootstrApp") loads the same
skills.

## Install

```
/plugin marketplace add crochik/claude-plugin
/plugin install bootstrapp-kit@bootstrapp
```

Or from a checkout: `claude --plugin-dir ./plugins/bootstrapp-kit`.

Install either this plugin or the original one in a session, not both: both
bundle the `bootstrapp` MCP server and their guidance differs.

The helper scripts need Node 18+. The first MCP call opens a browser to log
in to BootstrApp.

## The app folder

Everything lands in `bootstrapp/` at the root of the user's repository:
`app.json`, `classes/*.json`, `actions/*.json`, `scripts/*.ts`,
`generated/` (platform.d.ts, openapi.yaml), `applied.json`, and for
migrations `MIGRATION.md`. Commit it; it is the record of what the backend
has, since the MCP server cannot return full class definitions.

## Other harnesses

See [AGENTS.md](AGENTS.md).
