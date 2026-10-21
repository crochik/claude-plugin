---
name: bootstrapp-access
description: Decide who can do what in a BootstrApp app - profiles (roles), per-class, per-field and per-relation permissions, row constraints such as "only their own records", update and delete constraints such as "everyone reads, only the owner edits", which profiles run each action, sign-in providers and sign-up, the app's users and organizations, and giving an app access to another app's classes. Use when the user talks about roles, permissions, access, visibility, multi-tenant or per-company data, login/sign-up, or inviting users.
license: Proprietary. Copyright (c) 2026 Crochik Software Solutions, LLC. Use requires agreement to its license terms and its prior written authorization; see LICENSE.
---

# Access control in a BootstrApp app

Read the `bootstrapp` skill first for the folder layout and sync. The server
publishes the authoritative reference as the `access-control.md` resource
(`bootstrapp://reference/access-control.md`); read it when a detail below
matters, since **the server's copy wins**.

## The model in five lines

- An app has **profiles** (roles). Each user holds **one profile per app**.
- `init_app` creates the **`Admin`** profile. It always has full access to
  everything and can't be restricted; the app owner has it. Every other
  profile starts with **no access** until it is granted.
- Per profile and class: class permissions (`Read`, `Create`, `Update`,
  `Delete`, ...), field permissions (a field can be hidden or read-only),
  relation permissions, **constraints**: row filters such as
  `ownerId Eq {{context "UserId"}}`, and **update/delete constraints**,
  which narrow which of the visible records it may change or delete.
- Per action: the list of profiles that can run it (`Admin` always can).
- Sign-in: which identity providers, whether sign-up is **open** (anyone who
  signs in gets the **signup profile**) or **invite only**.

The backend enforces all of it on every CRUD, filter and action call, so the
client never needs actions "for security". The client should still hide
controls a profile can't use. Action scripts follow the same rules, except a
script saved `elevated`, which ignores the caller's profile and does its own
checks; when a profile is denied something only so an action can do it in a
controlled way, that action is elevated (the `bootstrapp-apiscript` skill).

## Interview before writing anything

Ask, in plain words, and propose defaults:

1. **Who uses the app?** One line per kind of person ("employees submit
   expenses", "managers approve", "finance sees everything"). Each becomes a
   profile, named in PascalCase (`Member`, `Manager`, `Finance`). The app's
   developer already has `Admin`; don't create a profile for them.
2. **What may each see and change, per class?** Fill a small table:
   class × profile → none / read / read-write / full, plus any field that is
   hidden or read-only for someone (salary, internal notes, status that only
   managers set).
3. **Which records?** All of them, only their own, only their organization's,
   or by a status. "Only their own" needs an owner field on the class
   (`ownerId`, a uuid set to `{{context "UserId"}}`); "their company's" needs
   `organizationId` (`{{context "OrganizationId"}}`). Add the field to the
   class manifest *before* writing the constraint.
   Ask separately **which of those records each may change or delete**:
   "everyone sees the team's tasks, only the owner edits them" or "members
   can't touch a submitted order" is an update constraint, not a row one.
   A multi-tenant app (each customer sees only its own data) makes every
   tenant an organization: every tenant class gets `organizationId` and every
   tenant profile the constraint on it, tenants never use the default
   profile, and onboarding creates the organization and invites the first
   user into it (the tools, or an elevated script with
   `system.user.createOrganization` + `invite`). Read "Multi-tenant apps" in
   the server's `access-control.md` for the limits.
4. **Which actions** each profile may run.
5. **How do people get in?** Providers (Microsoft, Google, Salesforce,
   GitHub), open sign-up or invite only, and which profile new users get.
   Open sign-up with `Admin` gives strangers full access: always pick a
   restricted signup profile.

Show the resulting table to the user before writing manifests.

## Manifests

All under `bootstrapp/`, each the exact arguments of one tool call
(`appName` comes from `app.json`; `$`-keys are notes). Formats with examples
are in the `bootstrapp` skill's [references/manifests.md](../bootstrapp/references/manifests.md).

| File | Tool | Holds |
|---|---|---|
| `profiles/<Profile>.json` | `add_profile` / `replace_profile` | `profileName`, `description`, `inheritsFrom?` |
| `access/<Profile>/<fullObjectType>.json` | `replace_class_access` | everything one profile has on one class |
| `access/actions/<actionName>.json` | `replace_action_access` | profiles that run the action, besides `Admin` |
| `auth.json` | `replace_app_auth` | providers, sign-up mode, signup profile, tenants, claims |

Rules worth knowing while writing them:

- **One file states the whole access** of a profile on a class; applying it
  replaces what was there. `permissions: []` removes the profile's access.
- **Fields not listed follow the class**: `Read` if the class grants Read,
  `Update` if Update, `SetOnCreate` if Create. List only exceptions:
  `"salary": []` hides it, `"status": ["Read"]` makes it read-only,
  `"approvedBy": ["Read", "SetOnCreate"]` lets it be set only on create.
  `defaultFieldPermissions` changes the default for the unlisted ones.
- **Base-class fields are set on the base class**: write a second access file
  for the base class.
- **Constraints**: operators `Eq, Ne, Gt, Gte, Lt, Lte, In, Nin`; values are
  literals or `{{context "Key"}}` (`UserId`, `OrganizationId`, `AccountId`,
  `EntityId`, `ProfileId`, `ClientId`, the lists `AllProfileIds`,
  `AllUserIds`, `AllOrganizationIds`, `AllEntityIds`, and `Claims.<name>`
  from `auth.json`'s `calculatedClaims`). `In`/`Nin` take a list or an `All*`
  key. Constraints apply to top-level classes only.
- **An `Eq` constraint also stamps the field on create**: `ownerId Eq
  {{context "UserId"}}` limits the profile to its records *and* fills
  `ownerId` on the records it creates. The client doesn't send it.
- **Update and delete constraints** (`updateConstraints`,
  `deleteConstraints`) narrow, within what the profile sees, which records it
  may update and delete. A delete must match the row, update *and* delete
  constraints. They need the `Update`/`Delete` permission (they never grant
  it), take top-level fields only, and stamp nothing on create.
- **They test the record as stored, before the change**, not the new values.
  A profile that can update `ownerId` can give the record away, and one that
  can update `status` can move it out of a `status Eq Draft` constraint (fine
  for "submit locks it"). Make the fields they test read-only with
  `fieldPermissions` when that must not happen. With an update constraint
  on `ownerId` and no row constraint, nothing stamps the owner: the client
  sends it (`["Read", "SetOnCreate"]`) or a create action sets it from
  `system.session`.
- **Inheritance is first match, constraints are AND.** For a profile with
  `inheritsFrom: [A, B]`, each class, field and relation permission comes
  from the first of [profile, A, B] that has an entry, without merging; the
  constraints (row, update, delete) of all three apply together. So a `Manager` inheriting from a
  constrained `Member` is still constrained; give `Manager` its own access
  file for that class instead of relying on inheritance there.

`bootstrapp-state.mjs check` validates all of this offline (unknown
permissions, fields, operators, context keys, profiles; `Admin` misuse).

## Applying

Through the normal sync (`bootstrapp` skill). `plan` orders the calls:
profiles, classes, class access, actions, action access, scripts, auth.
After a class is replaced, its access files show as `recheck` and are applied
again: new fields would otherwise be hidden from every profile but `Admin`.

To see what the backend has: `get_profiles`, `get_class_access`,
`get_actions` (its `profiles` list), `get_app_auth`. Use them to adopt an
app whose access was set elsewhere, writing what they return into manifests.

Removing things is not a manifest change, because deleting a file does
nothing on the server. Confirm with the user, then call `remove_class_access`
or `remove_profile` (`reassignUsersTo` when the profile has users) and delete
the file and its `applied.json` entry.

For a deployed web client, also allow its origin (`add_oidc_client_origin`)
and redirect URL (`add_oidc_client_redirect`).

## Classes from another app

An app can use classes it doesn't own: another of the developer's apps'
classes, or classes created outside the MCP server. The app that uses them
holds the grant, in its own `access/` folder, with `"profileApp": "<this
app>"` (format in [references/manifests.md](../bootstrapp/references/manifests.md)):

- Grant **`Admin` first**. `generate_platform_definitions`,
  `generate_openapi_spec` and script validation include every class the
  app's `Admin` profile can create, read or update, whatever its namespace,
  and `Admin` has no access to a class it doesn't own until granted. Then
  grant each restricted profile that needs it.
- Regenerate `platform.d.ts` and the OpenAPI spec after the grant; read the
  class with `get_object_class(fullObjectType, appName: "<this app>")`.
  Discover it first: `get_object_classes(namespace)` lists other apps'
  classes, and an account admin can list namespaces outside `app.*`.
- Only an account admin can share a class, and must own both apps. The
  server refuses a class whose records aren't limited to the account. The
  grant is stored on the class, so the owning app's
  `get_class_access` shows it under `otherEntries` with `app` and `profile`.
- Ask the user before granting: the other app's records become visible to
  this app's users, as far as the grant allows. Prefer `ReadOnly`, and hide
  fields this app doesn't need.
- Constraints can't be added to a class created outside the MCP server that
  has none: its first one would replace the platform's default record filter
  for every user of the class. Such a class may also grant access by role
  (`otherEntries`), which applies to this app's users too.
- Actions of that class: `access/actions/<actionName>.json` with
  `profileApp`, listing this app's profiles (`Admin` included).
- Scripts can import the class's module. An elevated script (or a shared
  script it calls) ignores the grant and reaches every record of the class.

## Users and organizations

People are data, not design, so there are no manifests for them. Users and
organizations belong to the app's account, which the developer's other apps
share.

| Tool | Use |
|---|---|
| `get_users` | Who has access: id, profile, organization, active or invited |
| `invite_user` | Give an email a profile by creating an invitation, even if the account already has users with that email (no email is sent, so tell the user to share the app's URL) |
| `assign_user_profile` | Change someone's profile |
| `remove_user_access` | Take the app away (the user stays in the account) |
| `get_organizations`, `add_organization`, `set_user_organization` | Group users, which `{{context "OrganizationId"}}` constraints use |

One email can belong to several users: the developer's own admin user and
a tenant user, or the same person in two organizations. `invite_user`
always creates a new invitation and the person picks which user to be when
they sign in; it refuses only when one of them already has the app in the
same organization (use `assign_user_profile` for that one). When an email
matches more than one user of the app, pass the `id` from `get_users` as
`userId` to the other user tools.

Admin users can't belong to an organization: `set_user_organization` and
`system.user.invite(..., organization)` refuse them. To give an admin a
tenant login, use `invite_user` with their email and the organization;
that makes a separate user.

These change who can get into a real app: **confirm each call with the user**,
naming the person and the profile. Changes apply from the person's next sign
in. Invite-only apps need an invitation for everyone, including testers.

Only the app's owner can use the access, auth and user tools; anyone else
gets an error saying so. Like every app tool, they also need the user's
developer access (see the `bootstrapp` skill).

When the app itself must do this (a sign-up action that creates the
customer's organization and invites its first user), an action script can:
`system.user` has `getOrganizations`, `createOrganization`,
`updateOrganization` and `invite(email, profile, name?, organization?)`.
They need the caller's permission on users and organizations, so they are
usually elevated scripts that check the caller first (see the
bootstrapp-apiscript skill).

## Checking it works

Sign in to the client as a test user with each restricted profile (invite a
second address) and try one read and one write that should succeed and one
that should fail. A spec generated with `generate_openapi_spec` reflects
the default `Admin` profile's (full) access, not a restricted profile's.
`invoke_action` with `profileName` tries an action with a restricted
profile's access without signing in as someone else.
