---
description: Generate or refresh the strongly typed BootstrApp API client from the OpenAPI spec and wire it into the app.
argument-hint: "[language] [output dir]"
---

# /bootstrapp-kit:client

Use the `bootstrapp-client` skill. Arguments: `$ARGUMENTS`

1. Check that the classes and actions the app needs are applied
   (`bootstrapp-state.mjs status`); offer `/bootstrapp-kit:sync` if not,
   since the spec only contains what is registered.
2. Follow the skill: download the spec to
   `bootstrapp/generated/openapi.yaml`, settle `client` settings in
   `app.json`, generate into the dedicated output folder (BootstrApp
   generator via
   `${CLAUDE_PLUGIN_ROOT}/skills/bootstrapp-client/scripts/generate_api.sh`
   when `bootstrapp-gen-<language>` is installed, otherwise a standard
   generator the user agrees to), update the wrapper, and compile.
3. If auth isn't wired yet, follow the skill's auth section, including
   `add_oidc_client_redirect` for each redirect URL.
4. Report what was generated where, and anything that failed to compile.
