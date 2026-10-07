---
description: Push local BootstrApp manifests and scripts to the backend (init app, add classes, register actions, attach scripts) and refresh generated files.
argument-hint: "[--dry-run]"
---

# /bootstrapp-kit:sync

Use the `bootstrapp` skill's "Applying (sync)" section. Arguments:
`$ARGUMENTS`

1. `node "${CLAUDE_PLUGIN_ROOT}/skills/bootstrapp/scripts/bootstrapp-state.mjs" check`
   must have no errors; fix them first. Also run `check-apiscript.mjs` (in
   the `bootstrapp-apiscript` skill's `scripts/`) on every script that will
   be pushed and fix syntax errors now; "not declared" errors for classes or
   actions this sync registers are expected until step 5.
2. `bootstrapp-state.mjs plan --summary` lists the calls; `plan` without
   `--summary` gives each call's exact arguments.
3. With `--dry-run`, show the plan and stop. Otherwise, unless the user
   already said to apply, show the list of registrations (they can't be
   undone through MCP) and continue when they confirm.
4. Execute: `init_app` if planned; then all `add_object_class` and
   `register_action` calls in parallel; record each success immediately with
   `bootstrapp-state.mjs record <kind> <name>`. On a failure, report it and
   keep going with independent items.
5. If classes or actions were added, regenerate
   `bootstrapp/generated/platform.d.ts`, re-run the script check, then attach
   new or changed scripts with `update_action_script` (reading each file
   verbatim) and record them.
6. Report blocked items (changed after applying) with the options from the
   skill. Offer to regenerate the client if the API surface changed.
