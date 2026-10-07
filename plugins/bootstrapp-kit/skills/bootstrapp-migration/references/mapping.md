# Migration mapping details

## Where to look, by stack

| Stack | Models | Endpoints |
|---|---|---|
| Node + Prisma | `prisma/schema.prisma` | `src/**/routes`, `pages/api`, `app/**/route.ts` |
| Node + TypeORM / Sequelize / Drizzle | `**/entities`, `**/models`, `**/schema.ts` | Express/Nest controllers |
| Mongoose | `**/models/*.ts` (`new Schema(`) | as above |
| Django | `*/models.py` | `urls.py`, `views.py`, DRF serializers |
| Rails | `db/schema.rb`, `app/models` | `config/routes.rb`, `app/controllers` |
| .NET | `DbContext`, entity classes, migrations | controllers, minimal APIs |
| Firebase | Firestore rules, `collection(` calls | Cloud Functions |
| Flutter/mobile only | model classes, JSON serializers | repository/service classes |
| Any | existing `openapi.*`, `*.graphql` | same |

## Field translation

| Source | ObjectType property |
|---|---|
| `id` int/serial | `_id` uuid (new) + `legacyId` integer, indexed, during migration |
| `uuid` primary key | `_id` uuid; keep the same values on import if the platform accepts them, otherwise `legacyId` |
| foreign key column | `<name>Id` uuid + `foreignKeys` entry + indexed |
| `varchar(n)` / `text` | `string` with `maxLength` when meaningful |
| `decimal(p,s)` money | integer minor units, or string decimal |
| `float`/`double` | `number` |
| `boolean` | `boolean` |
| `timestamp` / `datetime` | `string`, `format: date-time` |
| `date` | `string`, `format: date` |
| `enum` / check constraint | `string` with `enum` |
| `json` / `jsonb` | inline object schema when the shape is known; avoid untyped blobs |
| array column | `array` of the element type |
| blob / file | store elsewhere; keep a URL string |
| `created_at`/`updated_at` set by DB | set in the action script, or by the client on create/update |

## Logic translation

| Source pattern | Target |
|---|---|
| validation only (required, length, format) | JSON Schema keywords + client-side form validation |
| "on create set X" defaults | `default` in the schema, or the client |
| state machine transitions | an `Instance` action per transition (`submitOrder`, `cancelOrder`) |
| batch operations | `Bulk` action |
| reports / aggregates | `Class` action returning a summary class |
| DB transaction across tables | one action that validates everything, then writes |
| triggers | fold into the action that causes the write |
| cron jobs / queues / webhooks / emails | check `platform.d.ts` and the platform for support; otherwise keep on the old backend and list as a gap |
| per-row permission checks | platform group-based access; if a rule depends on data (owner-only), enforce it inside an action and ask the user how it maps to groups |

## Client cutover patterns

- **Single data layer exists** (repositories/services): implement the same
  interface on top of the generated client wrapper; switch per feature.
- **Calls scattered through components**: first extract a data layer for the
  slice being moved (pure refactor, no behavior change), then switch it.
- **Dual running**: during a slice, reads may come from BootstrApp while
  writes still go to the old backend only if the data is synced; otherwise
  move reads and writes of a class together.

## Data import

- Small data: a script using the generated client (`create<Class>` per
  record), run locally with an admin login.
- Larger data or derived fields: a `Class`-scoped import action that takes a
  batch of records, validates, and creates them; call it in chunks.
- Import parents before children so `<parent>Id` values can be mapped from
  `legacyId`.
- Do a dry run against a copy or a test app first; imports are not
  reversible through MCP.
