---
name: bootstrapp
description: Core guide for any work on an app whose backend is (or is moving to) the BootstrApp PaaS (bootstrapp.cloud) - the mental model, the bootstrapp/ project folder, the MCP tools, and how to pick the next step from the app's current state. Load it first whenever BootstrApp, the bootstrapp MCP server, ObjectTypes, ApiScripts, or a bootstrapp/ folder comes up.
---

# Working with BootstrApp

BootstrApp is a backend PaaS. An app on it is defined by four things, and this
kit has one skill for each:

| Concern | What it is | Skill |
|---|---|---|
| Data + API model | **ObjectTypes** (classes): JSON Schemas stored as MongoDB collections. The same schema is the API model: the platform generates CRUD + filter endpoints from it. | `bootstrapp-object-types` |
| Operations | **Actions**: named server operations on a class, each with a typed input class and output class. | `bootstrapp-actions` |
| Logic | **ApiScripts**: the body of an action, in a small TypeScript dialect, calling only the functions the platform exposes for the app's classes. | `bootstrapp-apiscript` |
| Client | A strongly typed client generated from the OpenAPI spec the MCP server produces. | `bootstrapp-client` |

Moving an existing app onto BootstrApp has its own skill:
`bootstrapp-migration`.

There is **no required order** beyond real dependencies (the app must be
initialized with `init_app` before any other tool that takes an app name;
a class must exist before an action targets it; scripts are written against definitions that
include the classes they touch; the client reflects whatever is registered
when the spec is generated). Work on whatever the user asks for, from
whatever state the project is in.

## The `bootstrapp/` folder

Everything this kit writes lives in one folder, `bootstrapp/`, at the root of
the user's repository (new or existing). It sits next to the app's own code
and never requires an empty directory. If an `app.json` already exists
somewhere else (`find . -name app.json -path '*bootstrapp*'`), use that folder
instead.

```
bootstrapp/
  app.json                      app identity (+ client generation settings)
  classes/<fullObjectType>.json one file per ObjectType = the add_object_class payload
  actions/<actionName>.json     one file per action = the register_action payload
  scripts/<actionName>.ts       one ApiScript per action
  generated/platform.d.ts       script function surface (downloaded, never edited)
  generated/openapi.yaml        API spec (downloaded, never edited)
  applied.json                  ledger of what has been pushed to the backend
  MIGRATION.md                  only for existing apps being migrated
```

The JSON manifests are **exactly the MCP tool arguments**, so applying them is
mechanical and reviewing them is a normal code review. Formats are in
[references/manifests.md](references/manifests.md).

Why local files at all: the backend only gives back the API form of a class
(`get_object_class`), with generated fields mixed in and no record of what was
applied when, so the manifests (plus the ledger) are the record of intent.
Classes, actions and scripts can all be read back (`get_object_class`,
`get_actions`, `get_action_script`), which helps when adopting an app that was
built without this folder.

## Find the current state before acting

Run the state helper from the repo root (Node 18+):

```bash
node <this skill's folder>/scripts/bootstrapp-state.mjs status
```

(Use the absolute path of the folder this `SKILL.md` lives in; in Claude
Code that is `${CLAUDE_PLUGIN_ROOT}/skills/bootstrapp`. Pass `--dir <path>`
if the app folder is not `./bootstrapp`.) It prints the app, every local
class/action/script, which ones are new, changed, or already applied, and
manifest problems. `check` validates manifests only; `plan` prints the exact
tool calls a sync would make; `record` marks items as applied. If Node is not
available, read the folder and `applied.json` by hand; the rules are the same.

Typical states and sensible next steps (suggest, don't force):

- **No `bootstrapp/` folder, empty repo** → new app: settle name and scope,
  then model the first classes.
- **No `bootstrapp/` folder, existing codebase** → migration: analyze the
  current backend first (`bootstrapp-migration`).
- **Manifests exist, nothing applied** → review, then sync.
- **Applied, no client** → generate the spec and client.
- **Actions without scripts** → write the scripts.
- **Changed after applying** → see "Changing things already applied" below.

## The MCP server

The `bootstrapp` MCP server (streamable HTTP, OAuth; the first call opens a
browser login) is the only way to change the backend. Tool names below are
the server's own; your harness may prefix them (for example
`mcp__bootstrapp__add_object_class`). Full argument reference and observed
behavior: [references/mcp-tools.md](references/mcp-tools.md).

| Tool | Use |
|---|---|
| `init_app` | Create the app (once), before any other call for it. Provisions the OIDC client named after the app. If `applied.json` has no `app` entry, call it (with `app.json`'s name, title, description) and record it before the first other backend call. |
| `add_object_class` | Register one class. Fails if it already exists. |
| `replace_object_class` | Replace an existing class's definition (same arguments as `add_object_class`). Stored records are not migrated. |
| `register_action` | Register one action. Refuses a name the class already has. |
| `replace_action` | Change a registered action's input/output classes, scope, summary, description. |
| `get_actions` | List a class's actions (input/output, scope, whether it has a script). |
| `replace_action_script` | Validate a script on the server, then store it and wire it to run. Rejects an invalid script with line/column errors. Safe to repeat. (`update_action_script` is the older name for the same call.) |
| `get_action_script` | Read the script stored on an action. |
| `get_object_class` | Read one class in full: type, base, indexed fields, foreign keys, and its API schemas (read/create/update plus dependencies). |
| `get_namespaces`, `get_object_classes` | List what exists (names only). |
| `generate_platform_definitions` | URL of the `.d.ts` describing every function a script may call. |
| `generate_openapi_spec` | URL of the OpenAPI spec for client generation. |
| `add_oidc_client_redirect` | Allow a login redirect URL. |

The server also publishes reference resources (schema conventions, filter
operators, action scopes, the ApiScript grammar and rule book, auth config).
List the server's resources and read the relevant one before relying on the
snapshots in this kit; **the server's copy wins** where they differ.

Download URLs from the generate tools are single use. Fetch them straight to
disk (`curl -fsSL -o <path> <url>`) and do not print the files: they are large
and you can grep them when needed.

## Principles

- **Discover, don't guess.** Field names, endpoints, script functions, and
  auth settings come from the manifests, `generated/platform.d.ts`,
  `generated/openapi.yaml`, or the server's resources. Never invent them.
- **Default to the client; use actions when forced.** The generated client can
  chain CRUD and filter calls across classes. An action is for server-side
  side effects, atomic multi-write work, or computation over data the client
  should not fetch. Authorization is never the reason: the backend enforces
  access on every CRUD, filter, and action call.
- **One model for storage and API.** Design each ObjectType as the document
  you want in MongoDB *and* the shape the client receives. No separate DTO
  layer unless an action needs a different payload.
- **Namespaces are rooted at `app.<app_name>`.** Domain classes live directly
  in `app.<app_name>`; action input/output classes in `app.<app_name>.actions`.
  Action payload classes are never domain classes.
- **Platform `User` and `Group` already exist.** Reference users with a
  `*Id` uuid field; never define `User`/`Group` in the app namespace.
- **Secrets stay out of git.** `.env.example` committed, `.env` ignored.
- **Ask, don't stall.** When something is ambiguous, propose a default, say
  which one, and continue unless the step cannot be undone (registering an
  action, renaming the app).

## Changing things already applied

When the state helper reports something changed after it was applied, `plan`
lists the replace call for it:

- **Script changed** → `replace_action_script` again.
- **Action changed** → `replace_action`. It keeps the action's id and script.
- **Class changed** → `replace_object_class`. Records already stored are not
  migrated: a removed property stays in old documents, and a new required
  property is missing from them until they are updated. Tell the user what
  changes for existing data before replacing a class that already has
  records, and never switch a class between `TopLevel` and `Embedded` (the
  server refuses; add a new class instead).

There are no delete tools. Renaming a class or action means adding the new
one and leaving the old one in place.

Older servers (before crochik/BootstrApp PR #28) have no replace tools,
`get_object_class`, `get_action_script` or `get_actions`, and `register_action` silently creates
duplicates there. If the tool list lacks `replace_object_class`, a changed
class or action can't be applied through MCP: tell the user and offer a new
name, a change in the BootstrApp admin, or reverting the local file. Scripts
then go through `update_action_script` with the same arguments.

Known platform gaps and behaviors worth knowing before you rely on something:
[references/platform-notes.md](references/platform-notes.md).

## Applying (sync)

When the user wants local definitions pushed:

1. `bootstrapp-state.mjs check` must report no errors.
2. `bootstrapp-state.mjs plan` lists the calls. Show the user what will be
   registered (registrations cannot be undone through MCP) unless they
   already asked you to apply.
3. If the app is not initialized, call `init_app` with `app.json`'s name,
   title, and description.
4. Make the class calls in the order `plan` lists them (base and embedded
   classes come first), then the action calls; actions don't depend on each
   other and can go in parallel.
5. Record each success right away: `bootstrapp-state.mjs record <kind> <name>`
   (kinds: `app`, `class`, `action`, `script`). Record only what succeeded.
6. If any class or action changed, regenerate `generated/platform.d.ts`
   (`generate_platform_definitions`) so scripts are checked against the new
   surface, then push changed scripts with `replace_action_script` and record
   them.
7. Regenerate the OpenAPI spec and client if the API surface changed.
