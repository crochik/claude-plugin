---
description: Show where this BootstrApp app stands - local manifests, what is applied on the backend, generated files, problems - and suggest next steps.
argument-hint: "[--dir <bootstrapp folder>]"
---

# /bootstrapp-kit:status

Use the `bootstrapp` skill.

1. Run the state helper:
   `node "${CLAUDE_PLUGIN_ROOT}/skills/bootstrapp/scripts/bootstrapp-state.mjs" status $ARGUMENTS`
   (if that path doesn't resolve, use the `scripts/` folder of the
   `bootstrapp` skill).
2. If there is no `bootstrapp/` folder, look at the repository: empty or
   new → offer `/bootstrapp-kit:init`; existing app → offer
   `/bootstrapp-kit:migrate`.
3. If the MCP server is reachable and the user wants a backend comparison,
   call `get_object_classes` for `app.<name>` and report classes that exist
   on only one side.
4. Reply with the state in a few lines and up to three suggested next steps.
   Don't start any of them unless the user asked.
