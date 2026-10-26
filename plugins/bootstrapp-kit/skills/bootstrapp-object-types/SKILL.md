---
name: bootstrapp-object-types
description: Design BootstrApp ObjectTypes (classes) - the JSON Schemas that are both the MongoDB document and the API model - including top-level vs embedded, references, inheritance, indexed fields and naming. Use when creating, reviewing or changing the data model of a BootstrApp app, or when translating an existing app's models (SQL tables, ORM models, Mongoose schemas, TS types) into ObjectTypes.
license: Proprietary. Copyright (c) 2026 Crochik Software Solutions, LLC. Use requires agreement to its license terms and its prior written authorization; see LICENSE.
---

# Designing ObjectTypes

An ObjectType is one JSON Schema that BootstrApp uses three ways at once:

1. **Storage**: a top-level ObjectType is a MongoDB collection; each object is
   one document shaped exactly like the schema.
2. **API**: the platform generates create / update / delete / filter
   endpoints for every top-level class, and the OpenAPI spec (and therefore
   the generated client's types) is derived from the same schema.
3. **Scripts**: ApiScripts get typed `filter/create/update/delete` functions
   and a type per class.

So there is one model, not a database model plus DTOs. Design each class as
"the document I want to read and write in one go". Only action payloads get
their own classes (see `bootstrapp-actions`).

Before you start, read the `bootstrapp` skill (folder layout, MCP tools) and
the server's `bootstrapp://reference/` resources `schema-conventions.md`,
`platform-notes.md` ("Classes") and `filter-operators.json`. The output of
this skill is one manifest per class in `bootstrapp/classes/` (format: the
`bootstrapp` skill's `references/manifests.md`).

## Workflow (adapt to the request)

1. **Find what exists.** Read `bootstrapp/app.json` and the class manifests
   relevant to the change. For an existing codebase with no `bootstrapp/`
   folder, start from the `bootstrapp-migration` skill's inventory instead of
   inventing a domain.
2. **Get the access patterns.** Which screens and jobs read what, which
   lists filter or sort by what, what is written together. One short
   exchange with the user is usually enough; if they already described it,
   don't re-ask.
3. **Decide the shape** using the rules below. For anything non-trivial,
   show the user a compact outline (class, top-level or embedded, key fields,
   references, indexed fields) and the one or two decisions that carry risk.
   Proceed with your recommended option unless they redirect.
4. **Write the manifests** and run
   `bootstrapp-state.mjs check` (in the `bootstrapp` skill's `scripts/`
   folder). Fix every error.
5. **Apply when asked** (see "Applying" in the `bootstrapp` skill).
   A registered class can be replaced but never deleted through MCP, so a
   quick look from the user before the first push of a new class is worth
   it.

## Modeling rules for MongoDB

Relationship shapes on the platform:
[references/mongo-modeling.md](references/mongo-modeling.md). The core:

- **Top-level** when the thing is queried on its own, referenced from more
  than one place, has its own lifecycle, or can grow without bound.
  **Embedded** when it only makes sense inside its parent and is read with it
  (an order's lines, an address, a settings block).
- **Embed bounded, reference unbounded**: an array that can grow forever
  becomes its own top-level class with a `<parent>Id` reference.
- **References** are `<name>Id` fields, `{ "type": "string", "format": "uuid" }`,
  declared in `foreignKeys` and listed in `indexedFields`. Every property
  that holds ids of other records goes in `foreignKeys`; a plain uuid
  string has no link to the class it points at. The shape picks the field:
  a single id is a reference, an array of ids of one class (`<name>Ids`) a
  multi reference, and a dictionary keyed or valued by ids
  (`additionalProperties: {type: string}`) takes `dictionaryPart: "key"` or
  `"value"`. A single id also gets a **relation** (the read model adds the
  related record, and `Exists` constraints follow it); name it with
  `relationName` (letters, digits, `_`), or leave it out for `Project`
  (the referenced class without its namespace, `project` when taken).
  Relation names sit next to field names in the API (`Project|name`), so
  the server refuses a `relationName` that matches a field or another
  relation of the class, its base classes or the classes extending it, and
  a property named like an existing relation, in either direction. A
  relation keeps its name on replace; record it in the manifest
  (`get_object_class` returns it), and only change it on purpose:
  renaming moves its access and constraints but changes the API paths, so
  regenerate the client. Many-to-many: an array of ids on the side that is read more,
  or a top-level link class when the link carries data. User ids
  (`ownerId`, `assigneeId`) point at platform users, not app classes, and
  stay plain uuid strings.
- **Denormalize deliberately.** A copied display field (`customerName` next
  to `customerId`) needs someone to keep it in sync: note who in `$notes`
  (a class event script on the source class is the usual answer).
- **Index only what you filter or sort on.** Filters accept indexed fields
  only, and script `orderBy` too. Enums sort alphabetically, so a rank
  order (priority) needs a numeric rank field. Always `_id` and every
  reference field; then the fields real queries use. Embedded classes use
  `[]`.
- **Variants** (payments that are a card or a bank transfer) are a
  discriminated base class: the base has a required, indexed string
  (`kind`), and each variant sets `baseObjectType`, `discriminatorField`
  (`kind`) and its `discriminatorValue` and adds only its own fields. The server turns `kind` into an enum of the variants' values
  (`card`, `bank`), so don't list them yourself; an `enum` on the base only
  adds values for plain base records. Top-level variants share the base's
  collection, so one list or filter on the base covers them all, and each
  variant's endpoint covers just its records. The same works for embedded
  classes. Prefer a flat class with an enum and optional fields when the
  variants differ by a field or two. See the server's `platform-notes.md` for the exact
  behavior.
- **Plain inheritance** (`baseObjectType` without a discriminator) only
  reuses fields: each child has its own collection and the base's list
  never includes them. Use it for classes that share a shape but are never
  read together.
- **Types.** Money as integer minor units (`amountCents`) or a decimal
  string. `integer` is 32-bit
  signed whatever `maximum` says; larger values (ARGB colors, byte counts)
  go in a string. Dates as strings with
  `format: date` or `date-time`. Enums as `enum` on a string. No
  `byte`/`binary`: files go to storage through `@system.files` (see the
  `bootstrapp-apiscript` skill) and the class keeps the file id in a
  string field (`receiptFileId`).
- **Users** are platform objects. Store `ownerId`, `assigneeId`, … as uuid
  strings. Never define `User`, `Organization` or `Group`. Access is set per profile and
  enforced by the platform (`bootstrapp-access` skill); don't add ACL fields.
  When some profile should see only its own records, or its organization's,
  the class needs the field the constraint filters on: an `ownerId` (or
  `submittedById`, …) uuid for "their own", an `organizationId` uuid for
  "their organization's". Index it.

## Schema rules (the server rejects or degrades otherwise)

- Root and every property carry `title` and `description`; add `examples`
  (a full example object on the root). The OpenAPI surface and generated
  client use them verbatim.
- Top-level classes declare `_id` as a uuid string, in `required`; the server
  assigns it on create. Embedded classes have no `_id`.
- Names: app and namespace segments snake_case; classes PascalCase;
  properties camelCase.
- Domain classes go directly in `app.<app_name>`. Use sub-namespaces only for
  action payloads (`app.<app_name>.actions`) unless you have confirmed
  top-level classes elsewhere behave (see the server's `platform-notes.md`).
- A class meant for several apps can live outside `app.<app_name>` (e.g.
  `shared.crm.Contact`), and a change to another app's class is possible,
  but both go to the user as **class drafts** (`add_class_draft` /
  `replace_class_draft`): nothing changes until they apply the draft in the
  designer. Drafts hold one class (no inline objects: `$ref` an embedded
  class that exists) and can't be discriminated. Actions and class event
  scripts don't run on top-level classes outside `app.<app_name>`.
- Embed a named class with `{"$ref": "#/components/schemas/<full class
  name>"}` on a property, on array `items` (list) or on
  `additionalProperties` (string-keyed dictionary). The target must be an
  `Embedded` class with its own manifest, registered first. `title` and
  `description` may sit next to the `$ref` to label the field. Never `$ref`
  a top-level class; use a `<name>Id` reference instead.
- Inline nested objects also work and become embedded classes named
  `<Parent>.<property>`; use them for one-off shapes only.
- No multi-branch `anyOf`/`oneOf` inside a class schema.
- `default` on scalar properties becomes the field default.
- Don't name properties after ApiScript keywords (`from`, `as`, `of`,
  `string`, `number`, …): scripts can't read them. `startDate`/`endDate`
  rather than `from`/`to`.
- Full text search over a top-level class's text fields is on by default
  (`#text`); set `"isFullTextSearchable": false` in the manifest for
  classes nobody searches.

## Changing a class that is already applied

`replace_object_class` applies a changed manifest, but stored records are not
migrated. Prefer additive changes (new optional properties); for a removed
or newly required property, say what happens to existing records first.
Details in "Changing things already applied" in the `bootstrapp` skill.

## Hand-off

When classes change, the next useful steps are usually: regenerate
`generated/platform.d.ts` if scripts use those classes, and regenerate the
OpenAPI spec and client if the app consumes them. Mention them; don't force
them.
