# MongoDB modeling checklist for ObjectTypes

## Decide top-level vs embedded

Ask, for each candidate class:

| Question | If yes |
|---|---|
| Will anything list or search it on its own? | top-level |
| Is it referenced from more than one parent class? | top-level |
| Does it outlive or move between parents? | top-level |
| Can the count per parent grow without a known bound? | top-level with `<parent>Id` |
| Is it always read and written together with its parent, and small? | embedded |
| Is it a value (address, money, range, settings)? | embedded |

## Relationship patterns

| Relational shape | Document shape |
|---|---|
| 1:1 owned (user ↔ profile settings) | embed in the owner |
| 1:few owned (order ↔ lines, ≤ ~100) | array of embedded objects |
| 1:many (project ↔ tasks) | top-level child with `projectId` (indexed, foreign key) |
| many:many without data (posts ↔ tags) | array of ids or strings on the side read most |
| many:many with data (students ↔ courses with grade) | top-level link class (`Enrollment` with `studentId`, `courseId`, `grade`) |
| lookup table (status, category used for filtering) | string `enum` if fixed; top-level class if users edit it |
| polymorphic rows | one class + discriminator, or base class + children via `baseObjectType` |
| audit/history | top-level append-only class with `<subject>Id` and timestamp |

## Read-path checklist

- Each list screen: which class, which filters, which sort. Every filtered or
  sorted field is in `indexedFields`.
- Each detail screen: can it be served by one document? If it needs three
  lookups every time, consider embedding or denormalizing.
- Filters are AND-only over direct fields of one class. Anything needing OR,
  joins, or aggregation becomes several client calls or an action.

## Write-path checklist

- What must change together atomically? If two documents must change in one
  step, that's an action (scripts run server-side) or a reason to embed.
- Which denormalized copies exist and who updates them?
- Which fields are server-assigned (`_id`, timestamps set by scripts)?

## Field conventions

| Kind | Schema |
|---|---|
| id / reference | `{ "type": "string", "format": "uuid" }` |
| money | `{ "type": "integer", "minimum": 0 }` named `…Cents`, or string decimal |
| timestamp | `{ "type": "string", "format": "date-time" }` |
| date | `{ "type": "string", "format": "date" }` |
| status | `{ "type": "string", "enum": [...], "default": "..." }` |
| tags | `{ "type": "array", "items": { "type": "string" } }` |
| email / url | `format: email` / `format: uri` |
| geo point | array of two numbers `[lng, lat]` |
| user reference | uuid string, e.g. `ownerId` |

## Migrating from an existing schema

- SQL table → class; primary key → `_id` (generate new uuids and keep the old
  key in `legacyId`, indexed, while migrating).
- Foreign key → `<name>Id` reference; join table → see many:many above.
- Child tables always loaded with the parent → embedded array.
- Nullable columns → optional properties (not in `required`).
- Check constraints / enums → `enum`; triggers and stored procedures → actions.
- ORM-level validation → JSON Schema keywords (`minimum`, `maxLength`,
  `pattern`) where supported, else the client or an action.
