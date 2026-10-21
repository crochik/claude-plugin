# `bootstrapp/` manifest formats

Every manifest is plain JSON whose fields are the arguments of one MCP tool
call. Extra keys starting with `$` (for example `$notes`) are for humans and
are stripped before a call. JSON Schema keywords (`$ref`, `$defs`, `$id`,
`$schema`, `$anchor`) are kept, so don't use those names for notes.

## `app.json`

```json
{
  "name": "expense_tracker",
  "title": "Expense Tracker",
  "description": "Lets small teams submit expenses with receipts and lets managers approve them. Scope: submission, approval, monthly totals; no payroll.",
  "client": {
    "language": "typescript",
    "outputDir": "src/generated/bootstrapp",
    "wrapper": "src/lib/bootstrapp.ts"
  }
}
```

- `name` → `init_app.appName`. snake_case: lowercase letters, digits,
  underscores. It is also the OIDC `client_id` and the namespace suffix
  (`app.<name>`). Never rename it after `init_app`.
- `title` → `init_app.appTitle` (shown on the login consent screen).
- `description` → `init_app.appDescription`. A real paragraph.
- `client` is optional and only used by the `bootstrapp-client` skill.

## `classes/<fullObjectType>.json`

File name is the full class name, e.g.
`classes/app.expense_tracker.Expense.json`.

```json
{
  "fullObjectType": "app.expense_tracker.Expense",
  "type": "TopLevel",
  "indexedFields": ["_id", "submittedById", "categoryId", "status", "submittedOn"],
  "foreignKeys": [
    { "localFieldName": "categoryId", "referenceObjectType": "app.expense_tracker.Category", "referenceFieldName": "_id" }
  ],
  "schema": {
    "title": "Expense",
    "description": "A single expense a team member submits for reimbursement.",
    "type": "object",
    "properties": {
      "_id": {
        "type": "string", "format": "uuid",
        "title": "Expense ID",
        "description": "Server-assigned UUID identifying this expense.",
        "examples": ["6f1d3b2a-4e7f-4c2a-9d8b-1c2e3f4a5b6c"]
      },
      "submittedById": {
        "type": "string", "format": "uuid",
        "title": "Submitted by",
        "description": "Platform user who submitted the expense.",
        "examples": ["b3a1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d"]
      },
      "categoryId": {
        "type": "string", "format": "uuid",
        "title": "Category",
        "description": "Expense category this expense is filed under.",
        "examples": ["0c9e2f1a-7b3d-4e5f-8a9b-1c2d3e4f5a6b"]
      },
      "status": {
        "type": "string", "enum": ["draft", "submitted", "approved", "rejected"],
        "default": "draft",
        "title": "Status",
        "description": "Where the expense is in the approval flow.",
        "examples": ["submitted"]
      },
      "amountCents": {
        "type": "integer", "minimum": 0,
        "title": "Amount (cents)",
        "description": "Amount in the smallest currency unit, to avoid float rounding.",
        "examples": [4599]
      },
      "submittedOn": {
        "type": "string", "format": "date-time",
        "title": "Submitted on",
        "description": "When the expense was submitted.",
        "examples": ["2026-10-01T14:03:00Z"]
      }
    },
    "required": ["_id", "submittedById", "categoryId", "status", "amountCents"],
    "examples": [{
      "_id": "6f1d3b2a-4e7f-4c2a-9d8b-1c2e3f4a5b6c",
      "submittedById": "b3a1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      "categoryId": "0c9e2f1a-7b3d-4e5f-8a9b-1c2d3e4f5a6b",
      "status": "submitted",
      "amountCents": 4599,
      "submittedOn": "2026-10-01T14:03:00Z"
    }]
  },
  "$notes": "Approval is an action because it writes the expense and the monthly total atomically."
}
```

An embedded class used by others is its own manifest
(`classes/app.expense_tracker.Receipt.json`, `"type": "Embedded"`,
`"indexedFields": []`, no `_id`). A class embeds it by `$ref`:

```json
"receipts": {
  "type": "array",
  "title": "Receipts",
  "description": "Scanned receipts attached to this expense.",
  "items": { "$ref": "#/components/schemas/app.expense_tracker.Receipt" }
},
"mainReceipt": {
  "$ref": "#/components/schemas/app.expense_tracker.Receipt",
  "title": "Main receipt",
  "description": "The receipt shown in lists."
}
```

A string-keyed dictionary uses `"type": "object", "additionalProperties":
{ "$ref": ... }`. `plan` registers referenced classes first.

A discriminated base has a required string property (`kind`). Each variant
names that property and gives its value, and leaves the property out of
its own schema (properties abbreviated):

```json
{
  "fullObjectType": "app.shop.Payment",
  "type": "TopLevel",
  "indexedFields": ["_id", "kind", "orderId"],
  "schema": { "type": "object", "required": ["_id", "kind", "orderId", "amountCents"],
    "properties": { "_id": {}, "kind": { "type": "string" }, "orderId": {}, "amountCents": {} } }
}
```

```json
{
  "fullObjectType": "app.shop.CardPayment",
  "type": "TopLevel",
  "baseObjectType": "app.shop.Payment",
  "discriminatorField": "kind",
  "discriminatorValue": "card",
  "indexedFields": ["_id"],
  "schema": { "type": "object", "required": ["last4"], "properties": { "last4": {} } }
}
```

Maps to `add_object_class` as: `appName` (from `app.json`),
`fullObjectType`, `type` (`TopLevel` | `Embedded`), `baseObjectType`
(optional), `discriminatorField` / `discriminatorValue` (optional, on
variants),
`indexedFields` (required; `[]` for embedded), `foreignKeys` (optional;
every property holding ids, with `dictionaryPart` for a dictionary, see
`bootstrapp-object-types`),
`schema`, `isFullTextSearchable` (optional, default `true`).

## `actions/<actionName>.json`

```json
{
  "fullObjectType": "app.expense_tracker.Expense",
  "actionName": "approveExpense",
  "actionSummary": "Approve a submitted expense",
  "actionDescription": "Marks a submitted expense approved and adds it to the submitter's monthly total in one step. Fails if the expense is not in the submitted state.",
  "scope": "Instance",
  "actionInputObjectType": "app.expense_tracker.actions.ApproveExpenseInput",
  "actionOutputObjectType": "app.expense_tracker.actions.ApproveExpenseOutput",
  "elevated": true
}
```

Maps 1:1 to `register_action`, except `elevated`. `scope` is `Instance` |
`Bulk` | `Class`. The script is `scripts/<actionName>.ts` by convention; no
field needed. `elevated` (`true` | `false`) is sent with the script to
`replace_action_script`: `false` runs it with the caller's access, `true`
ignores the caller's profile (see the `bootstrapp-apiscript` skill). `check`
warns when it is missing; changing it re-pushes the script, not the action.

## `scripts/<actionName>.ts`

The ApiScript body sent verbatim as `replace_action_script.actionScript`, with
`elevated` from the action manifest. See
the `bootstrapp-apiscript` skill.

## `shared/<scriptName>.json` and `shared/<scriptName>.ts`

A shared script: reusable code the app's scripts call as
`scripts.<scriptName>(args)` from `app.<app>.scripts` (see the
`bootstrapp-apiscript` skill).

```json
{
  "scriptName": "orderTotal",
  "description": "Sums an order's lines. Returns the total in cents and the line count.",
  "inputObjectType": "app.shop.actions.OrderTotalInput",
  "outputObjectType": "app.shop.actions.OrderTotalOutput",
  "profiles": ["Member"]
}
```

Maps to `replace_script` with `appName` added and `script` read verbatim
from `shared/<scriptName>.ts`. `scriptName` is the file name (an
identifier, camelCase). `inputObjectType` and `outputObjectType` are
optional (without them the argument and result are `any`); `profiles` is
optional (without it every script may call it; the default profile always
may). There is no `elevated`: a shared script runs with its caller's
access. Since `replace_script` replaces the whole script, a key removed
here is cleared on the server.

## `events/<fullObjectType>.<created|updated>.<scriptName>.ts`

A class event script: one behavior run after an object of the class is
created (`events/app.shop.OrderLine.created.notifyWarehouse.ts`) or
updated (`events/app.shop.OrderLine.updated.updateOrderTotal.ts`). A
class can have several per event. There is no manifest: the file name
gives `replace_class_event_script`'s `fullObjectType`, `classEvent`
(`Created` | `Updated`) and `scriptName` (camelCase identifier), and the
file is its `script`, verbatim. Only top-level classes directly in `app.<app>`,
and webhook event classes (`app.<app>.webhook.<Name>WebhookEvent`, from
`webhooks/`), can have one.
Deleting the file makes `plan` list `remove_class_event_script`. See
"Class event scripts" in the server's `api-script.md`.

## `webhooks/<name>.json`

An inbound webhook: the `replace_webhook` arguments without `appName`.

```json
{
  "name": "stripe",
  "description": "Stripe payment events",
  "bodyClass": "app.shop.webhook.StripeEventBody",
  "auth": [{ "type": "stripe", "secret": "${env:STRIPE_WEBHOOK_SECRET}" }],
  "dedupeKey": "body:id"
}
```

`name` is camelCase and names the event class,
`app.<app>.webhook.<Name>WebhookEvent`, which `replace_webhook` makes (with
the base `app.<app>.webhook.WebhookEvent`); don't write class manifests for
them. `bodyClass` is an Embedded class with a manifest of its own, applied
first. Optional: `methods` (default `["POST"]`), `format` (`json`, `form`,
`xml`, `raw`), `registration`, `response`, `dedupeKey`, `keepRawBody`,
`enabled`. Auth step types and fields are in the server's `tools.md`.

Secrets (`secret`, `token`, `password`) are written `${env:NAME}`, and
the values live in `.env` (list the names in `.env.example`). `plan` keeps
the placeholders; replace them when calling and never print the values.
Changing only a value in `.env` doesn't change the manifest, so apply it by
calling `replace_webhook` yourself. `"generate"` (bearer, apikey, basic)
makes the server create a secret and return it once: save it to `.env`
and switch the manifest to `${env:NAME}`. The URL isn't in the manifest:
`replace_webhook` and `get_webhooks` return it; `rotateUrl` is a one-off
call, not a manifest key. Deleting the file makes `plan` list
`remove_webhook` (the event class and its events stay).

## `network/<name>.json`

A network policy: the HTTP calls (`system.http.fetch`) a run started by
one of the scripts it lists may make. The policy binds the whole run:
the actions and shared scripts it calls make their calls under it, and
their own policies don't apply. A run whose starting script no policy
lists, or whose policy isn't active, can't make any. Policies are
account wide and approved outside the MCP server: the server saves them
inactive and someone activates them there.

```json
{
  "name": "stripe",
  "description": "Charges and refunds through the Stripe API",
  "rules": [
    { "host": "api.stripe.com", "methods": ["GET", "POST"] }
  ],
  "scripts": ["app.shop.Order.chargeOrder", "app.shop.Order#created#notify"]
}
```

`name`, `description` and `rules` are `replace_network_policy`'s
arguments (`appName` added, and `id` from the ledger once it is
applied). The server keeps the policy by id: `replace_network_policy`
returns it, `set_script_network_policy` takes it, and the ledger
records it. A change to an active policy comes back as a new, inactive
policy with a new id. A rule's `host` is exact or `*.example.com`
(its subdomains), with `:port` for a non-default port; `schemes`
defaults to `["https"]`, `methods` to any. `scripts` are the server's
names of scripts that start a run, each set with
`set_script_network_policy`: `<fullObjectType>.<actionName>` for an
action, `<fullObjectType>#created#<name>` (or `#updated#`) for a class
event script. Shared scripts can't be listed: they run under their
caller's policy. A script is in at most one policy. Dropping a script from the
list, or deleting the file, makes `plan` take that script's network
access away (the policy itself stays on the server: there is no delete
tool). See "Calling HTTP APIs" in the server's `api-script.md`.

## `profiles/<Profile>.json`

```json
{
  "profileName": "Manager",
  "description": "Approves expenses for their team and sees everyone's.",
  "inheritsFrom": ["Member"]
}
```

Maps to `add_profile` (first time) and `replace_profile` (after a change):
`appName`, `profileName`, `description`, `inheritsFrom` (optional, profiles
listed first are applied first). Never declare `Admin`, the default profile
`init_app` created. `copyAccessFrom` is not used: write the access files.

## `access/<Profile>/<fullObjectType>.json`

```json
{
  "profileName": "Member",
  "fullObjectType": "app.expense_tracker.Expense",
  "permissions": ["Read", "Create", "Update"],
  "fieldPermissions": {
    "status": ["Read"],
    "approverNotes": []
  },
  "constraints": [
    { "fieldName": "submittedById", "operator": "Eq", "value": "{{context \"UserId\"}}" }
  ],
  "$notes": "Members see and edit only their own expenses; managers set status."
}
```

Maps 1:1 to `replace_class_access` (no `appName`; the class names the app).
Optional keys: `fieldPermissions`, `defaultFieldPermissions`,
`relationPermissions`, `constraints`, `updateConstraints`,
`deleteConstraints`. `permissions: []` removes the profile's access. The
folder name must equal `profileName`. Leaving a key out removes what it had
on the server: the file is the whole access.

A row constraint can also follow a relation: `{ "fieldName": "Category",
"operator": "Exists" }` (a relation name from a string foreign key: the
referenced class without its namespace, or the field without `Id` when
that repeats or is taken, since relation names never match a field; no
value) shows a record only when its related record
is one the profile can see.

`updateConstraints` and `deleteConstraints` have the same shape as
`constraints` (top-level fields only) and narrow which visible records the
profile may update or delete:

```json
{
  "profileName": "Member",
  "fullObjectType": "app.expense_tracker.Expense",
  "permissions": ["Full"],
  "constraints": [
    { "fieldName": "submittedById", "operator": "Eq", "value": "{{context \"UserId\"}}" }
  ],
  "updateConstraints": [
    { "fieldName": "status", "operator": "Eq", "value": "Draft" }
  ],
  "$notes": "Members see their own expenses and can change or delete them only while they're drafts."
}
```

A class this app doesn't own (another app's, or one created outside the MCP
server) is granted to this app's profile with `profileApp` set to this
app's name; `Admin` is allowed there, since it has no access to such a
class until granted:

```json
{
  "profileName": "Admin",
  "fullObjectType": "app.catalog.Product",
  "profileApp": "store",
  "permissions": ["ReadOnly"]
}
```

## `access/actions/<actionName>.json`

```json
{
  "fullObjectType": "app.expense_tracker.Expense",
  "actionName": "approveExpense",
  "profiles": ["Manager"]
}
```

Maps 1:1 to `replace_action_access`. `Admin` always runs every action;
`profiles: []` leaves only `Admin`. Without this file a registered action's
profile list is whatever the server has (see `get_actions`). For an action
of a class this app doesn't own, add `"profileApp": "<this app>"` and list
this app's profiles that run it, `Admin` included when it should.

## `auth.json`

```json
{
  "providers": ["Microsoft", "Google"],
  "signup": "invite_only",
  "signupProfile": "Member",
  "providerTenants": { "Microsoft": ["8f0c…-tenant-id"] },
  "calculatedClaims": { "department": "{{Objects.User.department}}" }
}
```

Maps to `replace_app_auth` with `appName` added. `signup` is `open` or
`invite_only`; `providerTenants` and `calculatedClaims` are optional
(`calculatedClaims` omitted keeps the current ones, `{}` removes them).

## `applied.json` (written by the state helper)

```json
{
  "app": { "name": "expense_tracker", "appliedAt": "2026-10-07T14:00:00Z" },
  "profiles": { "Member": { "hash": "…", "appliedAt": "…" } },
  "classes": { "app.expense_tracker.Expense": { "hash": "…", "appliedAt": "…" } },
  "access": { "Member/app.expense_tracker.Expense": { "hash": "…", "classHash": "…", "appliedAt": "…" } },
  "actions": { "approveExpense": { "hash": "…", "appliedAt": "…" } },
  "actionAccess": { "approveExpense": { "hash": "…", "appliedAt": "…" } },
  "sharedScripts": { "orderTotal": { "hash": "…", "appliedAt": "…" } },
  "scripts": { "approveExpense": { "hash": "…", "appliedAt": "…" } },
  "eventScripts": { "app.shop.OrderLine.updated.updateOrderTotal": { "hash": "…", "appliedAt": "…" } },
  "networkPolicies": { "stripe": { "id": "…", "hash": "…", "scripts": ["app.shop.Order.chargeOrder"], "appliedAt": "…" } },
  "webhooks": { "stripe": { "hash": "…", "appliedAt": "…" } },
  "auth": { "hash": "…", "appliedAt": "…" }
}
```

`classHash` is the class version the access was applied against; when the
class changes, the access shows as `recheck` and is applied again.

Commit it with the rest of the folder: it is how the next session (or a
teammate) knows what the backend already has.
