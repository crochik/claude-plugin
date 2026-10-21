---
name: bootstrapp-migration
description: Move an existing application's backend onto BootstrApp - inventory its data models, endpoints, business logic and auth, map them to ObjectTypes, generated CRUD/filter endpoints, actions and ApiScripts, and plan an incremental cutover. Use when the user has an existing codebase (any stack) and wants to adopt BootstrApp for part or all of its backend.
license: Proprietary. Copyright (c) 2026 Crochik Software Solutions, LLC. Use requires agreement to its license terms and its prior written authorization; see LICENSE.
---

# Migrating an existing app to BootstrApp

The goal is a plan the user agrees with and can execute in slices, not a big
bang. The app keeps working throughout: features move one at a time behind
the app's existing data-access layer.

## 1. Inventory (read-only)

Work out what the current backend does. For a large codebase, delegate the
reading to the `bootstrapp-migration-analyst` agent (or another subagent) so
the main conversation keeps only the findings: data models, endpoints and
jobs, the business logic each non-trivial endpoint enforces (what it writes
together, external calls), auth and row-level rules, where the client calls
the backend (one layer or scattered), and data volume (largest tables,
anything unbounded per parent).

## 2. Map

Produce a mapping table per area:

| Existing | BootstrApp | Notes |
|---|---|---|
| table/model | top-level or embedded ObjectType | per the `bootstrapp-object-types` rules |
| plain CRUD/list endpoint | generated create/update/delete/filter | check filters only need indexed fields, AND-only |
| endpoint with logic, multi-write, or aggregate | action + ApiScript | per `bootstrapp-actions`; port the logic per `bootstrapp-apiscript` |
| service function or helper shared by several endpoints | a shared script the action scripts call | per `bootstrapp-apiscript`; an action only if clients call it too or it needs more access than its callers |
| logic needing a capability scripts lack | stays outside (existing service, or a gap to raise) | check `platform.d.ts` |
| roles/permissions | profiles, class/field access and constraints (enforced server-side) | per `bootstrapp-access`; don't port ACL fields into schemas |
| login | BootstrApp OIDC | per `bootstrapp-client` auth section |
| work that follows every write (DB triggers, model hooks) | class event script | per `bootstrapp-apiscript` |
| file storage | `system.files` uploads through an action | per "Files" in `bootstrapp-apiscript` |
| calls to third-party APIs (payments, email services, webhooks it sends) | an action calling `system.http.fetch`, with a network policy for that host | per "HTTP calls" in `bootstrapp-apiscript`; keys stay out of the client |
| background jobs, webhooks | out of scope unless the platform exposes them | list as open items |

Mark anything that doesn't fit (OR queries, joins, aggregation pipelines,
capabilities `platform.d.ts` lacks) and propose the workaround: client-side
composition, denormalization, an action, or keeping that piece on the old
backend for now. Full text search (`#text`), multi-document transactions
(an action script with `system.mongodb`) and file storage (`system.files`)
do fit.

## 3. Plan the cutover

Write `bootstrapp/MIGRATION.md` with:

1. **Scope and order**: slices, each a user-visible feature with its classes,
   actions and client changes. Start with something small and read-heavy;
   leave auth-sensitive and write-heavy features for later slices, unless
   auth itself must move first.
2. **Data**: how existing records move (export, transform to the new shapes,
   import through the generated client or a `Class`-scoped import action),
   how ids map (keep `legacyId`, indexed, until the old system is gone), and
   whether there is a dual-write or read-only window.
3. **Client switch**: which data-access module changes per slice, behind a
   flag if the app has one.
4. **Gaps and decisions** the user must make.

Show the user the mapping and the first slice. Proceed with the first slice
on your recommended defaults unless they redirect; anything irreversible
(registering classes and actions on their backend, importing production
data) waits for their go-ahead.

## 4. Execute slice by slice

For each slice: write the class manifests (`bootstrapp-object-types`) and
action manifests and scripts (`bootstrapp-actions`, `bootstrapp-apiscript`),
check, apply, regenerate the client (`bootstrapp-client`), switch the
slice's data access to the wrapper, run the app's tests, and update the
slice's status in `MIGRATION.md`.

Never delete the old backend code or data as part of a slice; removal is a
separate step the user asks for.

Mapping details and edge cases:
[references/mapping.md](references/mapping.md).
