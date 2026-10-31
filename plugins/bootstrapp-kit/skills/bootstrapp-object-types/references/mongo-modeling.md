# Relationship shapes on BootstrApp

How common relationships map to the platform's mechanisms. General MongoDB
modeling (embed what is read together and bounded, reference what grows or
is shared) applies as usual; this is the BootstrApp side of it.

| Relationship | Shape |
|---|---|
| 1:1 or 1:few owned (address, order lines) | embedded class by `$ref`, directly or as array `items` |
| keyed set owned (settings per locale) | `additionalProperties: {"$ref": ...}` |
| 1:many (project, tasks) | top-level child with `projectId`: `foreignKeys` entry, indexed |
| many:many without data (posts, tags) | `tagIds` array of uuids on the side read most, `foreignKeys` entry (multi reference; reads return only the ids) |
| many:many with data (enrollment with a grade) | top-level link class with both ids |
| map keyed or valued by ids | `additionalProperties: {type: string}` + `foreignKeys` with `dictionaryPart` |
| polymorphic rows read together (card or bank payment) | discriminated base (`kind`) + variants; or one flat class with a `kind` enum when variants differ by a field or two |
| shared shape, never read together | `baseObjectType` without a discriminator (separate collections) |
| users, organizations | plain uuid fields (`ownerId`, `organizationId`), no `foreignKeys` target in the app |
| files | `@system.files`; keep the file id as a string field |

Platform limits that change the design:

- Filters are AND-only over a class's own indexed fields, with no joins,
  OR or aggregation: those become several client calls, denormalized
  fields, or an action.
- A reference's target must be top level. It needn't exist yet: the
  server saves a class whose base, embedded classes or foreign key targets
  are missing and lists them, so classes that reference each other are
  each added once, in any order. The class isn't usable until they exist.
- `integer` is 32-bit; there is no `byte`/`binary`.
- Writes that must change several documents together need an action with a
  transaction; work that must follow every write is a class event script.
