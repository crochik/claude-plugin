---
description: Start using BootstrApp in this repository - new app or existing codebase - by creating bootstrapp/app.json and, when asked, initializing the app on the backend.
argument-hint: "[app_name] [short description]"
---

# /bootstrapp-kit:init

Use the `bootstrapp` skill. Arguments: `$ARGUMENTS`

1. If `bootstrapp/app.json` already exists, show the status instead (as in
   `/bootstrapp-kit:status`) and stop.
2. Work out the app identity, asking only for what the arguments and the
   repository don't answer:
   - **name**: snake_case (lowercase letters, digits, underscores). Propose
     one from the repo or description; convert hyphens/camelCase and say so.
     It becomes the OIDC client id and the `app.<name>` namespace and cannot
     be renamed later.
   - **title**: human-readable (default: title-cased name).
   - **description**: a real paragraph (purpose, users, scope). For an
     existing app, draft it from the README and code.
3. Create `bootstrapp/` with `app.json`
   (format: the `bootstrapp` skill's `references/manifests.md`) and empty
   `classes/`, `actions/`, `scripts/`, `generated/` folders. This works in
   any repository; it does not need an empty directory.
4. If the user wants the backend app created now, call `init_app` with the
   name, title and description, then record it:
   `node "${CLAUDE_PLUGIN_ROOT}/skills/bootstrapp/scripts/bootstrapp-state.mjs" record app <name>`.
   If the app already exists on the backend (`init_app` returns it), record
   it the same way.
5. Suggest the next step: modeling (`/bootstrapp-kit:model`) for a new app,
   or analysis (`/bootstrapp-kit:migrate`) for an existing codebase.
