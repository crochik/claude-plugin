# BootstrApp plugins for Claude Code

Claude Code plugins for building apps on the
[BootstrApp](https://bootstrapp.cloud) PaaS, by Crochik Software Solutions, LLC.
Proprietary: use requires a license and written authorization; see [License](#license).

| Plugin | What it does |
|---|---|
| [bootstrapp-kit](./plugins/bootstrapp-kit/) | For developers: model ObjectTypes, define actions, write ApiScripts, set access, generate a typed client and scaffold a UI, for new apps (`/bootstrapp-kit:new-app`) and for existing apps moving their backend to BootstrApp. Its skills also work in other agent harnesses. |

## Install

```
/plugin marketplace add crochik/claude-plugin
/plugin install bootstrapp-kit@bootstrapp
```

For local development from a checkout:

```
claude --plugin-dir ./plugins/bootstrapp-kit
```

The first call to the `bootstrapp` MCP server opens a browser to log in.
See the [kit's README](./plugins/bootstrapp-kit/README.md) for usage.

## Layout

```
.
├── .claude-plugin/marketplace.json   # marketplace manifest (lists the plugins)
├── .mcp.json                         # bootstrapp MCP server, for working in this repo
└── plugins/
    └── bootstrapp-kit/               # the developer plugin
```

## License

Copyright (c) 2026 Crochik Software Solutions, LLC. All rights reserved.

This repository is proprietary and is **not** open source. It is not licensed
under MIT or any other open-source license, and its public visibility grants no
rights. Any use, including installing the plugins, is subject to agreeing to
the license terms of Crochik Software Solutions, LLC (CSS) and to prior written
authorization from CSS. See [LICENSE](./LICENSE).
