---
description: Set who can do what in this BootstrApp app - profiles, class/field access, row, update and delete constraints, action access, sign-in - or manage its users.
argument-hint: "<roles, permissions, sign-in or users to set up or change>"
---

# /bootstrapp-kit:access

Use the `bootstrapp-access` skill (and the `bootstrapp` skill for file
formats and sync). Request: `$ARGUMENTS`

- No `bootstrapp/app.json` yet → do `/bootstrapp-kit:init` first, inline.
- Roles and permissions: run the skill's interview for whatever the request
  leaves open, show the profile × class table, then write
  `profiles/`, `access/` and `auth.json` manifests. Add owner or organization
  fields to class manifests when a constraint needs them.
- Run `node "${CLAUDE_PLUGIN_ROOT}/skills/bootstrapp/scripts/bootstrapp-state.mjs" check`
  and fix every error.
- Users and organizations: call the user tools directly (no manifests),
  confirming each change with the user first.
- Applying manifests is `/bootstrapp-kit:sync` unless the user asked to apply
  now.
