# Using bootstrapp-kit outside Claude Code

The useful parts of this kit are harness-neutral. Using them in any harness
is subject to the same license as the plugin (see [LICENSE](LICENSE)):

- **Skills** (`skills/*/SKILL.md`) follow the Agent Skills format: a folder
  with a `SKILL.md` whose frontmatter has `name` and `description`, plus
  `references/` and `scripts/`. Harnesses that support skills can load the
  `skills/` folder directly. Others can include a skill's `SKILL.md` in the
  system prompt or project instructions and let the agent read the
  referenced files on demand.
- **Helper scripts** are plain Node 18+ with no dependencies:
  - `skills/bootstrapp/scripts/bootstrapp-state.mjs status|check|plan|record`
  - `skills/bootstrapp-apiscript/scripts/check-apiscript.mjs <files>`
  - `skills/bootstrapp-client/scripts/generate_api.sh <spec> <outdir> <lang>`
- **MCP server**: configure an HTTP (streamable) MCP server named
  `bootstrapp` pointing at the URL in [.mcp.json](.mcp.json). It uses OAuth;
  the harness must support the MCP authorization flow.

Claude Code specifics you can ignore elsewhere: `commands/` (slash command
shortcuts that load the skills), `agents/` (optional subagents for
context-heavy analysis), and `${CLAUDE_PLUGIN_ROOT}` (replace with the path
where you placed this folder).

## Minimal setup for another agent

1. Make the seven skill folders available to the agent.
2. Add the `bootstrapp` MCP server.
3. Add to the project instructions:

   > For any work involving BootstrApp, read
   > `<kit>/skills/bootstrapp/SKILL.md` first, then the skill it points to
   > for the task. Run `<kit>/skills/bootstrapp/scripts/bootstrapp-state.mjs
   > status` before changing anything under `bootstrapp/`.
