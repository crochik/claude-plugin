---
name: bootstrapp-client
description: Generate and wire a strongly typed API client for a BootstrApp app from the OpenAPI spec the MCP server produces, including the thin wrapper module, OIDC login, and regeneration after model changes. Use when the user wants the client generated or refreshed, or when an existing frontend needs to start calling BootstrApp.
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
   - Otherwise a standard generator the project can own. Propose one and ask
     before adding a dependency, e.g. TypeScript: `openapi-typescript` for
     types plus `openapi-fetch` for calls; Dart/Flutter and other languages:
     `openapi-generator-cli generate -g dart-dio` (or the language's
     generator). Record the exact command in `app.json` as
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
- Per action: one operation taking the input class, returning the output
  class.
- Sort/limit parameters: use them only if the generated signature has them;
  otherwise sort and slice client-side.

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

For an app with no UI yet, use the platform's own scaffolder in the
repository (web: `npm create vite@latest` with React + TypeScript unless the
user picks another stack; Flutter: `flutter create`; desktop: the framework
the user chose), then:

1. Generate the client into it and write the wrapper (steps above). Web: a
   `src/lib/bootstrapp.ts` module, with React Query or SWR for caching.
   Flutter: a `lib/bootstrapp/` package exposing repositories, `dio` or
   `http`, and `flutter_secure_storage` for tokens. CLI: one module reading
   credentials from env or the OS config folder.
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
