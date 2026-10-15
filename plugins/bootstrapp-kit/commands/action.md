---
description: Define a BootstrApp action (typed input/output classes on a target class) and write its ApiScript.
argument-hint: "<what the operation should do>"
---

# /bootstrapp-kit:action

Use the `bootstrapp-actions` and `bootstrapp-apiscript` skills. Request:
`$ARGUMENTS`

1. Decide whether this needs an action at all. If the generated CRUD/filter
   endpoints can do it from the client, say so and show the calls instead.
2. Write the input/output class manifests and `bootstrapp/actions/<name>.json`.
3. Make sure `bootstrapp/generated/platform.d.ts` covers the classes the
   script touches. If it's missing or stale and those classes are
   registered, regenerate it (`generate_platform_definitions`, then
   `curl -fsSL -o bootstrapp/generated/platform.d.ts "<url>"`).
4. Write `bootstrapp/scripts/<name>.ts`. Code another script also needs
   goes in a shared script (`bootstrapp/shared/`) that both call. For several scripts or a port of
   existing handlers, delegate to the `bootstrapp-script-author` agent with
   the path `${CLAUDE_PLUGIN_ROOT}/skills`.
5. Check:
   `node "${CLAUDE_PLUGIN_ROOT}/skills/bootstrapp/scripts/bootstrapp-state.mjs" check`
   and
   `node "${CLAUDE_PLUGIN_ROOT}/skills/bootstrapp-apiscript/scripts/check-apiscript.mjs" bootstrapp/scripts/<name>.ts`.
   Fix what they report.
6. Apply only if the user asked (`/bootstrapp-kit:sync` otherwise).
