---
name: bootstrapp-client
description: Generate and wire a strongly typed API client for a BootstrApp app from the OpenAPI spec the MCP server produces, including the thin wrapper module, OIDC login, and regeneration after model changes. Use when the user wants the client generated or refreshed, or when an existing frontend needs to start calling BootstrApp.
license: Proprietary. Copyright (c) 2026 Crochik Software Solutions, LLC. Use requires agreement to its license terms and its prior written authorization; see LICENSE.
---

# Generating the typed client

The OpenAPI spec reflects whatever classes and actions are **registered** on
the backend right now, so generate it after registering. Local manifests that
were never applied won't be in it.

## Steps

1. **Spec.** Call `generate_openapi_spec` with the app name. Download the URL
   straight to disk: `curl -fsSL -o bootstrapp/generated/openapi.yaml "<url>"`
   (single-use URL; don't print the file, it is large). Confirm it is
   non-empty and starts with `openapi:`.
2. **Settings.** Read `client` in `bootstrapp/app.json`; if missing, pick
   defaults from the app's stack and write them back:
   - `language`: `typescript` for web/Node, `flutter` for Dart, otherwise the
     app's language.
   - `outputDir`: a dedicated folder used only for generated code
     (`src/generated/bootstrapp`, `lib/generated/bootstrapp`). It is permanent;
     every regeneration targets the same path.
   - `wrapper`: the hand-written module the rest of the app imports
     (`src/lib/bootstrapp.ts`, `lib/bootstrapp/client.dart`).
3. **Generate.** In order of preference:
   - The BootstrApp generator, when `bootstrapp-gen-<language>` is on `PATH`:
     `bash <this skill's folder>/scripts/generate_api.sh "$(pwd)/bootstrapp/generated/openapi.yaml" <outputDir> <language>`
     (first argument must be absolute).
   - Otherwise a standard OpenAPI generator for the language. Ask before
     adding the dependency, and record the exact command in `app.json` as
     `client.command` so regeneration is one step.
4. **Wrap.** Create or update the wrapper module: base URL from env, access
   token injection, error mapping, and a few typed helpers the app needs.
   App code imports only the wrapper. Never edit, move, or reformat files in
   `outputDir`; customizations go in the wrapper so regeneration stays a
   drop-in replacement.
5. **Compile.** Run the project's type check or build and fix the wrapper or
   call sites, not the generated code.

## What the API looks like

- Per top-level class: filter, create, update, delete operations. Filter
  takes `{ conditions: [{ field, operator, value? }], fields: [...] }`, AND
  only, on indexed fields; the response contains only the listed fields plus
  `_id`, so always pass every field the screen shows. Operators and value
  rules: the server's filter-operators resource.
- Update is a `PATCH`: send only the fields the user changed, not the
  whole record (a form diffs against what it loaded). Fields left out or
  `null` keep their value, so a field can't be cleared back to null;
  `0`, `""` and `false` are written; an embedded object or array is
  replaced whole, so send all of it when it changes. Posting the full
  record back would overwrite whatever another user or action changed
  since it was read.
- Per action: two operations taking the input class. The plain one streams
  the run as server-sent events; the `/Result` one answers once with the
  output class as JSON. Use `/Result` unless the screen shows the progress
  of a long action. Instance and bulk actions take the object id in the
  path.
- Filter results have no total. Page with `top` and `skip` (at most 99 per
  page) until a page comes back short. Array fields: `Eq` with `[x]` is
  "contains x", `In` is "holds any". Full text search is the condition
  `{ field: "#text", operator: "Eq", value: "words" }` (any word matches).
  The rest: the server's `platform-notes.md`, "Filtering and reading data".
- Sort parameters: use them only if the generated signature has them.
- Discriminated classes (variants with `discriminatorValue`, see
  `bootstrapp-object-types`): list and filter
  through the base to show all variants together, and switch on the
  discriminator field to render each row. Read one record by id through
  the base or its variant. Create and update through the variant's
  operations, sending its discriminator value (the server stores that
  value whatever is sent). Filter through a variant to list only that
  variant.

## Reading data well

- Never load a whole class to filter, count or search on the client. Scope
  every query with conditions, page lists, and name only the fields shown
  (`["_id"]` to count).
- Per-user privacy is a profile constraint (`ownerId Eq UserId`), set with
  the `bootstrapp-access` skill; the backend then filters every read. Don't
  filter by owner on the client as a security measure.
- Which records a profile may *edit or delete* can be narrower than what it
  sees (update and delete constraints). Mirror them in the UI (hide Edit on
  someone else's task, Delete on a submitted order) and still handle the
  server refusing the write.
- Nothing is pushed to the client: refresh what a write affects.

## Uploading files

File bytes never go through an action. When the app uploads files:

1. Call the app's upload action (a script using `system.files`, written
   with the `bootstrapp-apiscript` skill). It returns the file id and a
   presigned `uploadUrl`.
2. `PUT` the raw bytes to `uploadUrl` with `fetch`, no `Authorization`
   header, and the file's real `Content-Type` (the confirm stores it). The url
   expires 10 minutes after it is created, so request it right before
   uploading.
3. Confirm with `PUT /files/api/File({id})/Upload` using the user's token,
   or call the confirm action if the app has one.

Show the file later with the user's token: `GET
/files/api/File({id})/Download` redirects to a short-lived url, and `GET
/files/api/File({id})/Redirect` returns `{ Success, Message, Url }` with
that url, for an `<img src>` or a download link (which can't send the
token; request a fresh one each time, it expires in 10 minutes). An action
whose script returns `files.getDownloadUrl(id)` works too. Only the
uploader and the profiles the upload action listed in `downloadProfiles`
may read it. These file routes are platform endpoints, not in the app's
generated spec, so call them through the wrapper with the same token.

## Named views

A query the app runs again and again (open orders, my tasks) is a **named
view**: a typed helper in the wrapper, such as `openOrders()`, that bundles
the filter conditions, the `fields` it returns, an optional label field, and
sort and limit. List screens call views, not raw filters, so each query lives
in one place. Every condition field must be in the class's `indexedFields`;
if a view needs another one, add it to the class manifest and sync before
writing the view. One-off queries can call the filter operation directly
under the same rules.

## Auth

Read the server's auth-config resource first; it is authoritative. In short:
OIDC authorization code with PKCE on every platform, request only `openid`,
read user info from the access token's claims, `client_id` is the app name
for TypeScript web apps (from env elsewhere), tokens in platform-appropriate
secure storage, and always a user-initiated login entry point. Register every
redirect URL (dev and deployed) with `add_oidc_client_redirect`, or login
fails there. Surface authorization errors from the backend; don't re-implement
access rules on the client.

## New frontends

For an app with no UI yet, use the stack's own scaffolder in the
repository (web defaults to React + TypeScript with Vite, mobile to
Flutter), then:

1. Generate the client into it and write the wrapper (steps above).
2. Wire sign-in first (see Auth above) and confirm login, logout and an
   authenticated call work.
3. Add one real read screen (a named view) and one real write against live
   data. No stubs.
4. Document how to run it and the env variables in the README.

## Existing frontends

When the app already has an API layer (fetch calls, axios services, a
GraphQL client, repositories), keep its interface and swap the
implementation behind it to the wrapper, one feature at a time. The
`bootstrapp-migration` skill's plan says which features move first.

## Secrets

`.env.example` documents the variables (API base URL, client id where
applicable); `.env` stays out of git.
