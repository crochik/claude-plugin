---
description: Push local BootstrApp manifests and scripts to the backend (init app, profiles, classes, access, actions, scripts, sign-in) and refresh generated files.
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
4. Execute: `init_app` if planned; then the calls in plan order (profiles,
   classes, class access, actions, action access, and `replace_app_auth`
   after the scripts in step 5); record each success immediately with
   `bootstrapp-state.mjs record <kind> <name>`. On a failure, report it and
   keep going with independent items.
5. If classes or actions were added, regenerate
   `bootstrapp/generated/platform.d.ts`, re-run the script check, then push
   new or changed shared scripts with `replace_script`, action scripts
   with `replace_action_script` and class event scripts with
   `replace_class_event_script` (or `remove_class_event_script` for a
   deleted one), in plan order (reading each file verbatim,
   with `elevated` as `plan` lists it), and record them. If the server rejects a script, show its
   errors, fix the script, and push again.
6. Before replacing a class, say what changes for records already stored
   (see "Changing things already applied" in the skill). Report blocked items.
   Offer to regenerate the client if the API surface changed.
