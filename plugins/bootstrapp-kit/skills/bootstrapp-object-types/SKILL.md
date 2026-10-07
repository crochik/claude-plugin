---
name: bootstrapp-object-types
description: Design BootstrApp ObjectTypes (classes) - the JSON Schemas that are both the MongoDB document and the API model - including top-level vs embedded, references, inheritance, indexed fields and naming. Use when creating, reviewing or changing the data model of a BootstrApp app, or when translating an existing app's models (SQL tables, ORM models, Mongoose schemas, TS types) into ObjectTypes.
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

Before you start, read the `bootstrapp` skill (folder layout, MCP tools) and,
if the MCP server is reachable, its schema-conventions and filter-operators
resources. The output of this skill is one manifest per class in
`bootstrapp/classes/` (format: the `bootstrapp` skill's
`references/manifests.md`).

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
   Registration cannot be undone through MCP, so a quick look from the user
   before the first push of a new class is worth it.

## Modeling rules for MongoDB

The full checklist with examples is in
[references/mongo-modeling.md](references/mongo-modeling.md). The core:

- **Top-level** when the thing is queried on its own, referenced from more
  than one place, has its own lifecycle, or can grow without bound.
  **Embedded** when it only makes sense inside its parent and is read with it
  (an order's lines, an address, a settings block).
- **Embed bounded, reference unbounded.** An array that can grow forever
  (comments, events, log entries) becomes its own top-level class with a
  `<parent>Id` reference. MongoDB documents cap at 16 MB and large arrays make
  every read and write expensive.
- **References** are `<name>Id` fields, `{ "type": "string", "format": "uuid" }`,
  declared in `foreignKeys` and listed in `indexedFields`. Many-to-many: an
  array of ids on the side that is read more, or a top-level link class when
  the link carries data.
- **Denormalize deliberately.** Copying a display field (`customerName` next
  to `customerId`) saves a lookup on every list screen, but someone must keep
  it in sync; note who (an action, or the client on update) in `$notes`.
- **Index only what you filter or sort on.** Filters and `orderBy` accept
  indexed fields only; anything else is rejected. Always `_id` and every
  reference field; then the fields real queries use. Embedded classes use
  `[]`.
- **Inheritance** is single-parent with a discriminator string on the base
  (`kind: "card" | "bank"`); children set `baseObjectType`. Prefer a flat
  class with a discriminator and optional blocks when the variants are small.
- **Types that survive the trip.** Money as integer minor units
  (`amountCents`) or a decimal string, never a float. Dates as strings with
  `format: date` or `date-time`. Enums as `enum` on a string. No
  `byte`/`binary`; store files elsewhere and keep a URL.
- **Users** are platform objects. Store `ownerId`, `assigneeId`, … as uuid
  strings. Never define `User` or `Group`. Authorization is group-based and
  enforced by the platform; don't add ACL fields.

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
  top-level classes elsewhere behave (see the platform notes).
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

## Changing a class that is already applied

There is no update tool. If the state helper says a class changed after it
was applied, follow "Changing things already applied" in the `bootstrapp`
skill. Adding a brand-new class is always fine.

## Hand-off

When classes change, the next useful steps are usually: regenerate
`generated/platform.d.ts` if scripts use those classes, and regenerate the
OpenAPI spec and client if the app consumes them. Mention them; don't force
them.
