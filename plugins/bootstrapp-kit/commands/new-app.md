---
description: Build a new app on BootstrApp end to end - identity, model, actions, scripts, sync, typed client, UI scaffold with sign-in, then run it and iterate.
argument-hint: "[short intent: platform, what the app does]"
---

# /bootstrapp-kit:new-app

A guided path through the kit for a brand-new app. Each step uses the skill
named in it; read the `bootstrapp` skill first. Intent: `$ARGUMENTS`

Skip any question the arguments or the conversation already answer. Propose a
default when something is open, say which, and keep going; stop for the user
only before steps that can't be undone (`init_app`, registrations).

1. **Pre-flight.** If `bootstrapp/app.json` exists, this is not a new app:
   show the status (as in `/bootstrapp-kit:status`) and stop. If the
   repository already has backend code, suggest `/bootstrapp-kit:migrate`
   instead and stop unless the user wants a fresh app anyway.
2. **Intake.** Settle, in plain questions or `AskUserQuestion` for the
   choices:
   - **name** (snake_case, permanent; it becomes `app.<name>` and the OIDC
     client id) and **title**;
   - **platform**: web (default React + Vite, TypeScript), mobile (default
     Flutter), desktop (ask which framework), or CLI;
   - **description**: what the app does, who uses it, and the few features
     the first slice needs. Ask for a paragraph.
3. **Scope.** One short round of feedback: name the smallest useful first
   slice (one or two classes, at most one action) and anything in the
   description that should wait. Agree on it before modeling.
4. **Identity.** Create `bootstrapp/` and `app.json` as `/bootstrapp-kit:init`
   describes, in the current repository (or a new folder the user names).
5. **Model.** Design the classes for the slice (`bootstrapp-object-types`).
   Present the model in a few lines and adjust it with the user.
6. **Actions and scripts.** Only for work the client can't do with CRUD and
   filter calls (`bootstrapp-actions`). Write each script against
   `generated/platform.d.ts` (`bootstrapp-apiscript`); the app's own
   functions appear there only after its classes are registered, so finish
   the scripts after step 8's class registrations if needed.
7. **Access.** Default for a first slice: one full-access profile for signed-in
   users and no anonymous access (`bootstrapp-access`). Say so and move on
   unless the description needs roles.
8. **Sync.** Run `/bootstrapp-kit:sync`: `init_app`, then profiles, classes,
   access, actions, scripts, sign-in, in `plan` order. Show the plan before
   the first registration unless the user already said to apply.
9. **Client.** Generate the spec and the typed client (`bootstrapp-client`).
10. **Scaffold the UI.** Follow `bootstrapp-client`'s "New frontends"
    section: the platform's own scaffolder, the generated client behind the
    wrapper, sign-in wired first, then one real read screen and one real write
    against live data. Register each redirect URL with
    `add_oidc_client_redirect`.
11. **Run and iterate.** Start the dev server in the background, give the user
    the URL, and stay in the conversation: new features go back through
    model, actions, sync and client as needed, one slice at a time.

## Rules

- Never invent endpoints, fields, script functions or auth settings; they
  come from the manifests, `generated/`, or the server's resources.
- `.env.example` is committed, `.env` is gitignored.
- A working slice (sign-in, one read, one write) before anything elaborate.
- If the MCP server isn't connected, ask the user to finish the browser login
  before any backend step.
