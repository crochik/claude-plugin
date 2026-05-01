---
description: Evolve the bootstrapp.cloud data model of an existing app — classes, inheritance, embeddings, references, relations, and actions — without implementing anything. For brand-new apps, use /bootstrapp:new-app instead.
argument-hint: [<topic>]
---

# /bootstrapp:design-model

The user wants to design or update the data model for an existing
**bootstrapp.cloud** app. This command is the entry point for
**schema-only changes**; brand-new apps go through
`/bootstrapp:new-app`, which orchestrates intake, schema design,
class creation, client generation, and scaffolding end-to-end.

Arguments passed by the user: `$ARGUMENTS`

## Your job

**Pre-flight: verify the working directory.** Before delegating:

- If `BOOTSTRAPP.md` is present, this is an existing app — proceed; the
  subagent will read it and evolve it in place.
- If `BOOTSTRAPP.md` is absent, this is not the right entry point. Tell
  the user to run `/bootstrapp:new-app` instead — that command
  creates the `bootstrapp` folder (always that name, regardless of the
  app name), runs intake, and orchestrates the full flow. Do not invoke
  the schema architect from a directory with no `BOOTSTRAPP.md`.

Once the directory check passes, delegate to the
**`bootstrapp-schema-architect`** subagent. Pass along:

- The full contents of `$ARGUMENTS` as context.
- Any other relevant details the user has shared in this conversation.

The subagent will lead the design session: asking clarifying questions,
identifying classes, drafting inheritance / embedding / reference / relation
patterns, **presenting the proposed design in chat and inviting feedback
before writing anything**, and only then producing the Markdown blueprint
document.

## Rules

- Do not attempt to implement anything yourself. The schema architect is
  design-only; implementation is a separate step handled by `bootstrapp-architect`.
- If the user provides enough domain description in `$ARGUMENTS`, pass it
  straight through — do not re-interview them.
- The blueprint is two kinds of files: **`BOOTSTRAPP.md`** at the
  project root (the index — registries of classes, actions, and named
  views, no JSON Schemas) and **`schemas/<Namespace>.md`** files (one
  per namespace, full class definitions; the actions namespace file
  also holds full action definitions; a domain namespace file also
  holds the full view definitions for views whose target lives there).
  The subagent reads the index plus the touched schemas files first,
  evolves them in place, and updates both sides in the same turn — the
  app name recorded there is preserved. Confirm the touched paths back
  to the user.
- The schema architect also designs **named views** (saved filter
  configurations on top-level classes — conditions, visible fields,
  optional sort/limit). View-only changes (adding a saved query,
  adjusting visible fields, changing sort) are valid reasons to invoke
  this command.
- The subagent must present its proposed design in chat and wait for the
  user's confirmation before calling `Write` or `Edit`. Do not let it
  skip that step or write the files on the first turn.
- Once the subagent returns the updated blueprint, present the touched
  paths, the app name, and a short summary of what changed. Then ask
  whether the user wants the `bootstrapp-architect` to apply the
  schema changes to the backend (registering the new/changed classes
  and actions, regenerating the OpenAPI spec, and regenerating the
  API client) or to defer until later.
- If the change touched the action registry (added, renamed, removed,
  or reshaped any action), the architect must also refresh the
  matching `scripts/<ActionsNamespace>.md` file(s) and attach the
  updated scripts via `mcp__bootstrapp__update_action_script`. The
  ordering matters because the **`bootstrapp-action-scripter`**
  subagent drafts against `Reference/platform-modules.d.ts` from the
  MCP server, and that resource is only refreshed when the architect
  calls `mcp__bootstrapp__generate_openapi_spec` — so the canonical
  flow is: architect registers the class/action changes → architect
  calls `generate_openapi_spec` → invoke the scripter to rewrite the
  affected scripts → architect calls `update_action_script` for each
  updated action. The scripter itself is design-only and never
  touches the backend, but it should run after the spec regen, not
  before.
