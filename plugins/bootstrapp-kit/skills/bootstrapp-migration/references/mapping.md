# Migration mapping details

## Field translation

Only the rows where BootstrApp differs from a straight type mapping:

| Source | ObjectType property |
|---|---|
| `id` int/serial | `_id` uuid (new) + `legacyId` integer, indexed, during migration |
| `uuid` primary key | `_id` uuid; keep the same values on import if the platform accepts them, otherwise `legacyId` |
| foreign key column | `<name>Id` uuid + `foreignKeys` entry + indexed |
| join table without extra columns | `<name>Ids` array of uuids on the side read most + `foreignKeys` entry |
| `decimal(p,s)` money | integer minor units, or string decimal |
| `bigint` | `number` or string: `integer` is 32-bit |
| `timestamp` / `date` | `string` with `format: date-time` / `date` |
| `json` / `jsonb` | an embedded class when the shape is known; avoid untyped blobs |
| blob / file | uploaded through `system.files`; the class keeps the file id as a string |
| `created_at`/`updated_at` set by DB | a class event script, the action script, or the client |

## Logic translation

| Source pattern | Target |
|---|---|
| validation only (required, length, format) | JSON Schema keywords + client-side form validation |
| "on create set X" defaults | `default` in the schema, or the client |
| state machine transitions | an `Instance` action per transition (`submitOrder`, `cancelOrder`) |
| batch operations | `Bulk` action |
| `UPDATE … SET … WHERE …` (same change to many rows) | `updateMany<Class>(filter, operations)` in the action's script |
| reports / aggregates | `Class` action returning a summary class |
| DB transaction across tables | one action that validates everything, then writes in a `system.mongodb` transaction |
| triggers | a class event script (runs after every create or update of the class), or fold into the action that causes the write |
| cron jobs / queues / webhooks / emails | check `platform.d.ts` and the platform for support; otherwise keep on the old backend and list as a gap |
| per-row permission checks | profile access; a rule that depends on data (owner-only, same organization) is a profile constraint (`ownerId Eq {{context "UserId"}}`), see `bootstrapp-access` |

## Client cutover

Switch one slice at a time behind the app's data layer (extract one first
if calls are scattered). Move a class's reads and writes together unless
the data is synced both ways.

## Data import

- Small data: a script using the generated client (`create<Class>` per
  record), run locally with an admin login. A handful of records can also
  go in with the MCP `create_object` tool.
- Larger data or derived fields: a `Class`-scoped import action that takes a
  batch of records, validates, and creates them with `bulkCreate<Class>` (when
  `platform.d.ts` has it), returning the per-record results so failures
  can be retried; call it in chunks.
- Import parents before children so `<parent>Id` values can be mapped from
  `legacyId`.
- Do a dry run against a copy or a test app first; imports are not
  reversible through MCP.
