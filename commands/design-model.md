---
description: Design the bootstrapp.cloud data model for a new or existing backend — classes, inheritance, embeddings, references, and relations — without implementing anything.
argument-hint: [<topic>]
---

# /bootstrapp-cloud:design-model

The user wants to design a data model for a **bootstrapp.cloud** backend.

Arguments passed by the user: `$ARGUMENTS`

## Your job

Delegate immediately to the **`bootstrapp-schema-architect`** subagent. Pass along:

- The full contents of `$ARGUMENTS` as context.
- Any other relevant details the user has shared in this conversation.

The subagent will lead the design session: asking clarifying questions,
identifying classes, drafting inheritance / embedding / reference / relation
patterns, and producing a Markdown blueprint document.

## Rules

- Do not attempt to implement anything yourself. The schema architect is
  design-only; implementation is a separate step handled by `bootstrapp-architect`.
- If the user provides enough domain description in `$ARGUMENTS`, pass it
  straight through — do not re-interview them.
- The subagent always writes the blueprint to `BOOTSTRAPP.md` in the
  current project folder. If the file already exists, the subagent reads
  it first and evolves it in place — the app name recorded there is
  preserved. Confirm the file path back to the user.
- Once the subagent returns the blueprint, present its path, the app
  name, and a short summary to the user, and ask whether they want to
  proceed to implementation via `/bootstrapp-cloud:new-app`.
