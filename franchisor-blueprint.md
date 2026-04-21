# Backend Blueprint — Franchisor Management System

## Namespaces

| Namespace | Purpose |
|---|---|
| `domain` | Persisted business model: franchisees, outlets, territories, contracts, financials, operations. |
| `actions` | Input/output classes for server-side actions. Embedded only; never persisted. |

A single domain namespace is sufficient — the model is one bounded context (a franchisor's operational backbone), and splitting it further would fragment the many cross-aggregate actions.

---

## Classes

### Users & parties

#### `domain.User`
- **Level:** top-level
- **Extends:** none (parent of the user hierarchy, with discriminator)
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["_id", "userType", "email", "displayName", "status"],
    "properties": {
      "_id": { "type": "string" },
      "userType": {
        "type": "string",
        "enum": ["franchisorStaff", "franchiseeOwner", "franchiseeStaff"]
      },
      "email": { "type": "string", "format": "email" },
      "displayName": { "type": "string" },
      "phone": { "type": "string" },
      "status": { "type": "string", "enum": ["active", "invited", "suspended", "deactivated"] },
      "createdAt": { "type": "string", "format": "date-time" },
      "lastLoginAt": { "type": "string", "format": "date-time" }
    }
  }
  ```
- **Notes:** Parent class. `userType` is the inheritance discriminator. AuthN/Z is out of scope; this class only models ownership metadata.

#### `domain.FranchisorStaffUser`
- **Level:** top-level
- **Extends:** `domain.User` (discriminator: `userType` = `"franchisorStaff"`)
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["staffRole"],
    "properties": {
      "staffRole": {
        "type": "string",
        "enum": ["admin", "opsManager", "financeManager", "marketingManager", "supportAgent", "readOnly"]
      },
      "department": { "type": "string" }
    }
  }
  ```
- **Notes:** Franchisor-side employee.

#### `domain.FranchiseeOwnerUser`
- **Level:** top-level
- **Extends:** `domain.User` (discriminator: `userType` = `"franchiseeOwner"`)
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["franchiseeId"],
    "properties": {
      "franchiseeId": { "type": "string" },
      "ownershipPercentage": { "type": "number", "minimum": 0, "maximum": 100 }
    }
  }
  ```
- **Notes:** Principal owner / signatory of a franchisee entity.

#### `domain.FranchiseeStaffUser`
- **Level:** top-level
- **Extends:** `domain.User` (discriminator: `userType` = `"franchiseeStaff"`)
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["franchiseeId", "staffRole"],
    "properties": {
      "franchiseeId": { "type": "string" },
      "outletIds": { "type": "array", "items": { "type": "string" } },
      "staffRole": {
        "type": "string",
        "enum": ["manager", "bookkeeper", "trainer", "viewer"]
      }
    }
  }
  ```
- **Notes:** Sub-role within a franchisee. `outletIds` optionally scopes access to particular outlets (metadata only — enforcement is an authZ concern).

#### `domain.Franchisee`
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["_id", "legalName", "tier", "status", "primaryContact", "createdAt"],
    "properties": {
      "_id": { "type": "string" },
      "legalName": { "type": "string" },
      "tradeName": { "type": "string" },
      "tier": { "type": "string", "enum": ["master", "standard"] },
      "parentFranchiseeId": { "type": "string", "description": "When tier=standard and this franchisee is sub-licensed under a master. Null otherwise." },
      "status": {
        "type": "string",
        "enum": ["prospect", "approved", "active", "onHold", "terminated"]
      },
      "taxId": { "type": "string" },
      "primaryContact": {
        "type": "object",
        "required": ["name", "email"],
        "properties": {
          "name": { "type": "string" },
          "email": { "type": "string", "format": "email" },
          "phone": { "type": "string" }
        }
      },
      "mailingAddress": { "$ref": "#/definitions/Address" },
      "onboardedAt": { "type": "string", "format": "date-time" },
      "createdAt": { "type": "string", "format": "date-time" }
    }
  }
  ```
- **Notes:** The legal counterparty. `tier=master` enables sub-licensing within a master territory. `parentFranchiseeId` is a self-reference used only for standard franchisees under a master.

#### `domain.Address`
- **Level:** embedded
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "line1": { "type": "string" },
      "line2": { "type": "string" },
      "city": { "type": "string" },
      "region": { "type": "string" },
      "postalCode": { "type": "string" },
      "country": { "type": "string" }
    }
  }
  ```
- **Notes:** Reusable value object; no identity of its own.

### Territory & outlets

#### `domain.Territory`
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["_id", "name", "status", "exclusivityType"],
    "properties": {
      "_id": { "type": "string" },
      "name": { "type": "string" },
      "code": { "type": "string" },
      "description": { "type": "string" },
      "geography": {
        "type": "object",
        "properties": {
          "country": { "type": "string" },
          "regions": { "type": "array", "items": { "type": "string" } },
          "postalCodes": { "type": "array", "items": { "type": "string" } }
        }
      },
      "exclusivityType": { "type": "string", "enum": ["exclusive", "nonExclusive", "protected"] },
      "assignedFranchiseeId": { "type": "string" },
      "assignedAsMaster": { "type": "boolean", "default": false },
      "status": { "type": "string", "enum": ["available", "reserved", "assigned", "retired"] },
      "assignedAt": { "type": "string", "format": "date-time" }
    }
  }
  ```
- **Notes:** First-class. Exclusivity + assignment is enforced by an action, not schema validation. `assignedAsMaster=true` implies the territory is granted to a master who may sub-license within it.

#### `domain.Outlet`
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["_id", "franchiseeId", "outletCode", "status", "address"],
    "properties": {
      "_id": { "type": "string" },
      "franchiseeId": { "type": "string" },
      "territoryId": { "type": "string" },
      "outletCode": { "type": "string" },
      "displayName": { "type": "string" },
      "status": {
        "type": "string",
        "enum": ["planned", "underConstruction", "open", "temporarilyClosed", "closed"]
      },
      "address": { "$ref": "#/definitions/Address" },
      "openedAt": { "type": "string", "format": "date-time" },
      "closedAt": { "type": "string", "format": "date-time" },
      "manager": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "email": { "type": "string", "format": "email" },
          "phone": { "type": "string" }
        }
      },
      "riskFlags": {
        "type": "array",
        "items": { "type": "string", "enum": ["lateReporting", "complianceOverdue", "lowSales", "openTickets"] }
      }
    }
  }
  ```
- **Notes:** A physical/operational unit. Multiple outlets per franchisee. `riskFlags` is computed and refreshed by a scheduled action.

### Onboarding pipeline

#### `domain.Lead`
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["_id", "contactName", "email", "stage", "createdAt"],
    "properties": {
      "_id": { "type": "string" },
      "contactName": { "type": "string" },
      "email": { "type": "string", "format": "email" },
      "phone": { "type": "string" },
      "source": { "type": "string" },
      "interestedTerritoryIds": { "type": "array", "items": { "type": "string" } },
      "stage": {
        "type": "string",
        "enum": ["inquiry", "qualified", "applicationSent", "applicationReceived", "approved", "rejected", "converted"]
      },
      "rejectionReason": { "type": "string" },
      "ownerUserId": { "type": "string", "description": "Franchisor staff assigned to this lead" },
      "convertedFranchiseeId": { "type": "string" },
      "notes": { "type": "array", "items": { "$ref": "#/definitions/PipelineNote" } },
      "createdAt": { "type": "string", "format": "date-time" },
      "updatedAt": { "type": "string", "format": "date-time" }
    }
  }
  ```
- **Notes:** Top-of-funnel sales record. On approval an action converts the Lead to a `Franchisee` (+ optional `Territory` assignment).

#### `domain.PipelineNote`
- **Level:** embedded
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["authorUserId", "body", "createdAt"],
    "properties": {
      "authorUserId": { "type": "string" },
      "body": { "type": "string" },
      "createdAt": { "type": "string", "format": "date-time" }
    }
  }
  ```
- **Notes:** Log entry on leads and onboarding tasks.

#### `domain.OnboardingChecklist`
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["_id", "franchiseeId", "status", "tasks"],
    "properties": {
      "_id": { "type": "string" },
      "franchiseeId": { "type": "string" },
      "outletId": { "type": "string", "description": "Optional: checklist may be outlet-specific." },
      "status": { "type": "string", "enum": ["notStarted", "inProgress", "completed", "blocked"] },
      "tasks": { "type": "array", "items": { "$ref": "#/definitions/OnboardingTask" } },
      "startedAt": { "type": "string", "format": "date-time" },
      "completedAt": { "type": "string", "format": "date-time" }
    }
  }
  ```
- **Notes:** Owned by a franchisee (and sometimes a specific outlet). Querying completion rate across franchisees keeps it top-level.

#### `domain.OnboardingTask`
- **Level:** embedded
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["key", "label", "status"],
    "properties": {
      "key": { "type": "string" },
      "label": { "type": "string" },
      "category": { "type": "string", "enum": ["legal", "siteSelection", "buildOut", "training", "tech", "marketing", "financial"] },
      "status": { "type": "string", "enum": ["pending", "inProgress", "done", "waived", "blocked"] },
      "dueDate": { "type": "string", "format": "date" },
      "completedAt": { "type": "string", "format": "date-time" },
      "assignedUserId": { "type": "string" },
      "notes": { "type": "array", "items": { "$ref": "#/definitions/PipelineNote" } }
    }
  }
  ```
- **Notes:** Tasks live only inside a checklist and are never queried standalone — embedded.

### Documents library

#### `domain.Document`
- **Level:** top-level
- **Extends:** none (parent of document hierarchy, with discriminator)
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["_id", "docType", "title", "status", "currentVersion", "ownerScope"],
    "properties": {
      "_id": { "type": "string" },
      "docType": {
        "type": "string",
        "enum": ["contract", "fdd", "complianceCertificate", "operationalDoc"]
      },
      "title": { "type": "string" },
      "description": { "type": "string" },
      "status": { "type": "string", "enum": ["draft", "active", "expired", "superseded", "revoked"] },
      "ownerScope": {
        "type": "object",
        "required": ["scopeType"],
        "properties": {
          "scopeType": { "type": "string", "enum": ["franchisor", "franchisee", "outlet", "territory"] },
          "franchiseeId": { "type": "string" },
          "outletId": { "type": "string" },
          "territoryId": { "type": "string" }
        }
      },
      "currentVersion": { "$ref": "#/definitions/DocumentVersion" },
      "versionHistory": { "type": "array", "items": { "$ref": "#/definitions/DocumentVersion" } },
      "effectiveDate": { "type": "string", "format": "date" },
      "expiryDate": { "type": "string", "format": "date" },
      "tags": { "type": "array", "items": { "type": "string" } },
      "createdAt": { "type": "string", "format": "date-time" },
      "updatedAt": { "type": "string", "format": "date-time" }
    }
  }
  ```
- **Notes:** Single library for all document types. `docType` is the discriminator; subclasses add type-specific fields. Querying expiring documents across the whole system is a top-level need.

#### `domain.ContractDocument`
- **Level:** top-level
- **Extends:** `domain.Document` (discriminator: `docType` = `"contract"`)
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "contractKind": {
        "type": "string",
        "enum": ["franchiseAgreement", "masterFranchiseAgreement", "renewal", "transfer", "amendment", "termination"]
      },
      "counterpartyFranchiseeId": { "type": "string" },
      "termStart": { "type": "string", "format": "date" },
      "termEnd": { "type": "string", "format": "date" },
      "renewalOptionYears": { "type": "integer", "minimum": 0 },
      "signedAt": { "type": "string", "format": "date-time" },
      "signatories": { "type": "array", "items": { "$ref": "#/definitions/DocumentSignatory" } }
    }
  }
  ```
- **Notes:** All contract flavors in one class, distinguished by `contractKind`.

#### `domain.FDDDocument`
- **Level:** top-level
- **Extends:** `domain.Document` (discriminator: `docType` = `"fdd"`)
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "issueYear": { "type": "integer" },
      "jurisdiction": { "type": "string" },
      "registrationNumber": { "type": "string" }
    }
  }
  ```

#### `domain.ComplianceCertificateDocument`
- **Level:** top-level
- **Extends:** `domain.Document` (discriminator: `docType` = `"complianceCertificate"`)
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["certificateType"],
    "properties": {
      "certificateType": {
        "type": "string",
        "enum": ["insurance", "healthAndSafety", "foodSafety", "businessLicense", "tax", "other"]
      },
      "issuer": { "type": "string" },
      "certificateNumber": { "type": "string" },
      "renewalReminderDays": { "type": "integer", "default": 30 }
    }
  }
  ```
- **Notes:** Expiry + reminder window drive the compliance dashboard.

#### `domain.OperationalDocument`
- **Level:** top-level
- **Extends:** `domain.Document` (discriminator: `docType` = `"operationalDoc"`)
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "category": { "type": "string", "enum": ["sop", "brandGuide", "menu", "manual", "policy", "other"] },
      "audience": { "type": "string", "enum": ["allFranchisees", "specificFranchisee", "specificOutlet", "internal"] }
    }
  }
  ```

#### `domain.DocumentVersion`
- **Level:** embedded
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["versionNumber", "fileUrl", "uploadedAt", "uploadedByUserId"],
    "properties": {
      "versionNumber": { "type": "integer", "minimum": 1 },
      "label": { "type": "string" },
      "fileUrl": { "type": "string" },
      "fileName": { "type": "string" },
      "fileSizeBytes": { "type": "integer" },
      "mimeType": { "type": "string" },
      "checksum": { "type": "string" },
      "uploadedAt": { "type": "string", "format": "date-time" },
      "uploadedByUserId": { "type": "string" },
      "changeNote": { "type": "string" }
    }
  }
  ```

#### `domain.DocumentSignatory`
- **Level:** embedded
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["name", "role"],
    "properties": {
      "name": { "type": "string" },
      "role": { "type": "string", "enum": ["franchisor", "franchisee", "witness", "guarantor"] },
      "email": { "type": "string", "format": "email" },
      "signedAt": { "type": "string", "format": "date-time" },
      "userId": { "type": "string" }
    }
  }
  ```

### Financials

#### `domain.SalesReport`
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["_id", "outletId", "franchiseeId", "periodType", "periodStart", "periodEnd", "grossSales", "status", "submittedAt"],
    "properties": {
      "_id": { "type": "string" },
      "outletId": { "type": "string" },
      "franchiseeId": { "type": "string" },
      "periodType": { "type": "string", "enum": ["weekly", "monthly"], "default": "weekly" },
      "periodStart": { "type": "string", "format": "date" },
      "periodEnd": { "type": "string", "format": "date" },
      "grossSales": { "type": "number", "minimum": 0 },
      "netSales": { "type": "number", "minimum": 0 },
      "discounts": { "type": "number", "minimum": 0 },
      "refunds": { "type": "number", "minimum": 0 },
      "transactionCount": { "type": "integer", "minimum": 0 },
      "currency": { "type": "string", "default": "USD" },
      "breakdown": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "category": { "type": "string" },
            "amount": { "type": "number" }
          }
        }
      },
      "status": { "type": "string", "enum": ["draft", "submitted", "accepted", "disputed", "amended"] },
      "submittedAt": { "type": "string", "format": "date-time" },
      "submittedByUserId": { "type": "string" },
      "acceptedAt": { "type": "string", "format": "date-time" },
      "amendsReportId": { "type": "string" },
      "notes": { "type": "string" }
    }
  }
  ```
- **Notes:** Self-reported by franchisees. Primary cadence is weekly; `periodType=monthly` supported for rollups. Amendments are recorded as new reports linked via `amendsReportId` (no destructive edits).

#### `domain.FeeRecord`
- **Level:** top-level
- **Extends:** none (parent of fee hierarchy, with discriminator)
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["_id", "feeType", "franchiseeId", "amount", "currency", "status", "dueDate"],
    "properties": {
      "_id": { "type": "string" },
      "feeType": {
        "type": "string",
        "enum": ["initial", "royalty", "marketingFund", "tech", "supply", "training", "renewal", "transfer"]
      },
      "franchiseeId": { "type": "string" },
      "outletId": { "type": "string" },
      "amount": { "type": "number", "minimum": 0 },
      "currency": { "type": "string", "default": "USD" },
      "status": { "type": "string", "enum": ["pending", "recorded", "waived", "reversed"] },
      "dueDate": { "type": "string", "format": "date" },
      "recordedAt": { "type": "string", "format": "date-time" },
      "recordedByUserId": { "type": "string" },
      "referenceNumber": { "type": "string" },
      "memo": { "type": "string" }
    }
  }
  ```
- **Notes:** The system **records** fees only — it does not calculate, invoice, or collect. Subclasses narrow the fee context for richer queries.

#### `domain.RoyaltyFeeRecord`
- **Level:** top-level
- **Extends:** `domain.FeeRecord` (discriminator: `feeType` = `"royalty"`)
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "salesReportId": { "type": "string" },
      "ratePercent": { "type": "number", "minimum": 0 },
      "reportedGrossSales": { "type": "number", "minimum": 0 }
    }
  }
  ```

#### `domain.MarketingFundFeeRecord`
- **Level:** top-level
- **Extends:** `domain.FeeRecord` (discriminator: `feeType` = `"marketingFund"`)
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "salesReportId": { "type": "string" },
      "ratePercent": { "type": "number", "minimum": 0 }
    }
  }
  ```

#### `domain.InitialFeeRecord`
- **Level:** top-level
- **Extends:** `domain.FeeRecord` (discriminator: `feeType` = `"initial"`)
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "contractId": { "type": "string" }
    }
  }
  ```

#### `domain.RenewalFeeRecord`
- **Level:** top-level
- **Extends:** `domain.FeeRecord` (discriminator: `feeType` = `"renewal"`)
- **JSON Schema:**
  ```json
  { "type": "object", "properties": { "contractId": { "type": "string" } } }
  ```

#### `domain.TransferFeeRecord`
- **Level:** top-level
- **Extends:** `domain.FeeRecord` (discriminator: `feeType` = `"transfer"`)
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "previousFranchiseeId": { "type": "string" },
      "contractId": { "type": "string" }
    }
  }
  ```

#### `domain.FlatFeeRecord`
- **Level:** top-level
- **Extends:** `domain.FeeRecord` (discriminator: `feeType` in `{tech, supply, training}`)
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "lineItemDescription": { "type": "string" }
    }
  }
  ```
- **Notes:** One subclass for simple flat-fee types (tech/supply/training). The discriminator value is whichever of those three is set; semantic shape is identical.

### Marketing

#### `domain.MarketingFundLedgerEntry`
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["_id", "entryType", "amount", "currency", "occurredOn"],
    "properties": {
      "_id": { "type": "string" },
      "entryType": { "type": "string", "enum": ["contribution", "expenditure", "adjustment"] },
      "amount": { "type": "number" },
      "currency": { "type": "string", "default": "USD" },
      "occurredOn": { "type": "string", "format": "date" },
      "description": { "type": "string" },
      "franchiseeId": { "type": "string", "description": "For contributions from a specific franchisee." },
      "feeRecordId": { "type": "string", "description": "Links a contribution to the MarketingFundFeeRecord it originated from." },
      "campaignId": { "type": "string", "description": "For expenditures allocated to a campaign." },
      "recordedAt": { "type": "string", "format": "date-time" },
      "recordedByUserId": { "type": "string" }
    }
  }
  ```
- **Notes:** Double-entry style ledger; running balance is derived, not stored.

#### `domain.MarketingCampaign`
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["_id", "name", "status", "startDate"],
    "properties": {
      "_id": { "type": "string" },
      "name": { "type": "string" },
      "status": { "type": "string", "enum": ["planned", "active", "completed", "cancelled"] },
      "channel": { "type": "string", "enum": ["digital", "print", "ooh", "radio", "tv", "local", "event", "mixed"] },
      "scope": { "type": "string", "enum": ["national", "regional", "local"] },
      "targetTerritoryIds": { "type": "array", "items": { "type": "string" } },
      "startDate": { "type": "string", "format": "date" },
      "endDate": { "type": "string", "format": "date" },
      "plannedBudget": { "type": "number", "minimum": 0 },
      "currency": { "type": "string", "default": "USD" },
      "ownerUserId": { "type": "string" },
      "kpis": { "type": "array", "items": { "$ref": "#/definitions/CampaignKPI" } }
    }
  }
  ```

#### `domain.CampaignKPI`
- **Level:** embedded
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["name"],
    "properties": {
      "name": { "type": "string" },
      "targetValue": { "type": "number" },
      "actualValue": { "type": "number" },
      "unit": { "type": "string" }
    }
  }
  ```

#### `domain.MarketingExpense`
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["_id", "amount", "currency", "incurredOn", "category"],
    "properties": {
      "_id": { "type": "string" },
      "campaignId": { "type": "string" },
      "category": { "type": "string", "enum": ["creative", "media", "agency", "events", "print", "swag", "other"] },
      "vendor": { "type": "string" },
      "amount": { "type": "number", "minimum": 0 },
      "currency": { "type": "string", "default": "USD" },
      "incurredOn": { "type": "string", "format": "date" },
      "paidFromFund": { "type": "boolean", "default": false, "description": "True if settled from the marketing fund; triggers a linked ledger entry." },
      "ledgerEntryId": { "type": "string" },
      "description": { "type": "string" },
      "recordedAt": { "type": "string", "format": "date-time" },
      "recordedByUserId": { "type": "string" }
    }
  }
  ```
- **Notes:** Fund-paid expenses also produce a `MarketingFundLedgerEntry`; the link is tracked via `ledgerEntryId`.

### Operations

#### `domain.TrainingCourse`
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["_id", "code", "title", "status"],
    "properties": {
      "_id": { "type": "string" },
      "code": { "type": "string" },
      "title": { "type": "string" },
      "description": { "type": "string" },
      "deliveryMode": { "type": "string", "enum": ["online", "inPerson", "hybrid"] },
      "durationHours": { "type": "number", "minimum": 0 },
      "requiredForRoles": {
        "type": "array",
        "items": { "type": "string", "enum": ["franchiseeOwner", "manager", "trainer", "staff"] }
      },
      "status": { "type": "string", "enum": ["active", "archived"] },
      "modules": { "type": "array", "items": { "$ref": "#/definitions/TrainingModule" } }
    }
  }
  ```

#### `domain.TrainingModule`
- **Level:** embedded
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["key", "title"],
    "properties": {
      "key": { "type": "string" },
      "title": { "type": "string" },
      "contentUrl": { "type": "string" },
      "ordinal": { "type": "integer", "minimum": 0 }
    }
  }
  ```

#### `domain.TrainingEnrollment`
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["_id", "courseId", "userId", "status", "enrolledAt"],
    "properties": {
      "_id": { "type": "string" },
      "courseId": { "type": "string" },
      "userId": { "type": "string" },
      "franchiseeId": { "type": "string" },
      "outletId": { "type": "string" },
      "status": { "type": "string", "enum": ["enrolled", "inProgress", "completed", "failed", "withdrawn"] },
      "enrolledAt": { "type": "string", "format": "date-time" },
      "startedAt": { "type": "string", "format": "date-time" },
      "completedAt": { "type": "string", "format": "date-time" },
      "score": { "type": "number", "minimum": 0, "maximum": 100 },
      "certificateUrl": { "type": "string" },
      "moduleProgress": {
        "type": "object",
        "additionalProperties": {
          "type": "object",
          "properties": {
            "status": { "type": "string", "enum": ["notStarted", "inProgress", "done"] },
            "completedAt": { "type": "string", "format": "date-time" }
          }
        }
      }
    }
  }
  ```
- **Notes:** `moduleProgress` is a dictionary keyed by `TrainingModule.key` — natural fit because modules are identified by key, not index.

#### `domain.SupportTicket`
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["_id", "subject", "status", "priority", "openedByUserId", "openedAt"],
    "properties": {
      "_id": { "type": "string" },
      "subject": { "type": "string" },
      "description": { "type": "string" },
      "category": { "type": "string", "enum": ["ops", "tech", "finance", "marketing", "legal", "hr", "other"] },
      "priority": { "type": "string", "enum": ["low", "normal", "high", "urgent"] },
      "status": { "type": "string", "enum": ["open", "inProgress", "waitingOnRequester", "resolved", "closed"] },
      "franchiseeId": { "type": "string" },
      "outletId": { "type": "string" },
      "openedByUserId": { "type": "string" },
      "assignedToUserId": { "type": "string" },
      "openedAt": { "type": "string", "format": "date-time" },
      "resolvedAt": { "type": "string", "format": "date-time" },
      "slaDueAt": { "type": "string", "format": "date-time" },
      "messages": { "type": "array", "items": { "$ref": "#/definitions/TicketMessage" } }
    }
  }
  ```

#### `domain.TicketMessage`
- **Level:** embedded
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["authorUserId", "body", "postedAt"],
    "properties": {
      "authorUserId": { "type": "string" },
      "body": { "type": "string" },
      "postedAt": { "type": "string", "format": "date-time" },
      "isInternalNote": { "type": "boolean", "default": false },
      "attachments": { "type": "array", "items": { "type": "string" } }
    }
  }
  ```

#### `domain.Announcement`
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["_id", "title", "body", "status", "audience", "createdAt", "authorUserId"],
    "properties": {
      "_id": { "type": "string" },
      "title": { "type": "string" },
      "body": { "type": "string" },
      "status": { "type": "string", "enum": ["draft", "scheduled", "published", "archived"] },
      "audience": {
        "type": "object",
        "required": ["scope"],
        "properties": {
          "scope": { "type": "string", "enum": ["allFranchisees", "franchisorStaff", "franchisee", "outlet", "territory"] },
          "franchiseeIds": { "type": "array", "items": { "type": "string" } },
          "outletIds": { "type": "array", "items": { "type": "string" } },
          "territoryIds": { "type": "array", "items": { "type": "string" } }
        }
      },
      "publishAt": { "type": "string", "format": "date-time" },
      "expiresAt": { "type": "string", "format": "date-time" },
      "authorUserId": { "type": "string" },
      "createdAt": { "type": "string", "format": "date-time" },
      "acknowledgements": {
        "type": "object",
        "additionalProperties": {
          "type": "object",
          "properties": {
            "acknowledgedAt": { "type": "string", "format": "date-time" }
          }
        }
      }
    }
  }
  ```
- **Notes:** `acknowledgements` is a dictionary keyed by `User._id` — O(1) check whether a given user has acknowledged.

### Actions namespace — I/O classes

All classes below are embedded. They define request/response shapes only.

#### `actions.ConvertLeadToFranchiseeInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["leadId", "legalName", "tier"],
    "properties": {
      "leadId": { "type": "string" },
      "legalName": { "type": "string" },
      "tradeName": { "type": "string" },
      "tier": { "type": "string", "enum": ["master", "standard"] },
      "parentFranchiseeId": { "type": "string" },
      "territoryId": { "type": "string" },
      "assignAsMaster": { "type": "boolean", "default": false },
      "taxId": { "type": "string" },
      "mailingAddress": { "$ref": "domain.Address" },
      "primaryContact": {
        "type": "object",
        "required": ["name", "email"],
        "properties": {
          "name": { "type": "string" },
          "email": { "type": "string", "format": "email" },
          "phone": { "type": "string" }
        }
      },
      "createOnboardingChecklist": { "type": "boolean", "default": true }
    }
  }
  ```

#### `actions.ConvertLeadToFranchiseeOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["franchiseeId"],
    "properties": {
      "franchiseeId": { "type": "string" },
      "territoryId": { "type": "string" },
      "onboardingChecklistId": { "type": "string" }
    }
  }
  ```

#### `actions.AssignTerritoryInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["territoryId", "franchiseeId"],
    "properties": {
      "territoryId": { "type": "string" },
      "franchiseeId": { "type": "string" },
      "assignAsMaster": { "type": "boolean", "default": false },
      "effectiveDate": { "type": "string", "format": "date" }
    }
  }
  ```

#### `actions.AssignTerritoryOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["territoryId", "status"],
    "properties": {
      "territoryId": { "type": "string" },
      "status": { "type": "string", "enum": ["assigned"] },
      "assignedAt": { "type": "string", "format": "date-time" }
    }
  }
  ```

#### `actions.ReleaseTerritoryInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["territoryId", "reason"],
    "properties": {
      "territoryId": { "type": "string" },
      "reason": { "type": "string" },
      "effectiveDate": { "type": "string", "format": "date" }
    }
  }
  ```

#### `actions.ReleaseTerritoryOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["territoryId"],
    "properties": {
      "territoryId": { "type": "string" },
      "status": { "type": "string", "enum": ["available"] }
    }
  }
  ```

#### `actions.OpenOutletInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["outletId", "openedOn"],
    "properties": {
      "outletId": { "type": "string" },
      "openedOn": { "type": "string", "format": "date" },
      "managerName": { "type": "string" },
      "managerEmail": { "type": "string", "format": "email" }
    }
  }
  ```

#### `actions.OpenOutletOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["outletId", "status"],
    "properties": {
      "outletId": { "type": "string" },
      "status": { "type": "string", "enum": ["open"] }
    }
  }
  ```

#### `actions.CloseOutletInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["outletId", "closedOn", "reason"],
    "properties": {
      "outletId": { "type": "string" },
      "closedOn": { "type": "string", "format": "date" },
      "reason": { "type": "string" },
      "temporary": { "type": "boolean", "default": false }
    }
  }
  ```

#### `actions.CloseOutletOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["outletId", "status"],
    "properties": {
      "outletId": { "type": "string" },
      "status": { "type": "string", "enum": ["temporarilyClosed", "closed"] }
    }
  }
  ```

#### `actions.SubmitSalesReportInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["outletId", "periodType", "periodStart", "periodEnd", "grossSales"],
    "properties": {
      "outletId": { "type": "string" },
      "periodType": { "type": "string", "enum": ["weekly", "monthly"] },
      "periodStart": { "type": "string", "format": "date" },
      "periodEnd": { "type": "string", "format": "date" },
      "grossSales": { "type": "number", "minimum": 0 },
      "netSales": { "type": "number", "minimum": 0 },
      "discounts": { "type": "number", "minimum": 0 },
      "refunds": { "type": "number", "minimum": 0 },
      "transactionCount": { "type": "integer", "minimum": 0 },
      "currency": { "type": "string" },
      "breakdown": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "category": { "type": "string" },
            "amount": { "type": "number" }
          }
        }
      },
      "notes": { "type": "string" }
    }
  }
  ```

#### `actions.SubmitSalesReportOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["salesReportId", "status"],
    "properties": {
      "salesReportId": { "type": "string" },
      "status": { "type": "string", "enum": ["submitted"] }
    }
  }
  ```

#### `actions.AmendSalesReportInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["originalReportId", "reason", "corrected"],
    "properties": {
      "originalReportId": { "type": "string" },
      "reason": { "type": "string" },
      "corrected": { "$ref": "actions.SubmitSalesReportInput" }
    }
  }
  ```

#### `actions.AmendSalesReportOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["amendmentReportId"],
    "properties": {
      "amendmentReportId": { "type": "string" },
      "supersedesReportId": { "type": "string" }
    }
  }
  ```

#### `actions.AcceptSalesReportInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["salesReportId"],
    "properties": {
      "salesReportId": { "type": "string" },
      "note": { "type": "string" }
    }
  }
  ```

#### `actions.AcceptSalesReportOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["salesReportId", "status"],
    "properties": {
      "salesReportId": { "type": "string" },
      "status": { "type": "string", "enum": ["accepted"] }
    }
  }
  ```

#### `actions.DisputeSalesReportInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["salesReportId", "reason"],
    "properties": {
      "salesReportId": { "type": "string" },
      "reason": { "type": "string" }
    }
  }
  ```

#### `actions.DisputeSalesReportOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["salesReportId", "status"],
    "properties": {
      "salesReportId": { "type": "string" },
      "status": { "type": "string", "enum": ["disputed"] }
    }
  }
  ```

#### `actions.RecordFeeInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["feeType", "franchiseeId", "amount", "dueDate"],
    "properties": {
      "feeType": { "type": "string", "enum": ["initial", "royalty", "marketingFund", "tech", "supply", "training", "renewal", "transfer"] },
      "franchiseeId": { "type": "string" },
      "outletId": { "type": "string" },
      "amount": { "type": "number", "minimum": 0 },
      "currency": { "type": "string" },
      "dueDate": { "type": "string", "format": "date" },
      "referenceNumber": { "type": "string" },
      "memo": { "type": "string" },
      "salesReportId": { "type": "string", "description": "Required when feeType=royalty or marketingFund." },
      "ratePercent": { "type": "number", "minimum": 0 },
      "contractId": { "type": "string", "description": "For initial/renewal/transfer fees." },
      "previousFranchiseeId": { "type": "string", "description": "For transfer fees." }
    }
  }
  ```

#### `actions.RecordFeeOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["feeRecordId", "feeType"],
    "properties": {
      "feeRecordId": { "type": "string" },
      "feeType": { "type": "string" },
      "marketingFundLedgerEntryId": { "type": "string", "description": "Present when feeType=marketingFund." }
    }
  }
  ```

#### `actions.GenerateRoyaltyStatementInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["franchiseeId", "periodStart", "periodEnd"],
    "properties": {
      "franchiseeId": { "type": "string" },
      "periodStart": { "type": "string", "format": "date" },
      "periodEnd": { "type": "string", "format": "date" },
      "includeOutletBreakdown": { "type": "boolean", "default": true }
    }
  }
  ```

#### `actions.GenerateRoyaltyStatementOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["franchiseeId", "periodStart", "periodEnd", "totalGrossSales", "totalRoyaltyFees", "totalMarketingFundFees"],
    "properties": {
      "franchiseeId": { "type": "string" },
      "periodStart": { "type": "string", "format": "date" },
      "periodEnd": { "type": "string", "format": "date" },
      "totalGrossSales": { "type": "number" },
      "totalNetSales": { "type": "number" },
      "totalRoyaltyFees": { "type": "number" },
      "totalMarketingFundFees": { "type": "number" },
      "totalOtherFees": { "type": "number" },
      "currency": { "type": "string" },
      "outletLines": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "outletId": { "type": "string" },
            "grossSales": { "type": "number" },
            "royaltyFees": { "type": "number" },
            "marketingFundFees": { "type": "number" },
            "reportIds": { "type": "array", "items": { "type": "string" } },
            "feeRecordIds": { "type": "array", "items": { "type": "string" } }
          }
        }
      },
      "missingReports": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "outletId": { "type": "string" },
            "periodStart": { "type": "string", "format": "date" },
            "periodEnd": { "type": "string", "format": "date" }
          }
        }
      }
    }
  }
  ```

#### `actions.UploadDocumentVersionInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["documentId", "fileUrl", "fileName"],
    "properties": {
      "documentId": { "type": "string" },
      "fileUrl": { "type": "string" },
      "fileName": { "type": "string" },
      "mimeType": { "type": "string" },
      "fileSizeBytes": { "type": "integer" },
      "checksum": { "type": "string" },
      "changeNote": { "type": "string" },
      "label": { "type": "string" }
    }
  }
  ```

#### `actions.UploadDocumentVersionOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["documentId", "versionNumber"],
    "properties": {
      "documentId": { "type": "string" },
      "versionNumber": { "type": "integer" }
    }
  }
  ```

#### `actions.RenewContractInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["contractId", "newTermStart", "newTermEnd"],
    "properties": {
      "contractId": { "type": "string" },
      "newTermStart": { "type": "string", "format": "date" },
      "newTermEnd": { "type": "string", "format": "date" },
      "renewalFeeAmount": { "type": "number", "minimum": 0 },
      "renewalFeeDueDate": { "type": "string", "format": "date" },
      "newDocumentFileUrl": { "type": "string" },
      "newDocumentFileName": { "type": "string" }
    }
  }
  ```

#### `actions.RenewContractOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["renewalContractId"],
    "properties": {
      "renewalContractId": { "type": "string" },
      "supersededContractId": { "type": "string" },
      "renewalFeeRecordId": { "type": "string" }
    }
  }
  ```

#### `actions.TransferFranchiseeInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["originalFranchiseeId", "newFranchiseeId", "effectiveDate"],
    "properties": {
      "originalFranchiseeId": { "type": "string" },
      "newFranchiseeId": { "type": "string" },
      "outletIds": { "type": "array", "items": { "type": "string" }, "description": "Outlets to transfer. Empty = all." },
      "territoryIds": { "type": "array", "items": { "type": "string" } },
      "effectiveDate": { "type": "string", "format": "date" },
      "transferFeeAmount": { "type": "number", "minimum": 0 },
      "transferFeeDueDate": { "type": "string", "format": "date" },
      "newContractFileUrl": { "type": "string" }
    }
  }
  ```

#### `actions.TransferFranchiseeOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["transferredOutletIds"],
    "properties": {
      "transferredOutletIds": { "type": "array", "items": { "type": "string" } },
      "transferredTerritoryIds": { "type": "array", "items": { "type": "string" } },
      "transferContractId": { "type": "string" },
      "transferFeeRecordId": { "type": "string" }
    }
  }
  ```

#### `actions.TerminateFranchiseeInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["franchiseeId", "reason", "effectiveDate"],
    "properties": {
      "franchiseeId": { "type": "string" },
      "reason": { "type": "string" },
      "effectiveDate": { "type": "string", "format": "date" },
      "releaseTerritories": { "type": "boolean", "default": true }
    }
  }
  ```

#### `actions.TerminateFranchiseeOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["franchiseeId", "status"],
    "properties": {
      "franchiseeId": { "type": "string" },
      "status": { "type": "string", "enum": ["terminated"] },
      "closedOutletIds": { "type": "array", "items": { "type": "string" } },
      "releasedTerritoryIds": { "type": "array", "items": { "type": "string" } }
    }
  }
  ```

#### `actions.EnrollInCourseInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["courseId", "userId"],
    "properties": {
      "courseId": { "type": "string" },
      "userId": { "type": "string" },
      "outletId": { "type": "string" }
    }
  }
  ```

#### `actions.EnrollInCourseOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["enrollmentId"],
    "properties": {
      "enrollmentId": { "type": "string" }
    }
  }
  ```

#### `actions.CompleteTrainingModuleInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["enrollmentId", "moduleKey"],
    "properties": {
      "enrollmentId": { "type": "string" },
      "moduleKey": { "type": "string" },
      "score": { "type": "number", "minimum": 0, "maximum": 100 }
    }
  }
  ```

#### `actions.CompleteTrainingModuleOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["enrollmentId", "courseStatus"],
    "properties": {
      "enrollmentId": { "type": "string" },
      "courseStatus": { "type": "string", "enum": ["inProgress", "completed"] },
      "allModulesComplete": { "type": "boolean" }
    }
  }
  ```

#### `actions.PublishAnnouncementInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["announcementId"],
    "properties": {
      "announcementId": { "type": "string" },
      "publishAt": { "type": "string", "format": "date-time" }
    }
  }
  ```

#### `actions.PublishAnnouncementOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["announcementId", "status"],
    "properties": {
      "announcementId": { "type": "string" },
      "status": { "type": "string", "enum": ["published", "scheduled"] }
    }
  }
  ```

#### `actions.AcknowledgeAnnouncementInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["announcementId", "userId"],
    "properties": {
      "announcementId": { "type": "string" },
      "userId": { "type": "string" }
    }
  }
  ```

#### `actions.AcknowledgeAnnouncementOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["announcementId", "acknowledgedAt"],
    "properties": {
      "announcementId": { "type": "string" },
      "acknowledgedAt": { "type": "string", "format": "date-time" }
    }
  }
  ```

#### `actions.RecordMarketingFundContributionInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["franchiseeId", "amount", "occurredOn"],
    "properties": {
      "franchiseeId": { "type": "string" },
      "amount": { "type": "number", "minimum": 0 },
      "currency": { "type": "string" },
      "occurredOn": { "type": "string", "format": "date" },
      "feeRecordId": { "type": "string" },
      "description": { "type": "string" }
    }
  }
  ```

#### `actions.RecordMarketingFundContributionOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["ledgerEntryId"],
    "properties": { "ledgerEntryId": { "type": "string" } }
  }
  ```

#### `actions.RecordMarketingExpenseInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["amount", "category", "incurredOn"],
    "properties": {
      "amount": { "type": "number", "minimum": 0 },
      "currency": { "type": "string" },
      "category": { "type": "string" },
      "vendor": { "type": "string" },
      "incurredOn": { "type": "string", "format": "date" },
      "campaignId": { "type": "string" },
      "paidFromFund": { "type": "boolean", "default": false },
      "description": { "type": "string" }
    }
  }
  ```

#### `actions.RecordMarketingExpenseOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["expenseId"],
    "properties": {
      "expenseId": { "type": "string" },
      "ledgerEntryId": { "type": "string" }
    }
  }
  ```

#### `actions.ComputeOutletRiskFlagsInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "outletIds": { "type": "array", "items": { "type": "string" } },
      "asOfDate": { "type": "string", "format": "date" }
    }
  }
  ```
- **Notes:** Empty `outletIds` = refresh for all outlets.

#### `actions.ComputeOutletRiskFlagsOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["outletsUpdated"],
    "properties": {
      "outletsUpdated": { "type": "integer" },
      "flagged": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "outletId": { "type": "string" },
            "flags": { "type": "array", "items": { "type": "string" } }
          }
        }
      }
    }
  }
  ```

#### `actions.GetOnboardingPipelineSnapshotInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "territoryIds": { "type": "array", "items": { "type": "string" } },
      "ownerUserId": { "type": "string" }
    }
  }
  ```

#### `actions.GetOnboardingPipelineSnapshotOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["byStage"],
    "properties": {
      "byStage": {
        "type": "object",
        "additionalProperties": {
          "type": "object",
          "properties": {
            "count": { "type": "integer" },
            "leadIds": { "type": "array", "items": { "type": "string" } }
          }
        }
      },
      "checklistStatus": {
        "type": "object",
        "properties": {
          "notStarted": { "type": "integer" },
          "inProgress": { "type": "integer" },
          "completed": { "type": "integer" },
          "blocked": { "type": "integer" }
        }
      }
    }
  }
  ```

#### `actions.GetOutletsAtRiskInput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "franchiseeId": { "type": "string" },
      "territoryId": { "type": "string" },
      "flagFilter": { "type": "array", "items": { "type": "string" } }
    }
  }
  ```

#### `actions.GetOutletsAtRiskOutput`
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "required": ["outlets"],
    "properties": {
      "outlets": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "outletId": { "type": "string" },
            "franchiseeId": { "type": "string" },
            "flags": { "type": "array", "items": { "type": "string" } },
            "lastReportPeriodEnd": { "type": "string", "format": "date" },
            "openTickets": { "type": "integer" },
            "overdueComplianceDocs": { "type": "integer" }
          }
        }
      }
    }
  }
  ```

---

## Embeddings

| Parent class | Field | Form | Embedded class |
|---|---|---|---|
| `domain.Franchisee` | `mailingAddress` | single | `domain.Address` |
| `domain.Franchisee` | `primaryContact` | single | inline (sub-object) |
| `domain.Outlet` | `address` | single | `domain.Address` |
| `domain.Lead` | `notes` | array | `domain.PipelineNote` |
| `domain.OnboardingChecklist` | `tasks` | array | `domain.OnboardingTask` |
| `domain.OnboardingTask` | `notes` | array | `domain.PipelineNote` |
| `domain.Document` | `currentVersion` | single | `domain.DocumentVersion` |
| `domain.Document` | `versionHistory` | array | `domain.DocumentVersion` |
| `domain.ContractDocument` | `signatories` | array | `domain.DocumentSignatory` |
| `domain.TrainingCourse` | `modules` | array | `domain.TrainingModule` |
| `domain.TrainingEnrollment` | `moduleProgress` | dictionary | inline module-progress entry (keyed by `TrainingModule.key`) |
| `domain.SupportTicket` | `messages` | array | `domain.TicketMessage` |
| `domain.Announcement` | `acknowledgements` | dictionary | inline ack entry (keyed by `User._id`) |
| `domain.MarketingCampaign` | `kpis` | array | `domain.CampaignKPI` |
| `domain.SalesReport` | `breakdown` | array | inline breakdown line |

---

## References

| Class | Field | Points to |
|---|---|---|
| `domain.Franchisee` | `parentFranchiseeId` | `domain.Franchisee._id` |
| `domain.FranchiseeOwnerUser` | `franchiseeId` | `domain.Franchisee._id` |
| `domain.FranchiseeStaffUser` | `franchiseeId` | `domain.Franchisee._id` |
| `domain.FranchiseeStaffUser` | `outletIds[*]` | `domain.Outlet._id` |
| `domain.Outlet` | `franchiseeId` | `domain.Franchisee._id` |
| `domain.Outlet` | `territoryId` | `domain.Territory._id` |
| `domain.Territory` | `assignedFranchiseeId` | `domain.Franchisee._id` |
| `domain.Lead` | `ownerUserId` | `domain.User._id` |
| `domain.Lead` | `convertedFranchiseeId` | `domain.Franchisee._id` |
| `domain.Lead` | `interestedTerritoryIds[*]` | `domain.Territory._id` |
| `domain.OnboardingChecklist` | `franchiseeId` | `domain.Franchisee._id` |
| `domain.OnboardingChecklist` | `outletId` | `domain.Outlet._id` |
| `domain.OnboardingTask` | `assignedUserId` | `domain.User._id` |
| `domain.Document` | `ownerScope.franchiseeId` | `domain.Franchisee._id` |
| `domain.Document` | `ownerScope.outletId` | `domain.Outlet._id` |
| `domain.Document` | `ownerScope.territoryId` | `domain.Territory._id` |
| `domain.ContractDocument` | `counterpartyFranchiseeId` | `domain.Franchisee._id` |
| `domain.DocumentVersion` | `uploadedByUserId` | `domain.User._id` |
| `domain.DocumentSignatory` | `userId` | `domain.User._id` |
| `domain.SalesReport` | `outletId` | `domain.Outlet._id` |
| `domain.SalesReport` | `franchiseeId` | `domain.Franchisee._id` |
| `domain.SalesReport` | `submittedByUserId` | `domain.User._id` |
| `domain.SalesReport` | `amendsReportId` | `domain.SalesReport._id` |
| `domain.FeeRecord` | `franchiseeId` | `domain.Franchisee._id` |
| `domain.FeeRecord` | `outletId` | `domain.Outlet._id` |
| `domain.FeeRecord` | `recordedByUserId` | `domain.User._id` |
| `domain.RoyaltyFeeRecord` | `salesReportId` | `domain.SalesReport._id` |
| `domain.MarketingFundFeeRecord` | `salesReportId` | `domain.SalesReport._id` |
| `domain.InitialFeeRecord` | `contractId` | `domain.ContractDocument._id` |
| `domain.RenewalFeeRecord` | `contractId` | `domain.ContractDocument._id` |
| `domain.TransferFeeRecord` | `contractId` | `domain.ContractDocument._id` |
| `domain.TransferFeeRecord` | `previousFranchiseeId` | `domain.Franchisee._id` |
| `domain.MarketingFundLedgerEntry` | `franchiseeId` | `domain.Franchisee._id` |
| `domain.MarketingFundLedgerEntry` | `feeRecordId` | `domain.MarketingFundFeeRecord._id` |
| `domain.MarketingFundLedgerEntry` | `campaignId` | `domain.MarketingCampaign._id` |
| `domain.MarketingExpense` | `campaignId` | `domain.MarketingCampaign._id` |
| `domain.MarketingExpense` | `ledgerEntryId` | `domain.MarketingFundLedgerEntry._id` |
| `domain.MarketingCampaign` | `ownerUserId` | `domain.User._id` |
| `domain.MarketingCampaign` | `targetTerritoryIds[*]` | `domain.Territory._id` |
| `domain.TrainingEnrollment` | `courseId` | `domain.TrainingCourse._id` |
| `domain.TrainingEnrollment` | `userId` | `domain.User._id` |
| `domain.TrainingEnrollment` | `franchiseeId` | `domain.Franchisee._id` |
| `domain.TrainingEnrollment` | `outletId` | `domain.Outlet._id` |
| `domain.SupportTicket` | `franchiseeId` | `domain.Franchisee._id` |
| `domain.SupportTicket` | `outletId` | `domain.Outlet._id` |
| `domain.SupportTicket` | `openedByUserId` | `domain.User._id` |
| `domain.SupportTicket` | `assignedToUserId` | `domain.User._id` |
| `domain.TicketMessage` | `authorUserId` | `domain.User._id` |
| `domain.Announcement` | `authorUserId` | `domain.User._id` |
| `domain.Announcement` | `audience.franchiseeIds[*]` | `domain.Franchisee._id` |
| `domain.Announcement` | `audience.outletIds[*]` | `domain.Outlet._id` |
| `domain.Announcement` | `audience.territoryIds[*]` | `domain.Territory._id` |

---

## Relations

| Relation | Source | Source field | Target | Target field |
|---|---|---|---|---|
| franchisee-parent | `domain.Franchisee` | `parentFranchiseeId` | `domain.Franchisee` | `_id` |
| franchisee-owner | `domain.FranchiseeOwnerUser` | `franchiseeId` | `domain.Franchisee` | `_id` |
| franchisee-staff-employer | `domain.FranchiseeStaffUser` | `franchiseeId` | `domain.Franchisee` | `_id` |
| outlet-franchisee | `domain.Outlet` | `franchiseeId` | `domain.Franchisee` | `_id` |
| outlet-territory | `domain.Outlet` | `territoryId` | `domain.Territory` | `_id` |
| territory-assignment | `domain.Territory` | `assignedFranchiseeId` | `domain.Franchisee` | `_id` |
| lead-converted | `domain.Lead` | `convertedFranchiseeId` | `domain.Franchisee` | `_id` |
| lead-owner | `domain.Lead` | `ownerUserId` | `domain.User` | `_id` |
| checklist-franchisee | `domain.OnboardingChecklist` | `franchiseeId` | `domain.Franchisee` | `_id` |
| checklist-outlet | `domain.OnboardingChecklist` | `outletId` | `domain.Outlet` | `_id` |
| document-franchisee | `domain.Document` | `ownerScope.franchiseeId` | `domain.Franchisee` | `_id` |
| document-outlet | `domain.Document` | `ownerScope.outletId` | `domain.Outlet` | `_id` |
| document-territory | `domain.Document` | `ownerScope.territoryId` | `domain.Territory` | `_id` |
| contract-counterparty | `domain.ContractDocument` | `counterpartyFranchiseeId` | `domain.Franchisee` | `_id` |
| sales-report-outlet | `domain.SalesReport` | `outletId` | `domain.Outlet` | `_id` |
| sales-report-franchisee | `domain.SalesReport` | `franchiseeId` | `domain.Franchisee` | `_id` |
| sales-report-amendment | `domain.SalesReport` | `amendsReportId` | `domain.SalesReport` | `_id` |
| fee-franchisee | `domain.FeeRecord` | `franchiseeId` | `domain.Franchisee` | `_id` |
| fee-outlet | `domain.FeeRecord` | `outletId` | `domain.Outlet` | `_id` |
| royalty-report | `domain.RoyaltyFeeRecord` | `salesReportId` | `domain.SalesReport` | `_id` |
| mktg-fund-fee-report | `domain.MarketingFundFeeRecord` | `salesReportId` | `domain.SalesReport` | `_id` |
| initial-fee-contract | `domain.InitialFeeRecord` | `contractId` | `domain.ContractDocument` | `_id` |
| renewal-fee-contract | `domain.RenewalFeeRecord` | `contractId` | `domain.ContractDocument` | `_id` |
| transfer-fee-contract | `domain.TransferFeeRecord` | `contractId` | `domain.ContractDocument` | `_id` |
| fund-ledger-franchisee | `domain.MarketingFundLedgerEntry` | `franchiseeId` | `domain.Franchisee` | `_id` |
| fund-ledger-fee | `domain.MarketingFundLedgerEntry` | `feeRecordId` | `domain.MarketingFundFeeRecord` | `_id` |
| fund-ledger-campaign | `domain.MarketingFundLedgerEntry` | `campaignId` | `domain.MarketingCampaign` | `_id` |
| expense-campaign | `domain.MarketingExpense` | `campaignId` | `domain.MarketingCampaign` | `_id` |
| expense-ledger | `domain.MarketingExpense` | `ledgerEntryId` | `domain.MarketingFundLedgerEntry` | `_id` |
| enrollment-course | `domain.TrainingEnrollment` | `courseId` | `domain.TrainingCourse` | `_id` |
| enrollment-user | `domain.TrainingEnrollment` | `userId` | `domain.User` | `_id` |
| ticket-franchisee | `domain.SupportTicket` | `franchiseeId` | `domain.Franchisee` | `_id` |
| ticket-outlet | `domain.SupportTicket` | `outletId` | `domain.Outlet` | `_id` |
| ticket-opener | `domain.SupportTicket` | `openedByUserId` | `domain.User` | `_id` |
| ticket-assignee | `domain.SupportTicket` | `assignedToUserId` | `domain.User` | `_id` |
| announcement-author | `domain.Announcement` | `authorUserId` | `domain.User` | `_id` |

---

## Actions

### convertLeadToFranchisee
- **Target:** `domain.Lead`
- **Input class:** `actions.ConvertLeadToFranchiseeInput`
- **Output class:** `actions.ConvertLeadToFranchiseeOutput`
- **Behavior:** Promotes a qualified Lead into a Franchisee. Creates a `domain.Franchisee` (and, if requested, assigns a Territory and seeds an `OnboardingChecklist` with default tasks). Updates the Lead's stage to `converted` and writes `convertedFranchiseeId`. Enforces that the Lead isn't already converted, and that the referenced Territory is `available` if provided. All writes happen atomically on the server.

### assignTerritory
- **Target:** `domain.Territory`
- **Input class:** `actions.AssignTerritoryInput`
- **Output class:** `actions.AssignTerritoryOutput`
- **Behavior:** Assigns a Territory to a Franchisee. Enforces the exclusivity invariant: if `exclusivityType=exclusive` and the territory is already assigned, the action fails. Sets `assignedFranchiseeId`, `assignedAsMaster`, `status=assigned`, `assignedAt`.

### releaseTerritory
- **Target:** `domain.Territory`
- **Input class:** `actions.ReleaseTerritoryInput`
- **Output class:** `actions.ReleaseTerritoryOutput`
- **Behavior:** Releases a Territory. Enforces that no `open` outlets remain tied to it under that franchisee, or explicitly detaches them first. Sets `status=available`, clears `assignedFranchiseeId`.

### openOutlet
- **Target:** `domain.Outlet`
- **Input class:** `actions.OpenOutletInput`
- **Output class:** `actions.OpenOutletOutput`
- **Behavior:** Transitions an outlet from `planned`/`underConstruction` to `open`. Enforces that the franchisee is `active` and the outlet's onboarding checklist (if any) is `completed`. Stamps `openedAt`.

### closeOutlet
- **Target:** `domain.Outlet`
- **Input class:** `actions.CloseOutletInput`
- **Output class:** `actions.CloseOutletOutput`
- **Behavior:** Sets outlet status to `temporarilyClosed` or `closed`, stamps `closedAt`, and cascades risk-flag recomputation.

### submitSalesReport
- **Target:** `domain.SalesReport`
- **Input class:** `actions.SubmitSalesReportInput`
- **Output class:** `actions.SubmitSalesReportOutput`
- **Behavior:** Creates a SalesReport with status `submitted`. Enforces no overlapping accepted report already covers the same `outletId × period`. Infers `franchiseeId` from the outlet. Clears the `lateReporting` risk flag on the outlet if present.

### amendSalesReport
- **Target:** `domain.SalesReport`
- **Input class:** `actions.AmendSalesReportInput`
- **Output class:** `actions.AmendSalesReportOutput`
- **Behavior:** Creates a new SalesReport with `status=amended` and `amendsReportId` pointing to the original. Does not destructively edit the original, preserving audit trail. If the original had associated royalty fees, marks them for finance review (out-of-band flag on the memo field rather than auto-reversal — keeps the "record only" boundary).

### acceptSalesReport
- **Target:** `domain.SalesReport`
- **Input class:** `actions.AcceptSalesReportInput`
- **Output class:** `actions.AcceptSalesReportOutput`
- **Behavior:** Franchisor-side acceptance. Transitions report to `accepted` and stamps `acceptedAt`. Required before that report can back a royalty fee record.

### disputeSalesReport
- **Target:** `domain.SalesReport`
- **Input class:** `actions.DisputeSalesReportInput`
- **Output class:** `actions.DisputeSalesReportOutput`
- **Behavior:** Franchisor flags a submitted report as `disputed` with a reason. Does not allow fee records to be linked to this report until it's either amended (replaced) or re-accepted.

### recordFee
- **Target:** `domain.FeeRecord`
- **Input class:** `actions.RecordFeeInput`
- **Output class:** `actions.RecordFeeOutput`
- **Behavior:** Creates the appropriate FeeRecord subclass based on `feeType`. For `royalty`/`marketingFund`, validates that `salesReportId` references an `accepted` report belonging to the same franchisee. For `marketingFund`, additionally creates a linked `MarketingFundLedgerEntry` (contribution). Consolidates the "record a fee" entry point so the client only knows one action.

### generateRoyaltyStatement
- **Target:** system
- **Input class:** `actions.GenerateRoyaltyStatementInput`
- **Output class:** `actions.GenerateRoyaltyStatementOutput`
- **Behavior:** Read-only aggregation. Fetches accepted SalesReports and linked Royalty / MarketingFund fee records for a franchisee across a period, rolls them up per outlet, and also reports missing expected periods so the franchisor can chase them. Powers the "royalty statement for period" dashboard.

### uploadDocumentVersion
- **Target:** `domain.Document`
- **Input class:** `actions.UploadDocumentVersionInput`
- **Output class:** `actions.UploadDocumentVersionOutput`
- **Behavior:** Appends a new `DocumentVersion` to the document. Moves the existing `currentVersion` (if any) into `versionHistory`, increments `versionNumber`, updates `updatedAt`. If the document was `expired`/`superseded`, reverts status to `active`.

### renewContract
- **Target:** `domain.ContractDocument`
- **Input class:** `actions.RenewContractInput`
- **Output class:** `actions.RenewContractOutput`
- **Behavior:** Creates a new ContractDocument with `contractKind=renewal`, new term dates, and supersedes the prior contract (prior contract status becomes `superseded`). Optionally creates a linked `RenewalFeeRecord`. Optionally attaches a new file as the renewal's `currentVersion`.

### transferFranchisee
- **Target:** system
- **Input class:** `actions.TransferFranchiseeInput`
- **Output class:** `actions.TransferFranchiseeOutput`
- **Behavior:** Moves specified outlets (and optionally territories) from the original franchisee to the new franchisee, all on the same effective date. Generates a `ContractDocument` with `contractKind=transfer`, optionally a `TransferFeeRecord`, and cascades `Outlet.franchiseeId` + `Territory.assignedFranchiseeId` updates. Multi-class mutation — must not be decomposed into client-side CRUD.

### terminateFranchisee
- **Target:** `domain.Franchisee`
- **Input class:** `actions.TerminateFranchiseeInput`
- **Output class:** `actions.TerminateFranchiseeOutput`
- **Behavior:** Transitions the Franchisee to `terminated`. Closes all open outlets (`closed`, with `closedAt=effectiveDate`), optionally releases territories, supersedes the active franchise agreement, and flips any active `FranchiseeOwnerUser`/`FranchiseeStaffUser` accounts to `suspended`. This is deliberately a single action because the business rule "a terminated franchisee has no open outlets" must hold atomically.

### enrollInCourse
- **Target:** `domain.TrainingCourse`
- **Input class:** `actions.EnrollInCourseInput`
- **Output class:** `actions.EnrollInCourseOutput`
- **Behavior:** Creates a `TrainingEnrollment` for the user. Enforces one active enrollment per `(user, course)` pair. Seeds `moduleProgress` with `notStarted` for every current course module.

### completeTrainingModule
- **Target:** `domain.TrainingEnrollment`
- **Input class:** `actions.CompleteTrainingModuleInput`
- **Output class:** `actions.CompleteTrainingModuleOutput`
- **Behavior:** Marks a specific module's progress as `done`. If all modules are `done`, transitions enrollment to `completed` and stamps `completedAt`. Emits `allModulesComplete=true` in the output so the client can react.

### publishAnnouncement
- **Target:** `domain.Announcement`
- **Input class:** `actions.PublishAnnouncementInput`
- **Output class:** `actions.PublishAnnouncementOutput`
- **Behavior:** Transitions an Announcement from `draft` to `scheduled` (if `publishAt` is in the future) or `published` (now). Validates audience scope consistency.

### acknowledgeAnnouncement
- **Target:** `domain.Announcement`
- **Input class:** `actions.AcknowledgeAnnouncementInput`
- **Output class:** `actions.AcknowledgeAnnouncementOutput`
- **Behavior:** Adds/updates an entry in `acknowledgements[userId]` with timestamp. Idempotent — re-acknowledging returns the original timestamp.

### recordMarketingFundContribution
- **Target:** `domain.MarketingFundLedgerEntry`
- **Input class:** `actions.RecordMarketingFundContributionInput`
- **Output class:** `actions.RecordMarketingFundContributionOutput`
- **Behavior:** Writes a `contribution` ledger entry. Typically called by `recordFee` when a `marketingFund` fee is recorded, but also exposed directly for manual adjustments.

### recordMarketingExpense
- **Target:** `domain.MarketingExpense`
- **Input class:** `actions.RecordMarketingExpenseInput`
- **Output class:** `actions.RecordMarketingExpenseOutput`
- **Behavior:** Creates a `MarketingExpense`. If `paidFromFund=true`, atomically creates a linked `MarketingFundLedgerEntry` (expenditure) and cross-references both. Prevents two-step client workflows that could leave the ledger out of sync with expenses.

### computeOutletRiskFlags
- **Target:** system
- **Input class:** `actions.ComputeOutletRiskFlagsInput`
- **Output class:** `actions.ComputeOutletRiskFlagsOutput`
- **Behavior:** Recomputes `riskFlags` on outlets by scanning SalesReports (late reporting), ComplianceCertificateDocuments (expired), SupportTickets (open high-priority), and fee records (nothing recorded in N periods). Intended for scheduled invocation; also callable ad hoc from the dashboard.

### getOnboardingPipelineSnapshot
- **Target:** system
- **Input class:** `actions.GetOnboardingPipelineSnapshotInput`
- **Output class:** `actions.GetOnboardingPipelineSnapshotOutput`
- **Behavior:** Read-only aggregation for the onboarding pipeline dashboard. Groups Leads by stage and summarizes OnboardingChecklist statuses. A single call replaces multiple client-side filter queries.

### getOutletsAtRisk
- **Target:** system
- **Input class:** `actions.GetOutletsAtRiskInput`
- **Output class:** `actions.GetOutletsAtRiskOutput`
- **Behavior:** Read-only aggregation backing the "outlets at risk" dashboard. Returns outlets with at least one risk flag, enriched with last report period, open ticket count, and overdue compliance count. Uses currently stored flags (refreshed by `computeOutletRiskFlags`).

---

## Relation / action map

A compact view of which actions read or write which top-level classes.

| Action | Writes | Reads |
|---|---|---|
| convertLeadToFranchisee | Lead, Franchisee, Territory, OnboardingChecklist | Lead, Territory |
| assignTerritory | Territory | Territory, Franchisee |
| releaseTerritory | Territory | Territory, Outlet |
| openOutlet | Outlet | Outlet, Franchisee, OnboardingChecklist |
| closeOutlet | Outlet | Outlet |
| submitSalesReport | SalesReport, Outlet (riskFlags) | Outlet |
| amendSalesReport | SalesReport, FeeRecord (memo) | SalesReport, FeeRecord |
| acceptSalesReport | SalesReport | SalesReport |
| disputeSalesReport | SalesReport | SalesReport |
| recordFee | FeeRecord (subclass), MarketingFundLedgerEntry | SalesReport, ContractDocument, Franchisee |
| generateRoyaltyStatement | — (read-only) | SalesReport, RoyaltyFeeRecord, MarketingFundFeeRecord, Outlet |
| uploadDocumentVersion | Document | Document |
| renewContract | ContractDocument (×2), RenewalFeeRecord | ContractDocument |
| transferFranchisee | Outlet, Territory, ContractDocument, TransferFeeRecord | Franchisee, Outlet, Territory |
| terminateFranchisee | Franchisee, Outlet, Territory, ContractDocument, User | Franchisee, Outlet, Territory, ContractDocument |
| enrollInCourse | TrainingEnrollment | TrainingCourse, TrainingEnrollment |
| completeTrainingModule | TrainingEnrollment | TrainingEnrollment, TrainingCourse |
| publishAnnouncement | Announcement | Announcement |
| acknowledgeAnnouncement | Announcement | Announcement |
| recordMarketingFundContribution | MarketingFundLedgerEntry | — |
| recordMarketingExpense | MarketingExpense, MarketingFundLedgerEntry | MarketingCampaign |
| computeOutletRiskFlags | Outlet | SalesReport, ComplianceCertificateDocument, SupportTicket, FeeRecord |
| getOnboardingPipelineSnapshot | — (read-only) | Lead, OnboardingChecklist |
| getOutletsAtRisk | — (read-only) | Outlet, SalesReport, SupportTicket, ComplianceCertificateDocument |

---

## Design decisions

1. **Unified `Document` hierarchy instead of four bespoke classes.** Contracts, FDDs, compliance certificates, and operational docs share 80% of their metadata (title, versioning, expiry, ownership). A single parent with `docType` as discriminator gives you one query surface for "all expiring documents" while still letting each subtype carry its specifics. Trade-off: slightly fatter parent schema; payoff: the dashboard queries and the generic upload pipeline become trivial.

2. **`FeeRecord` hierarchy with `feeType` discriminator.** The eight fee types differ meaningfully — royalty and marketing-fund fees tie to a SalesReport, initial/renewal/transfer fees tie to a ContractDocument, flat fees tie to neither. Keeping them in one hierarchy lets the royalty statement action and the "all fees for franchisee" query work uniformly, while subclasses preserve the type-specific relations.

3. **Self-reported sales, recording-only semantics.** Per the requirements, the backend does not compute invoices or trigger payments. `recordFee` explicitly accepts the amount from the caller; the system validates consistency (accepted report, matching franchisee) but does not derive the fee. This keeps finance staff in control and avoids duplicating ledgers that live in the franchisor's accounting system. **Flagged**: if auto-calculation is eventually wanted, a `FeeSchedule` class and a `computeExpectedFees` action are the natural extension.

4. **Sales report amendments are additive, not destructive.** Instead of editing a submitted report, `amendSalesReport` creates a new report referencing the original via `amendsReportId`. This preserves the audit trail and lets accepted-but-later-amended reports still back their historical fee records. Trade-off: extra read step when showing "current view of a period"; payoff: no destructive edits of financial data.

5. **`transferFranchisee` and `terminateFranchisee` are single actions.** Each touches three to five top-level classes. Decomposing them into client-orchestrated CRUD would leak invariants (a terminated franchisee with open outlets; a transferred outlet whose territory still belongs to the old owner). Keeping them atomic on the server is the main reason this blueprint has actions at all.

6. **Default weekly sales reporting cadence, with `periodType` on SalesReport.** The schema accepts both `weekly` and `monthly` so monthly rollups don't require a schema change. Flagged in Open Questions for confirmation.

7. **`moduleProgress` as a dictionary keyed by module key.** Modules have stable keys; checking "has user finished module X" is O(1) and doesn't require array scans. `acknowledgements` on Announcement uses the same pattern keyed by user ID.

8. **`User` hierarchy captures the three actor types.** The discriminator lets queries like "all staff of franchisee X" or "all franchisor admins" run against the top-level `User` collection without union logic, while subclasses carry the role/ownership fields that differ. AuthN/Z itself is out of scope; this only models the data shape.

---

## Open questions

- **Sales reporting cadence.** Blueprint defaults to weekly with optional monthly rollup. Confirm whether the franchisor expects weekly as the exclusive cadence, or mixed (some franchisees monthly, others weekly).
- **Fee calculation vs recording.** Is "record only" final, or will a `FeeSchedule` (percent rates, flat amounts, due-day rules) be needed later? The schema is forward-compatible either way but the action surface would grow.
- **Currency handling.** The model carries a `currency` string per monetary record but assumes no FX conversion. Confirm whether multi-currency reporting needs a normalized `amountInBaseCurrency` companion field.
- **Master franchisee sub-licensing constraints.** The blueprint models `parentFranchiseeId` on Franchisee and `assignedAsMaster` on Territory but does not enforce "a sub-licensed franchisee's territory must lie within the master's territory." Should this be an invariant enforced by `assignTerritory`, or left as a business-process concern outside the system?
- **Document storage.** The schema holds `fileUrl` strings but does not prescribe the storage backend. Confirm whether bootstrapp.cloud's file hosting is used or an external object store (S3, etc.) with signed URLs.
- **Scheduled / cron actions.** `computeOutletRiskFlags` and announcement publishing on `publishAt` imply scheduled execution. Confirm whether bootstrapp.cloud supports scheduled action invocation natively or whether an external scheduler will call these actions on a cadence.
- **Full-text search across documents and tickets.** Not modeled. If search across document bodies or ticket transcripts is required, that exceeds the filter/query model and would need an external search index.agentId: a504310ebe8f434f2 (use SendMessage with to: 'a504310ebe8f434f2' to continue this agent)
<usage>total_tokens: 42115
tool_uses: 0
duration_ms: 294123</usage>