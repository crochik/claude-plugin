# bootstrapp-cloud plugin for Claude Code

A Claude Code plugin that lets you build apps (web, Flutter, CLI, mobile, ...)
on top of [bootstrapp.cloud](https://bootstrapp.cloud) as the backend.

It bundles:

- **MCP server** (`bootstrapp`) — streamable HTTP, OAuth login — so Claude can
  discover and drive your bootstrapp.cloud projects.
- **Slash command** `/bootstrapp-cloud:new-app` — scaffolds a new client app
  wired to a bootstrapp backend.
- **Skill** `bootstrapp-usage` — auto-loaded guidance for any bootstrapp work.
- **Agent** `bootstrapp-architect` — specialized subagent for end-to-end app
  generation.

## Install

From any Claude Code session:

```
/plugin marketplace add crochik/claude-plugin
/plugin install bootstrapp-cloud@bootstrapp
```

That's it — the MCP server, slash command, skill, and agent are now available.

Or, for local development against a checkout of this repo:

```
git clone https://github.com/crochik/claude-plugin.git
cd claude-plugin
claude --plugin-dir .
```

## First run

The first time Claude calls a tool on the `bootstrapp` MCP server it will
open a browser window for you to log in to bootstrapp.cloud. After that, the
session is cached and subsequent calls are silent.

## Usage

Kick off a new app:

```
/bootstrapp-cloud:new-app flutter expense-tracker
```

Or just describe what you want and let the architect agent handle it:

```
Use the bootstrapp-architect agent to build me a Next.js dashboard
on top of my "acme-inventory" bootstrapp project.
```

## Configuration

The MCP endpoint lives in [`.mcp.json`](./.mcp.json):

```json
{
  "mcpServers": {
    "bootstrapp": {
      "type": "http",
      "url": "https://mcp.bootstrapp.cloud/mcp"
    }
  }
}
```

> **TODO:** confirm the canonical production URL for the bootstrapp.cloud MCP
> endpoint and update `.mcp.json` if it differs from the placeholder above.

## Layout

```
.
├── .claude-plugin/
│   ├── plugin.json           # plugin manifest
│   └── marketplace.json      # marketplace manifest (lists this plugin)
├── .mcp.json                 # MCP server config
├── agents/
│   └── bootstrapp-architect.md
├── commands/
│   └── new-app.md            # /bootstrapp-cloud:new-app
├── skills/
│   └── bootstrapp-usage/
│       └── SKILL.md
└── README.md
```

## License

MIT
