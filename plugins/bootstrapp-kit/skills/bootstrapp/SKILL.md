---
name: bootstrapp
description: Core guide for any work on an app whose backend is (or is moving to) the BootstrApp PaaS (bootstrapp.cloud) - the mental model, the bootstrapp/ project folder, the MCP tools, and how to pick the next step from the app's current state. Load it first whenever BootstrApp, the bootstrapp MCP server, ObjectTypes, ApiScripts, or a bootstrapp/ folder comes up.
license: Proprietary. Copyright (c) 2026 Crochik Software Solutions, LLC. Use requires agreement to its license terms and its prior written authorization; see LICENSE.
---

# Working with BootstrApp

BootstrApp is a backend PaaS. An app on it is defined by five things, and this
kit has one skill for each:

| Concern | What it is | Skill |
|---|---|---|
| Data + API model | **ObjectTypes** (classes): JSON Schemas stored as MongoDB collections. The same schema is the API model: the platform generates CRUD + filter endpoints from it. | `bootstrapp-object-types` |
| Operations | **Actions**: named server operations on a class, each with a typed input class and output class. | `bootstrapp-actions` |
| Logic | **ApiScripts**: the body of an action, in a small TypeScript dialect, calling only the functions the platform exposes for the app's classes. Code several scripts reuse is a **shared script** they call as a function. A **class event script** runs after an object of a class is created or updated. | `bootstrapp-apiscript` |
| Access | **Profiles** (roles), what each may do on every class, field, relation and action, which records it sees (constraints), and how users sign in. | `bootstrapp-access` |
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
  shared/<scriptName>.json      a shared script's replace_script arguments (description, classes, profiles)
  shared/<scriptName>.ts        the shared script itself, called as scripts.<scriptName>(args)
  events/<fullObjectType>.<created|updated>.<scriptName>.ts   one behavior run after an object of the class
                                is created or updated (several per class and event)
  network/<name>.json           a network policy (HTTP calls system.http may make) and the actions/class
                                event scripts whose runs it binds
  profiles/<Profile>.json       one file per profile = the add_profile payload
  access/<Profile>/<fullObjectType>.json   a profile's access to one class = replace_class_access
  access/actions/<actionName>.json         profiles that run an action = replace_action_access
  auth.json                     sign-in providers and sign-up = replace_app_auth
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
  then model the first classes. For a guided path all the way to a running
  UI, use `/bootstrapp-kit:new-app` (in Claude Code) or follow its steps.
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
behavior: the server's `bootstrapp://reference/tools.md` resource.

| Tool | Use |
|---|---|
| `init_app` | Create the app (once), before any other call for it. Provisions the OIDC client named after the app. If `applied.json` has no `app` entry, call it (with `app.json`'s name, title, description) and record it before the first other backend call. |
| `add_object_class` | Register one class. Fails if it already exists. |
| `replace_object_class` | Replace an existing class's definition (same arguments as `add_object_class`). Stored records are not migrated. |
| `register_action` | Register one action. Refuses a name the class already has. |
| `replace_action` | Change a registered action's input/output classes, scope, summary, description. |
| `get_actions` | List a class's actions (input/output, scope, whether it has a script). |
| `replace_action_script` | Validate a script on the server, then store it and wire it to run, with the caller's access or `elevated`. Rejects an invalid script with line/column errors. Safe to repeat. (`update_action_script` is the older name for the same call.) |
| `get_action_script` | Read the script stored on an action (to pull one written elsewhere into `scripts/<actionName>.ts`). |
| `get_scripts`, `get_script`, `replace_script`, `update_script`, `delete_script` | The app's shared scripts (`app.<app>.scripts`): list them, read one, validate and save one (safe to repeat), change part of one, delete one (its callers then fail). |
| `get_class_event_scripts`, `get_class_event_script`, `replace_class_event_script`, `remove_class_event_script` | Scripts a class runs after one of its objects is created or updated (`classEvent` `Created` or `Updated`, several per event, each by `scriptName`): list them, read one, validate and save one (safe to repeat), remove one (the others stay). Nothing to register first. |
| `get_network_policies`, `replace_network_policy`, `set_script_network_policy` | Which HTTP calls `system.http` may make: list the policies (with the scripts using each), create one or change an inactive one (rules of host, schemes, methods; safe to repeat; a change to an active one is saved as a new inactive policy), point an action or class event script at one by id or take its network access away. Policies allow calls only once activated outside the MCP server. The policy binds the whole run the script starts (called actions and shared scripts included); a run whose script has none can't make HTTP calls. |
| `validate_action_scripts` | Check every action, shared and class event script of the app against the current classes; changes nothing. Run it after changing classes or deleting a shared script. |
| `invoke_action` | Run an action's stored script now, as the owner (real writes), optionally with a profile's access (`profileName`) or another time limit (`timeoutSeconds`, default 60, at most 600). |
| `get_object_class` | Read one class in full: type, base, indexed fields, foreign keys, and its API schemas (read/create/update plus dependencies). |
| `set_class_full_text_search` | Turn a class's `#text` search on or off without sending the class again. |
| `get_namespaces`, `get_object_classes` | List what exists (names only). |
| `generate_platform_definitions` | URL of the `.d.ts` describing every function a script may call. |
| `generate_openapi_spec` | URL of the OpenAPI spec for client generation. |
| `add_oidc_client_redirect` | Allow a login redirect URL. |
| `get_profiles`, `add_profile`, `replace_profile`, `remove_profile` | Profiles (roles). |
| `get_class_access`, `replace_class_access`, `remove_class_access`, `replace_action_access` | What a profile may do and see. |
| `get_app_auth`, `replace_app_auth`, `add_oidc_client_origin` | Sign-in providers, sign-up, browser origins. |
| `get_users`, `invite_user`, `assign_user_profile`, `remove_user_access`, `get_organizations`, `add_organization`, `set_user_organization` | People. They change real access: confirm each call. |
| `get_buckets`, `add_bucket`, `update_bucket`, `get_folders`, `create_folder`, `get_folder_access`, `replace_folder_access` | Where `system.files` stores files. Buckets are added without credentials (the platform owner sets keys outside MCP); never ask for or handle bucket keys. Confirm before adding or changing a bucket. |
| `get_current_user` | Who is signed in (user, account, role, claims). |
| `list_object_types`, `describe_object_type`, `find_object`, `filter_objects`, `create_object`, `update_object` | Read and write records (the app's included) with the signed-in user's own access: look at real data, or seed a few records while building. Writes are real. Describe first and use its keys; see "Object data tools" in `tools.md`. Clients use the generated API instead. |

Only the app's owner can call the tools that take an app (or a class or
action of it); see the `bootstrapp-access` skill for the access tools.
Every tool above except `get_current_user` and the object data tools also
needs **developer access**, an `mcp_role` of `developer` that a platform
administrator grants on the user. Without it those tools aren't listed: if
only the object data tools show up, tell the user to ask for developer
access and sign in again, rather than working around it.

The platform facts live on the server, so they always match the deployed
version. Read the resource before relying on a detail it covers:

| Resource (`bootstrapp://reference/…`) | What it covers |
|---|---|
| `platform-notes.md` | How the platform behaves beyond the tool descriptions: classes, actions, script runtime, filtering, auth, access, known gaps. |
| `tools.md` | Every tool's arguments, results and behavior. |
| `schema-conventions.md` | Class schemas: documentation, `_id`, indexes, references, inheritance, naming. |
| `api-script.md`, `api-script.g4` | The ApiScript language and modules (rule book and grammar). |
| `access-control.md` | Profiles, permissions, constraints, recipes. |
| `filter-operators.json`, `action-scopes.json`, `auth-config.json` | Filter operators, action scopes, sign-in settings. |

Where a tool result lands in this kit: `get_object_class` is the API form of
a class (drop the generated `{field}|Name` and relation fields before using
it as a manifest; read the local manifest first when there is one);
`set_class_full_text_search` changes `isFullTextSearchable`, so update the
manifest to match.

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
- **Users and organizations are platform records.** Reference users with
  a `*Id` uuid field (`ownerId`) and organizations with `organizationId`;
  never define `User`, `Organization` or `Group` classes in the app
  namespace.
- **Secrets stay out of git.** `.env.example` committed, `.env` ignored.
- **Ask, don't stall.** When something is ambiguous, propose a default, say
  which one, and continue unless the step cannot be undone (registering an
  action, renaming the app).

## Changing things already applied

When the state helper reports something changed after it was applied, `plan`
lists the replace call for it:

- **Script changed**, or its action's `elevated` → `replace_action_script` again.
- **Class event script changed** → `replace_class_event_script` again;
  **deleted** → `remove_class_event_script`.
- **Network policy changed** → `replace_network_policy` (with the
  ledger's `id`) and `set_script_network_policy` for its scripts with the
  id it returns; a script dropped from it gets an empty policy. An active
  policy is never changed: the change comes back as a new, inactive
  policy someone has to activate outside the MCP server, and the server
  moves the scripts on the old one to it. Replacing a
  script keeps its policy.
- **Shared script changed** (script or manifest) → `replace_script` again. If
  its classes changed, run `validate_action_scripts` to find the callers
  it broke.
- **Action changed** → `replace_action`. It keeps the action's id and script.
- **Class changed** → `replace_object_class`. Records already stored are not
  migrated: a removed property stays in old documents, and a new required
  property is missing from them until they are updated. Tell the user what
  changes for existing data before replacing a class that already has
  records, and never switch a class between `TopLevel` and `Embedded` (the
  server refuses; add a new class instead).

There are no delete tools for classes or actions. Renaming a class or
action means adding the new one and leaving the old one in place.

Known platform gaps and behaviors worth knowing before you rely on something:
the server's `platform-notes.md` resource.

## Applying (sync)

When the user wants local definitions pushed:

1. `bootstrapp-state.mjs check` must report no errors.
2. `bootstrapp-state.mjs plan` lists the calls. Show the user what will be
   registered (registrations cannot be undone through MCP) unless they
   already asked you to apply.
3. If the app is not initialized, call `init_app` with `app.json`'s name,
   title, and description.
4. Make the calls in the order `plan` lists them: profiles, classes (base
   and embedded classes first), class access, actions, action access,
   shared scripts (the ones others call first), action scripts, class
   event scripts, network policies (after the scripts they list), `auth.json`. Actions don't depend on each other and can go in
   parallel; so can access calls. Access shown as `recheck` is applied again
   because its class changed. Classes that reference each other show up
   twice: an `add_object_class` with `record: null` and a `note` (don't
   record it), then a `replace_object_class` with the foreign keys, which
   is recorded.
5. Record each success right away: `bootstrapp-state.mjs record <kind> <name>`
   (kinds: `app`, `profile`, `class`, `access`, `action`, `action-access`,
   `shared-script`, `script`, `event-script`, `network-policy`, `auth`; an access item's name is
   `<Profile>/<fullObjectType>`, an event script's its file name without
   `.ts`).
   A network policy is several calls; only its last one carries `record`,
   with `--id` set to the `id` `replace_network_policy` returned, which the
   `set_script_network_policy` calls take too. Policies are saved
   inactive and allow no call until someone activates them outside the
   MCP server; tell the user. When the result has `replacesId`, the policy
   was active and the change is a new policy: the server already moved
   the scripts on the old one to it (`movedScripts`), and their runs make
   no HTTP call until the developer activates it, so tell them it needs
   approval. Still make the `set_script_network_policy` calls `plan`
   lists (they are harmless repeats). Record only
   what succeeded.
6. If any class or action changed, regenerate `generated/platform.d.ts`
   (`generate_platform_definitions`) so scripts are checked against the new
   surface, then push changed shared scripts with `replace_script` and
   changed action scripts with `replace_action_script` and class event
   scripts with `replace_class_event_script`, and record them.
   Regenerate it again after adding shared scripts, so the local check
   sees them.
7. Regenerate the OpenAPI spec and client if the API surface changed.
