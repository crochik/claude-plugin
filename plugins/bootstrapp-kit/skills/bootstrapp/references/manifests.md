# `bootstrapp/` manifest formats

Every manifest is plain JSON whose fields are the arguments of one MCP tool
call. Extra keys starting with `$` (for example `$notes`) are for humans and
are stripped before a call.

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

Maps to `add_object_class` as: `appName` (from `app.json`),
`fullObjectType`, `type` (`TopLevel` | `Embedded`), `baseObjectType`
(optional), `indexedFields` (required; `[]` for embedded), `foreignKeys`
(optional), `schema`.

## `actions/<actionName>.json`

```json
{
  "fullObjectType": "app.expense_tracker.Expense",
  "actionName": "approveExpense",
  "actionSummary": "Approve a submitted expense",
  "actionDescription": "Marks a submitted expense approved and adds it to the submitter's monthly total in one step. Fails if the expense is not in the submitted state.",
  "scope": "Instance",
  "actionInputObjectType": "app.expense_tracker.actions.ApproveExpenseInput",
  "actionOutputObjectType": "app.expense_tracker.actions.ApproveExpenseOutput"
}
```

Maps 1:1 to `register_action`. `scope` is `Instance` | `Bulk` | `Class`.
The script is `scripts/<actionName>.ts` by convention; no field needed.

## `scripts/<actionName>.ts`

The ApiScript body sent verbatim as `replace_action_script.actionScript`. See
the `bootstrapp-apiscript` skill.

## `applied.json` (written by the state helper)

```json
{
  "app": { "name": "expense_tracker", "appliedAt": "2026-10-07T14:00:00Z" },
  "classes": { "app.expense_tracker.Expense": { "hash": "…", "appliedAt": "…" } },
  "actions": { "approveExpense": { "hash": "…", "appliedAt": "…" } },
  "scripts": { "approveExpense": { "hash": "…", "appliedAt": "…" } }
}
```

Commit it with the rest of the folder: it is how the next session (or a
teammate) knows what the backend already has.
