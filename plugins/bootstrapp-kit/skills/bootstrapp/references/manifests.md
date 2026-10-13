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
`relationPermissions`, `constraints`. `permissions: []` removes the
profile's access. The folder name must equal `profileName`.

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
profile list is whatever the server has (see `get_actions`).

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
  "scripts": { "approveExpense": { "hash": "…", "appliedAt": "…" } },
  "auth": { "hash": "…", "appliedAt": "…" }
}
```

`classHash` is the class version the access was applied against; when the
class changes, the access shows as `recheck` and is applied again.

Commit it with the rest of the folder: it is how the next session (or a
teammate) knows what the backend already has.
