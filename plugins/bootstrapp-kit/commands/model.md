---
description: Design or change BootstrApp ObjectTypes (data + API model) for this app, as manifests under bootstrapp/classes/.
argument-hint: "<what to model or change>"
---

# /bootstrapp-kit:model

Use the `bootstrapp-object-types` skill (and the `bootstrapp` skill for
file formats). Request: `$ARGUMENTS`

- No `bootstrapp/app.json` yet → do `/bootstrapp-kit:init` first, inline.
- Existing codebase with `bootstrapp/MIGRATION.md` → model the slice the
  request names, or the next pending slice.
- Small changes: edit the manifests directly. Many classes at once: delegate
  to the `bootstrapp-modeler` agent, passing the request, the access patterns
  you know, and the path `${CLAUDE_PLUGIN_ROOT}/skills`.
- Run `node "${CLAUDE_PLUGIN_ROOT}/skills/bootstrapp/scripts/bootstrapp-state.mjs" check`
  and fix every error.
- Summarize the model change in a few lines (classes, references, indexed
  fields, risky decisions). Applying is a separate step
  (`/bootstrapp-kit:sync`) unless the user asked to apply now.
