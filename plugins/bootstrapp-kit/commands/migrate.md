---
description: Analyze an existing codebase and plan (or continue) moving its backend to BootstrApp, slice by slice.
argument-hint: "[area or slice to focus on]"
---

# /bootstrapp-kit:migrate

Use the `bootstrapp-migration` skill. Focus: `$ARGUMENTS`

1. If `bootstrapp/MIGRATION.md` exists, read it and continue from the next
   pending slice (or the slice named in the arguments).
2. Otherwise, delegate the inventory and mapping to the
   `bootstrapp-migration-analyst` agent, passing the focus area and the path
   `${CLAUDE_PLUGIN_ROOT}/skills`. It writes `bootstrapp/MIGRATION.md`.
3. If `bootstrapp/app.json` is missing, create it as `/bootstrapp-kit:init`
   describes, drafting the description from the codebase.
4. Present the mapping summary, the first slice, and the open decisions with
   your recommended defaults. Then, unless the user redirects, model the
   first slice (`bootstrapp-object-types`, `bootstrapp-actions`,
   `bootstrapp-apiscript`) as manifests. Registering on the backend and
   importing data wait for the user's go-ahead.
