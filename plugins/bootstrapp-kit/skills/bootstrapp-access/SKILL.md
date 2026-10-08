---
name: bootstrapp-access
description: Decide who can do what in a BootstrApp app - profiles (roles), per-class, per-field and per-relation permissions, row constraints such as "only their own records", which profiles run each action, sign-in providers and sign-up, and the app's users and organizations. Use when the user talks about roles, permissions, access, visibility, multi-tenant or per-company data, login/sign-up, or inviting users.
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
  relation permissions, and **constraints**: row filters such as
  `ownerId Eq {{context "UserId"}}`.
- Per action: the list of profiles that can run it (`Admin` always can).
- Sign-in: which identity providers, whether sign-up is **open** (anyone who
  signs in gets the **signup profile**) or **invite only**.

The backend enforces all of it on every CRUD, filter and action call, so the
client never needs actions "for security". The client should still hide
controls a profile can't use.

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
- **Inheritance is first match, constraints are AND.** For a profile with
  `inheritsFrom: [A, B]`, each class, field and relation permission comes
  from the first of [profile, A, B] that has an entry, without merging; the
  constraints of all three apply together. So a `Manager` inheriting from a
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

## Users and organizations

People are data, not design, so there are no manifests for them. Users and
organizations belong to the app's account, which the developer's other apps
share.

| Tool | Use |
|---|---|
| `get_users` | Who has access: profile, organization, active or invited |
| `invite_user` | Give an email a profile (creates an invitation if they have no user yet; no email is sent, so tell the user to share the app's URL) |
| `assign_user_profile` | Change someone's profile |
| `remove_user_access` | Take the app away (the user stays in the account) |
| `get_organizations`, `add_organization`, `set_user_organization` | Group users, which `{{context "OrganizationId"}}` constraints use |

These change who can get into a real app: **confirm each call with the user**,
naming the person and the profile. Changes apply from the person's next sign
in. Invite-only apps need an invitation for everyone, including testers.

Only the app's owner can use the access, auth and user tools; anyone else
gets an error saying so.

## Checking it works

Sign in to the client as a test user with each restricted profile (invite a
second address) and try one read and one write that should succeed and one
that should fail. A spec generated with `generate_openapi_spec` reflects the
caller's own (full) access, not a restricted profile's.
