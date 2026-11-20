---
name: bootstrapp-actions
description: Decide whether a BootstrApp operation needs a server-side action, and define it - target class, scope (Instance/Bulk/Class), typed input and output classes, whether its script runs elevated, and registration. Use when the user needs an API operation beyond the auto-generated CRUD and filter endpoints, or when mapping an existing app's custom endpoints onto BootstrApp.
license: Proprietary. Copyright (c) 2026 Crochik Software Solutions, LLC. Use requires agreement to its license terms and its prior written authorization; see LICENSE.
---

# Defining actions

Every top-level class already has create, update, delete and filter
endpoints. An **action** is an extra, named operation registered on a class,
with its own input class and output class, whose body is an ApiScript that
runs on the server.

## Is it an action?

Default to the client chaining CRUD and filter calls, even across classes.
Make it an action only when the client genuinely can't do it that way:

- **Atomic multi-write**: several documents must change together or not at
  all (approve an expense and bump the monthly total). The script makes
  this atomic with a `@system.mongodb` transaction; an action is not atomic by
  itself (see the `bootstrapp-apiscript` skill).
- **Server-side effects**: work that must not run in the client, such as
  enforcing an invariant against data the caller can't see, or using a
  server-only capability. Scripts can only call what `platform.d.ts` declares,
  so check it exposes the capability (email, HTTP calls, files) before promising it.
  An HTTP call also needs a network policy that allows its host, set on the
  action (it binds every script the action's run calls).
- **Computation over data the client shouldn't fetch**: totals over many
  rows, checks against other users' data.

Authorization is **not** a reason: the platform enforces each profile's
access on every CRUD, filter, and action call. If one of the generated endpoints
already does the job, drop the action. The exception is a controlled step the
caller's profile must not be able to do freely (bump a balance they can only
read, approve someone else's request): that is an action whose script runs
**elevated**, and it checks the caller itself.

The two cases above that touch data the caller can't see or change need an
elevated script too. Everything else runs with the caller's access; see
"Elevated or the caller's access" in the `bootstrapp-apiscript` skill.

Logic two actions share goes in a shared script both scripts call, not
copied into each script and not in an action registered only so scripts can
call it (see "Choosing the tool for reused or follow-up logic" in the `bootstrapp-apiscript` skill). A shared
script is not an endpoint: clients can't call it, and it runs with its
caller's access. A script calls another action only when that action itself
must run, for example an elevated step the caller's profile can't do freely;
the called action is still an endpoint, so grant it only to the profiles
that may run it directly.

Work that must follow every create or update of a class, whichever client
made it (keep a parent's total in step, stamp a derived field, create a
related record), is not an action either: it is a class event script, one per behavior
(`replace_class_event_script`, see "Class event scripts" in the server's
`api-script.md`). It runs after the write, so it can't reject
one; checks a client must not skip still need an action.

A provider calling the app (Stripe, GitHub, a form service) is not an action
either: it is an inbound webhook, `bootstrapp/webhooks/<name>.json`
(`replace_webhook`). The webhook saves each request as an event of
`app.<app>.webhook.<Name>WebhookEvent`, and a class event script on that
class (`events/app.<app>.webhook.<Name>WebhookEvent.created.<scriptName>.ts`)
does the work, asynchronously, with access to all of the app's data. To set
one up:

1. Add the body class: an Embedded class, usually in `app.<app>.webhook`,
   with only the fields of the provider's payload the script reads (keys it
   doesn't declare are dropped).
2. Write the manifest from the provider's docs: its signature check as
   `auth`, a `dedupeKey` if it sends a delivery id, and every secret as
   `${env:NAME}` with the value in `.env`.
3. Write the Created script. Make it safe to run twice, set `status` to
   `processed`, `failed` (with `error`) or `ignored`, and `processedAt`.
4. Apply, then give the provider the `url` `replace_webhook` returns.
   Narrow access to the event class with `replace_class_access` unless app
   users should see the events.
5. When deliveries don't show up, `get_webhook` lists the latest requests and
   why each was refused.

The same goes for submissions from the app's own users who aren't signed in,
like a lead or waitlist form on a web page or a "contact us" screen in a
Flutter app: a **public webhook** (`auth` only of `none`, `appCheck`,
`captcha` and `honeypot`), not an anonymous profile or an action. Anyone can
call it, since an app or a page can't keep a secret, so:

- Prove the caller: `appCheck` for Flutter/mobile apps with Firebase App
  Check (the app sends its token in `X-Firebase-AppCheck`; not on Windows or
  Linux), `captcha` (Turnstile, hCaptcha or reCAPTCHA) for web pages, plus a
  `honeypot` field on web forms. `none` alone works but `check` and the tools
  warn.
- Keep the default rate limit (10 a minute per IP, 300 per webhook) unless
  the user wants another `rateLimit`. For a web form, set `allowedOrigins`
  and `response.redirect` to a thank-you page; leave `allowedOrigins` out for
  apps.
- Treat the event as quarantine: the Created script copies only the fields it
  expects into the target object (never the whole body: owner, status or
  organization fields would be the caller's to set), validates and dedupes
  (e.g. by email), and sets `status` to `ignored` for junk. It doesn't email
  or text an address from the body unchecked, or strangers could use the app
  to message anyone.

The client posts to the webhook's `url` directly, outside the generated API
client and without a token.

See "Webhooks" in the server's `platform-notes.md`.

When migrating, each custom endpoint of the old backend gets this test. Plain
reads and writes map to the generated endpoints; the rest become actions.

## Anatomy

| Part | Rule |
|---|---|
| `actionName` | camelCase verb phrase for the business event: `approveExpense`, `importCustomersCsv`. Not `updateStatus`. Unique in the app. |
| `fullObjectType` | The top-level class the action is about (the target). |
| `scope` | `Instance` (one row: input has a required `id` uuid), `Bulk` (several rows: required `ids` uuid array, `minItems: 1`, `uniqueItems: true`), `Class` (no row: neither field). Pick the smallest that fits. Acting on "rows matching a filter" is still Bulk; the caller resolves the ids. |
| Input class | Embedded class in `app.<app>.actions`, named `<ActionName>Input`. Only what the event needs. |
| Output class | Embedded class in `app.<app>.actions`, named `<ActionName>Output`. Always a dedicated class, even for one value. |
| `actionSummary` | 5–10 words; the action's label in API docs. |
| `actionDescription` | 1–3 sentences: what it does, side effects, invariants it enforces, errors it throws. |
| `elevated` | `false` (the script runs with the caller's access) unless it must read or write what the caller's profile doesn't allow; then `true`, and say in `actionDescription` what the script checks instead. Sent with the script, not with `register_action`. |
| `runAsProfile` | Optional, instead of `elevated: true`: an app profile made for this step; the script runs with its access instead of the caller's (never with `elevated: true`). Prefer it whenever the step's access can be written down as a profile. |
| `timeoutSeconds` | Optional: how long the script may run, 1 to 600, or `0` for no limit (default 60). Only for a script that calls a slow service or an action whose flow takes long; a script called from another script also stops with its caller's run. Sent with the script. |

Never reuse a domain class as an input or output. Payload classes describe a
request/response, not a stored document.

## Workflow

1. Read `bootstrapp/app.json`, the target class manifest, and any classes the
   action reads or writes.
2. Draft the input and output classes as manifests in
   `bootstrapp/classes/app.<app>.actions.<Name>Input.json` /
   `...Output.json` (`type: "Embedded"`, `indexedFields: []`, full
   `title`/`description`/`examples`).
3. Write `bootstrapp/actions/<actionName>.json` (format in the `bootstrapp`
   skill's `references/manifests.md`).
4. Write the script with the `bootstrapp-apiscript` skill. You can write it
   before the action is registered; you can only *check it against the real
   function surface* once the classes it touches are registered and
   `generated/platform.d.ts` has been regenerated.
5. Run `bootstrapp-state.mjs check`; fix errors.
6. Apply when asked: input/output classes and the target via
   `add_object_class`, then `register_action`, then `replace_action_script`,
   recording each success.

## After registering

- Registered actions appear in the OpenAPI spec (regenerate the client) and as
  callable functions in other scripts (regenerate `platform.d.ts`).
- Run the action once with `invoke_action` (real writes) to confirm the
  script runs, then through the generated client (see the server's
  `platform-notes.md`, "Actions", about script wiring).
- Scope, payload classes, summary and description can change later with
  `replace_action`. The name can't: a renamed action is a new action, and the
  old one stays.
