---
description: Design the bootstrapp.cloud data model for a new or existing backend — classes, inheritance, embeddings, references, and relations — without implementing anything.
argument-hint: [<topic>]
---

# /bootstrapp-cloud:design-model

The user wants to design a data model for a **bootstrapp.cloud** backend.

Arguments passed by the user: `$ARGUMENTS`

## Your job

**Pre-flight: verify the working directory.** Before delegating:

- If `BOOTSTRAPP.md` is present, this is an existing app — proceed; the
  subagent will read it and evolve it in place.
- If `BOOTSTRAPP.md` is absent and the directory is not empty (ignoring
  `.git/` and dotfiles), stop and ask the user to start in an empty folder
  (`mkdir <app-name> && cd <app-name>`). A fresh blueprint should anchor
  its own project root, not land in someone else's codebase.

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
- The subagent always writes the blueprint to `BOOTSTRAPP.md` in the
  current project folder. If the file already exists, the subagent reads
  it first and evolves it in place — the app name recorded there is
  preserved. Confirm the file path back to the user.
- The subagent must present its proposed design in chat and wait for the
  user's confirmation before calling `Write`. Do not let it skip that
  step or write the file on the first turn.
- Once the subagent returns the blueprint, present its path, the app
  name, and a short summary to the user, and ask whether they want to
  proceed to implementation via `/bootstrapp-cloud:new-app`.
