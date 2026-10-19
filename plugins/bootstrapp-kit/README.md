# bootstrapp-kit

A Claude Code plugin (whose skills also work in other agent harnesses) for
building apps on the [BootstrApp](https://bootstrapp.cloud) PaaS, or moving an
existing app's backend onto it.

It replaces the original `bootstrapp` plugin that used to live at the root of
this repository: no fixed flow, works from any state (empty repo, existing
codebase, half-applied app), keeps the app record as JSON manifests that are
the exact MCP tool arguments, and puts its knowledge in portable skills.
`/bootstrapp-kit:new-app` is the guided path for a brand-new app, from intake
to a running UI.

## What's inside

```
skills/
  bootstrapp/                core guide: folder layout, MCP tools, state, sync
  bootstrapp-object-types/   ObjectType design for MongoDB (data model = API model)
  bootstrapp-actions/        when an action is needed; scope, input/output classes
  bootstrapp-access/         profiles, permissions, row constraints, sign-in, users
  bootstrapp-apiscript/      writing and checking ApiScripts against platform.d.ts
  bootstrapp-client/         OpenAPI spec → typed client → wrapper → auth
  bootstrapp-migration/      inventory, mapping and slice plan for existing apps
agents/
  bootstrapp-migration-analyst   read-only codebase analysis → MIGRATION.md
  bootstrapp-modeler             drafts class/action manifests
  bootstrapp-script-author       writes/ports ApiScripts
commands/
  /bootstrapp-kit:new-app  /bootstrapp-kit:status   /bootstrapp-kit:init
  /bootstrapp-kit:model    /bootstrapp-kit:action   /bootstrapp-kit:sync
  /bootstrapp-kit:client   /bootstrapp-kit:migrate  /bootstrapp-kit:access
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

The helper scripts need Node 18+. The first MCP call opens a browser to log
in to BootstrApp. Your BootstrApp user needs developer access (granted by a
platform administrator) for the app tools; without it the server only
offers the tools that read and write records.

## The app folder

Everything lands in `bootstrapp/` at the root of the user's repository:
`app.json`, `classes/*.json`, `actions/*.json`, `scripts/*.ts`,
`shared/` (shared scripts), `events/` (class event scripts), `webhooks/` (inbound webhooks),
`profiles/*.json`, `access/`, `auth.json`,
`generated/` (platform.d.ts, openapi.yaml), `applied.json`, and for
migrations `MIGRATION.md`. Commit it: the manifests are the record of
intent and `applied.json` of what was pushed when, which the backend's API
form of each class doesn't keep.

## Other harnesses

See [AGENTS.md](AGENTS.md).

## License

Copyright (c) 2026 Crochik Software Solutions, LLC. All rights reserved.
Proprietary, not open source: any use requires agreeing to CSS's license terms
and prior written authorization from CSS. See [LICENSE](LICENSE).
