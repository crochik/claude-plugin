# Data Model Blueprint — Contact Management App

Draft v0.2 — 2026-04-21. Design-only. Intended for review before handoff to `bootstrapp-architect`.

### Changed in v0.2

- Added an **Actions** section introducing a polymorphic `Action` base with subclasses `SendEmailAction`, `SendSmsAction`, `MakeCallAction`, `ScheduleMeetingAction`, `AddToListAction`, `AddToPipelineStageAction`, and `BulkTagAction`.
- Introduced `ActionDelivery` (top-level, per-recipient fan-out) so bulk sends stay queryable per contact without exploding the parent `Action` into N documents.
- Introduced `MessageTemplate` (top-level) so email and SMS bodies can be authored once and reused; bodies may still be inline.
- Introduced `ActionTarget` (embedded) — a single field that can describe a target as contact IDs, a list, or a segment, with resolution mode (`snapshot` vs `live`).
- Added a lifecycle state machine on `Action` (`draft | scheduled | queued | running | partial | completed | failed | cancelled`) and on `ActionDelivery` (`pending | sending | sent | delivered | bounced | failed | skipped`).
- Added custom actions (the verb kind): `enqueueAction`, `cancelAction`, `retryActionDeliveries`, `previewActionTarget`, `markDeliveryOutcome`. Note: these are **bootstrapp actions** operating on the `Action` **class** — distinct from the `Action` *class hierarchy* which is a user-level concept modeled as data.
- Extended Embeddings, References, and Relations tables accordingly.
- Added open questions 12–16 covering provider identities, scheduling granularity, timeline fan-out, template variables, and per-recipient data limits.

## Overview

A CRM-style contact manager. Contacts are both **people** and **companies**, and they can link to each other (works-at, spouse-of, reports-to, subsidiary-of, etc.). Data is scoped to a **Workspace**; users join a workspace via **Membership**. Contacts carry rich multi-valued metadata (phones, emails, addresses, messaging handles, social profiles, tags, custom fields). Grouping happens via **static Lists** and **dynamic Segments**. A lightweight **Pipeline / Stage** model supports CRM-style progression. Activity history (notes, calls, meetings, emails, tasks, attachments) is modeled as a polymorphic `Activity` hierarchy. User-initiated outbound work (send email, send SMS, click-to-call, schedule meeting, bulk operations) is modeled as a polymorphic `Action` hierarchy with a per-recipient `ActionDelivery` join.

---

## Classes

### Workspace
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "_id": { "type": "string" },
      "name": { "type": "string" },
      "slug": { "type": "string" },
      "createdAt": { "type": "string", "format": "date-time" },
      "ownerUserId": { "type": "string" },
      "customFieldDefs": {
        "type": "array",
        "items": { "$ref": "#/definitions/CustomFieldDef" }
      }
    },
    "required": ["_id", "name", "ownerUserId"]
  }
  ```
- **Notes:** The tenancy boundary. All contacts, lists, pipelines, and activities live inside exactly one workspace. Holds the **custom field schema** (definitions) so every Contact can reuse the same catalogue of custom fields.

### User
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "_id": { "type": "string" },
      "email": { "type": "string", "format": "email" },
      "displayName": { "type": "string" },
      "createdAt": { "type": "string", "format": "date-time" }
    },
    "required": ["_id", "email"]
  }
  ```
- **Notes:** A global identity independent of any one workspace (users can belong to multiple workspaces via Memberships).

### Membership
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "_id": { "type": "string" },
      "workspaceId": { "type": "string" },
      "userId": { "type": "string" },
      "role": { "type": "string", "enum": ["owner", "admin", "member", "viewer"] },
      "joinedAt": { "type": "string", "format": "date-time" }
    },
    "required": ["_id", "workspaceId", "userId", "role"]
  }
  ```
- **Notes:** Join object between `User` and `Workspace`. Role drives coarse permissions. Making this top-level (rather than embedded in Workspace) keeps the list of workspaces per user queryable.

### Contact (abstract base)
- **Level:** top-level
- **Extends:** none (this is the base)
- **Discriminator:** `kind` with literals `"person"` | `"company"`
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "_id": { "type": "string" },
      "workspaceId": { "type": "string" },
      "kind": { "type": "string", "enum": ["person", "company"] },
      "displayName": { "type": "string" },
      "ownerUserId": { "type": "string" },
      "assigneeUserId": { "type": "string" },
      "visibility": { "type": "string", "enum": ["workspace", "private", "shared"] },
      "sharedWithUserIds": { "type": "array", "items": { "type": "string" } },
      "tags": { "type": "array", "items": { "type": "string" } },
      "phones": { "type": "array", "items": { "$ref": "#/definitions/PhoneNumber" } },
      "emails": { "type": "array", "items": { "$ref": "#/definitions/EmailAddress" } },
      "addresses": { "type": "array", "items": { "$ref": "#/definitions/PostalAddress" } },
      "messagingHandles": { "type": "array", "items": { "$ref": "#/definitions/MessagingHandle" } },
      "socialProfiles": { "type": "array", "items": { "$ref": "#/definitions/SocialProfile" } },
      "customFields": {
        "type": "object",
        "additionalProperties": { "$ref": "#/definitions/CustomFieldValue" }
      },
      "externalIdentities": { "type": "array", "items": { "$ref": "#/definitions/ExternalIdentity" } },
      "createdAt": { "type": "string", "format": "date-time" },
      "updatedAt": { "type": "string", "format": "date-time" }
    },
    "required": ["_id", "workspaceId", "kind", "displayName", "ownerUserId"]
  }
  ```
- **Notes:** The single collection that holds both people and companies. `displayName` is the canonical searchable label ("Jane Doe" or "Acme, Inc."). All shared multi-valued metadata lives here so Person↔Company interop (search, linking, activities) is uniform.

### Person
- **Level:** top-level
- **Extends:** Contact (discriminator: `kind` = `"person"`)
- **JSON Schema (adds to Contact):**
  ```json
  {
    "type": "object",
    "properties": {
      "firstName": { "type": "string" },
      "lastName": { "type": "string" },
      "middleName": { "type": "string" },
      "prefix": { "type": "string" },
      "suffix": { "type": "string" },
      "nickname": { "type": "string" },
      "jobTitle": { "type": "string" },
      "primaryCompanyId": { "type": "string" },
      "birthday": { "type": "string", "format": "date" },
      "pronouns": { "type": "string" }
    }
  }
  ```
- **Notes:** `primaryCompanyId` is a cached convenience reference to the person's main employer (a `Contact` of kind `company`). Richer employment history lives in `ContactLink` relations.

### Company
- **Level:** top-level
- **Extends:** Contact (discriminator: `kind` = `"company"`)
- **JSON Schema (adds to Contact):**
  ```json
  {
    "type": "object",
    "properties": {
      "legalName": { "type": "string" },
      "website": { "type": "string", "format": "uri" },
      "industry": { "type": "string" },
      "sizeBucket": { "type": "string", "enum": ["1-10","11-50","51-200","201-1000","1000+"] },
      "foundedYear": { "type": "integer" },
      "parentCompanyId": { "type": "string" }
    }
  }
  ```
- **Notes:** `parentCompanyId` is a convenience shortcut for subsidiary-of; multi-parent or historical org structure belongs in `ContactLink`.

### PhoneNumber (embedded)
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "label": { "type": "string", "enum": ["work","mobile","home","other"] },
      "e164": { "type": "string" },
      "raw": { "type": "string" },
      "primary": { "type": "boolean" },
      "verifiedAt": { "type": "string", "format": "date-time" }
    },
    "required": ["raw"]
  }
  ```

### EmailAddress (embedded)
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "label": { "type": "string", "enum": ["work","personal","other"] },
      "address": { "type": "string", "format": "email" },
      "primary": { "type": "boolean" },
      "verifiedAt": { "type": "string", "format": "date-time" }
    },
    "required": ["address"]
  }
  ```

### PostalAddress (embedded)
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "label": { "type": "string", "enum": ["work","home","billing","shipping","other"] },
      "line1": { "type": "string" },
      "line2": { "type": "string" },
      "city": { "type": "string" },
      "region": { "type": "string" },
      "postalCode": { "type": "string" },
      "country": { "type": "string" },
      "primary": { "type": "boolean" }
    }
  }
  ```

### MessagingHandle (embedded)
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "platform": { "type": "string", "enum": ["slack","whatsapp","signal","telegram","x","other"] },
      "handle": { "type": "string" },
      "label": { "type": "string" },
      "primary": { "type": "boolean" }
    },
    "required": ["platform", "handle"]
  }
  ```

### SocialProfile (embedded)
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "platform": { "type": "string", "enum": ["linkedin","github","facebook","instagram","youtube","other"] },
      "url": { "type": "string", "format": "uri" },
      "handle": { "type": "string" },
      "label": { "type": "string" }
    },
    "required": ["platform"]
  }
  ```

### CustomFieldDef (embedded, in Workspace)
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "key": { "type": "string" },
      "label": { "type": "string" },
      "type": { "type": "string", "enum": ["string","number","boolean","date","enum","url"] },
      "options": { "type": "array", "items": { "type": "string" } },
      "appliesTo": { "type": "string", "enum": ["person","company","both"] }
    },
    "required": ["key","label","type","appliesTo"]
  }
  ```

### CustomFieldValue (embedded, in Contact)
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "stringValue": { "type": "string" },
      "numberValue": { "type": "number" },
      "booleanValue": { "type": "boolean" },
      "dateValue": { "type": "string", "format": "date-time" }
    }
  }
  ```
- **Notes:** Stored as a **dictionary** on `Contact.customFields` keyed by the `CustomFieldDef.key`. Kept as typed-slot record to avoid a true union.

### ExternalIdentity (embedded)
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "source": { "type": "string" },
      "externalId": { "type": "string" },
      "url": { "type": "string", "format": "uri" },
      "importedAt": { "type": "string", "format": "date-time" }
    },
    "required": ["source","externalId"]
  }
  ```
- **Notes:** Future-proofs external imports (Google Contacts, iCloud, HubSpot, etc.) without a schema migration. Empty array today.

### ContactLink
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "_id": { "type": "string" },
      "workspaceId": { "type": "string" },
      "fromContactId": { "type": "string" },
      "toContactId": { "type": "string" },
      "type": { "type": "string", "enum": [
        "works_at","reports_to","manages","spouse_of","parent_of","child_of","sibling_of",
        "friend_of","subsidiary_of","partner_of","vendor_of","customer_of","other"
      ] },
      "title": { "type": "string" },
      "startedAt": { "type": "string", "format": "date" },
      "endedAt": { "type": "string", "format": "date" },
      "note": { "type": "string" }
    },
    "required": ["_id","workspaceId","fromContactId","toContactId","type"]
  }
  ```
- **Notes:** Top-level so it can be queried both directions, carry its own temporal data (start/end), and support any Contact↔Contact (Person↔Person, Person↔Company, Company↔Company) with a single collection. Directionality is captured in `type` (e.g. `reports_to` is directional; `spouse_of` is symmetric — UI will add the reverse row or render both ends).

### List
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "_id": { "type": "string" },
      "workspaceId": { "type": "string" },
      "name": { "type": "string" },
      "description": { "type": "string" },
      "color": { "type": "string" },
      "createdByUserId": { "type": "string" },
      "createdAt": { "type": "string", "format": "date-time" }
    },
    "required": ["_id","workspaceId","name"]
  }
  ```
- **Notes:** A **static** collection of contacts. Membership is stored in `ListMembership` (not as an array on the list) so lists can grow arbitrarily and memberships can be queried from the contact side.

### ListMembership
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "_id": { "type": "string" },
      "workspaceId": { "type": "string" },
      "listId": { "type": "string" },
      "contactId": { "type": "string" },
      "addedByUserId": { "type": "string" },
      "addedAt": { "type": "string", "format": "date-time" }
    },
    "required": ["_id","workspaceId","listId","contactId"]
  }
  ```

### Segment
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "_id": { "type": "string" },
      "workspaceId": { "type": "string" },
      "name": { "type": "string" },
      "description": { "type": "string" },
      "query": { "$ref": "#/definitions/SegmentQuery" },
      "createdByUserId": { "type": "string" },
      "createdAt": { "type": "string", "format": "date-time" }
    },
    "required": ["_id","workspaceId","name","query"]
  }
  ```
- **Notes:** A **dynamic** group — resolved by evaluating `query` against Contacts at read time. No materialized membership stored.

### SegmentQuery (embedded)
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "match": { "type": "string", "enum": ["all","any"] },
      "filters": {
        "type": "array",
        "items": { "$ref": "#/definitions/SegmentFilter" }
      }
    },
    "required": ["match","filters"]
  }
  ```

### SegmentFilter (embedded)
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "field": { "type": "string" },
      "op": { "type": "string", "enum": ["eq","neq","in","nin","contains","startsWith","exists","gt","gte","lt","lte","between"] },
      "value": {}
    },
    "required": ["field","op"]
  }
  ```
- **Notes:** Flat AND/OR of leaf filters. Simple enough to cover v1 ("kind = person AND tag in [vip,prospect]"). If nesting is required later we can introduce a recursive `SegmentQueryNode`; see Open Questions.

### Pipeline
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "_id": { "type": "string" },
      "workspaceId": { "type": "string" },
      "name": { "type": "string" },
      "description": { "type": "string" },
      "stages": {
        "type": "array",
        "items": { "$ref": "#/definitions/PipelineStage" }
      },
      "createdAt": { "type": "string", "format": "date-time" }
    },
    "required": ["_id","workspaceId","name","stages"]
  }
  ```
- **Notes:** Stages are embedded as an ordered array. Reordering is a whole-document rewrite of `stages` — acceptable because stage counts are small (typically < 20).

### PipelineStage (embedded)
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "key": { "type": "string" },
      "name": { "type": "string" },
      "order": { "type": "integer" },
      "color": { "type": "string" },
      "closed": { "type": "boolean" },
      "won": { "type": "boolean" }
    },
    "required": ["key","name","order"]
  }
  ```

### PipelineEntry
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "_id": { "type": "string" },
      "workspaceId": { "type": "string" },
      "pipelineId": { "type": "string" },
      "stageKey": { "type": "string" },
      "contactId": { "type": "string" },
      "enteredStageAt": { "type": "string", "format": "date-time" },
      "value": { "type": "number" },
      "currency": { "type": "string" },
      "ownerUserId": { "type": "string" },
      "status": { "type": "string", "enum": ["open","won","lost","abandoned"] },
      "closedAt": { "type": "string", "format": "date-time" }
    },
    "required": ["_id","workspaceId","pipelineId","stageKey","contactId","status"]
  }
  ```
- **Notes:** A contact's presence in a pipeline stage. A contact can appear in multiple pipelines simultaneously; each gets its own `PipelineEntry`. Keeps stage history queryable (see Activity for stage-changed events).

### Activity (abstract base)
- **Level:** top-level
- **Extends:** none (base)
- **Discriminator:** `type` with literals `"note" | "call" | "meeting" | "email_log" | "task" | "attachment" | "stage_changed"`
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "_id": { "type": "string" },
      "workspaceId": { "type": "string" },
      "type": { "type": "string" },
      "contactIds": { "type": "array", "items": { "type": "string" } },
      "pipelineEntryId": { "type": "string" },
      "authorUserId": { "type": "string" },
      "occurredAt": { "type": "string", "format": "date-time" },
      "createdAt": { "type": "string", "format": "date-time" },
      "body": { "type": "string" },
      "sourceActionId": { "type": "string" },
      "sourceActionDeliveryId": { "type": "string" }
    },
    "required": ["_id","workspaceId","type","authorUserId","contactIds","occurredAt"]
  }
  ```
- **Notes:** `contactIds` is an array so one activity (e.g. a meeting) can attach to multiple contacts. `body` is a shared optional free-text field; subclasses add structure on top. `sourceActionId` / `sourceActionDeliveryId` are new in v0.2: set when the activity was auto-generated by a completed `Action` (e.g. an `EmailLog` produced by a `SendEmailAction` delivery), so the timeline can link back to the originating command.

### Note
- **Level:** top-level
- **Extends:** Activity (discriminator: `type` = `"note"`)
- **Adds:**
  ```json
  {
    "properties": {
      "pinned": { "type": "boolean" }
    }
  }
  ```

### Call
- **Level:** top-level
- **Extends:** Activity (discriminator: `type` = `"call"`)
- **Adds:**
  ```json
  {
    "properties": {
      "direction": { "type": "string", "enum": ["inbound","outbound"] },
      "durationSec": { "type": "integer" },
      "outcome": { "type": "string", "enum": ["connected","voicemail","no_answer","busy","failed"] },
      "phoneUsed": { "type": "string" }
    }
  }
  ```

### Meeting
- **Level:** top-level
- **Extends:** Activity (discriminator: `type` = `"meeting"`)
- **Adds:**
  ```json
  {
    "properties": {
      "title": { "type": "string" },
      "location": { "type": "string" },
      "startAt": { "type": "string", "format": "date-time" },
      "endAt": { "type": "string", "format": "date-time" },
      "attendeeUserIds": { "type": "array", "items": { "type": "string" } },
      "attendeeContactIds": { "type": "array", "items": { "type": "string" } }
    }
  }
  ```

### EmailLog
- **Level:** top-level
- **Extends:** Activity (discriminator: `type` = `"email_log"`)
- **Adds:**
  ```json
  {
    "properties": {
      "direction": { "type": "string", "enum": ["inbound","outbound"] },
      "subject": { "type": "string" },
      "fromAddress": { "type": "string" },
      "toAddresses": { "type": "array", "items": { "type": "string" } },
      "ccAddresses": { "type": "array", "items": { "type": "string" } },
      "messageId": { "type": "string" },
      "threadId": { "type": "string" }
    }
  }
  ```
- **Notes:** A record of an email that happened. Not an outbox — no send semantics. For the outbound intent and lifecycle, see `SendEmailAction` / `ActionDelivery`.

### Task
- **Level:** top-level
- **Extends:** Activity (discriminator: `type` = `"task"`)
- **Adds:**
  ```json
  {
    "properties": {
      "title": { "type": "string" },
      "dueAt": { "type": "string", "format": "date-time" },
      "assigneeUserId": { "type": "string" },
      "status": { "type": "string", "enum": ["open","in_progress","done","cancelled"] },
      "priority": { "type": "string", "enum": ["low","normal","high","urgent"] }
    }
  }
  ```

### Attachment
- **Level:** top-level
- **Extends:** Activity (discriminator: `type` = `"attachment"`)
- **Adds:**
  ```json
  {
    "properties": {
      "fileName": { "type": "string" },
      "mimeType": { "type": "string" },
      "sizeBytes": { "type": "integer" },
      "storageUrl": { "type": "string", "format": "uri" },
      "caption": { "type": "string" }
    }
  }
  ```

### StageChanged
- **Level:** top-level
- **Extends:** Activity (discriminator: `type` = `"stage_changed"`)
- **Adds:**
  ```json
  {
    "properties": {
      "pipelineId": { "type": "string" },
      "fromStageKey": { "type": "string" },
      "toStageKey": { "type": "string" }
    }
  }
  ```
- **Notes:** Auto-generated by the app when a `PipelineEntry.stageKey` moves, so stage history is part of the same timeline as notes and calls.

---

## Actions

The **Action hierarchy** models user-initiated outbound work with a lifecycle — as opposed to `Activity`, which records things that already happened. A user says "send this email to 250 contacts next Tuesday at 9 a.m. Pacific" and the system captures that intent as one `Action` document plus (at enqueue time) N `ActionDelivery` rows, one per contact. Actions can target a single contact, a list of contacts, a static `List`, or a dynamic `Segment`. When a delivery completes successfully, it also writes the matching retrospective `Activity` (e.g. `EmailLog`) to the contact's timeline, linked back via `sourceActionId`.

Terminology note: *`Action` (the class hierarchy defined here)* is a user-facing data type. It is distinct from *bootstrapp-actions* (named server-side verbs) — the latter appear in the "Action verbs (bootstrapp actions)" subsection below.

### Action (abstract base)
- **Level:** top-level
- **Extends:** none (base)
- **Discriminator:** `kind` with literals `"send_email" | "send_sms" | "make_call" | "schedule_meeting" | "add_to_list" | "add_to_pipeline_stage" | "bulk_tag"`
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "_id": { "type": "string" },
      "workspaceId": { "type": "string" },
      "kind": { "type": "string" },
      "initiatedByUserId": { "type": "string" },
      "status": {
        "type": "string",
        "enum": ["draft","scheduled","queued","running","partial","completed","failed","cancelled"]
      },
      "target": { "$ref": "#/definitions/ActionTarget" },
      "recipientCount": { "type": "integer" },
      "scheduledFor": { "type": "string", "format": "date-time" },
      "timezone": { "type": "string" },
      "createdAt": { "type": "string", "format": "date-time" },
      "updatedAt": { "type": "string", "format": "date-time" },
      "startedAt": { "type": "string", "format": "date-time" },
      "completedAt": { "type": "string", "format": "date-time" },
      "cancelledAt": { "type": "string", "format": "date-time" },
      "cancelledByUserId": { "type": "string" },
      "failureReason": { "type": "string" },
      "stats": { "$ref": "#/definitions/ActionStats" },
      "relatedPipelineEntryId": { "type": "string" },
      "idempotencyKey": { "type": "string" }
    },
    "required": ["_id","workspaceId","kind","initiatedByUserId","status","target","createdAt"]
  }
  ```
- **Notes:** One document per user intent, regardless of fan-out. `recipientCount` and `stats` are denormalized summaries updated as `ActionDelivery` rows settle. `scheduledFor` + `timezone` together express "send at local 9 a.m." The lifecycle states are a superset of per-delivery states and represent the **rollup** of all deliveries (see state model below). `idempotencyKey` lets clients retry `enqueueAction` safely.

### SendEmailAction
- **Level:** top-level
- **Extends:** Action (discriminator: `kind` = `"send_email"`)
- **Adds:**
  ```json
  {
    "properties": {
      "fromIdentity": { "$ref": "#/definitions/SenderIdentity" },
      "replyToAddress": { "type": "string", "format": "email" },
      "subject": { "type": "string" },
      "bodyHtml": { "type": "string" },
      "bodyText": { "type": "string" },
      "templateId": { "type": "string" },
      "templateVariables": {
        "type": "object",
        "additionalProperties": { "type": ["string","number","boolean","null"] }
      },
      "attachments": {
        "type": "array",
        "items": { "$ref": "#/definitions/ActionAttachment" }
      },
      "trackOpens": { "type": "boolean" },
      "trackClicks": { "type": "boolean" }
    }
  }
  ```
- **Notes:** Either `templateId` **or** inline `subject`+`body*` must be supplied (validated in `enqueueAction`, not in schema). Per-contact resolution (to-address, personalization merge) happens at delivery time; the chosen to-address is frozen onto the `ActionDelivery`.

### SendSmsAction
- **Level:** top-level
- **Extends:** Action (discriminator: `kind` = `"send_sms"`)
- **Adds:**
  ```json
  {
    "properties": {
      "fromIdentity": { "$ref": "#/definitions/SenderIdentity" },
      "body": { "type": "string" },
      "templateId": { "type": "string" },
      "templateVariables": {
        "type": "object",
        "additionalProperties": { "type": ["string","number","boolean","null"] }
      },
      "mediaUrls": { "type": "array", "items": { "type": "string", "format": "uri" } }
    }
  }
  ```
- **Notes:** `mediaUrls` enables MMS. Per-recipient phone resolution happens at delivery time; the chosen e164 number is frozen onto the `ActionDelivery`.

### MakeCallAction
- **Level:** top-level
- **Extends:** Action (discriminator: `kind` = `"make_call"`)
- **Adds:**
  ```json
  {
    "properties": {
      "fromIdentity": { "$ref": "#/definitions/SenderIdentity" },
      "mode": { "type": "string", "enum": ["click_to_call","voip_dial","tel_link"] },
      "script": { "type": "string" }
    }
  }
  ```
- **Notes:** Represents the **intent** to place a call. Typically single-target; bulk targeting is allowed but discouraged. On success (the user actually connects), the resulting `Call` activity is written by `markDeliveryOutcome` — see the Activity relationship section.

### ScheduleMeetingAction
- **Level:** top-level
- **Extends:** Action (discriminator: `kind` = `"schedule_meeting"`)
- **Adds:**
  ```json
  {
    "properties": {
      "title": { "type": "string" },
      "location": { "type": "string" },
      "videoUrl": { "type": "string", "format": "uri" },
      "startAt": { "type": "string", "format": "date-time" },
      "endAt": { "type": "string", "format": "date-time" },
      "description": { "type": "string" },
      "organizerUserId": { "type": "string" },
      "sendInvites": { "type": "boolean" }
    }
  }
  ```
- **Notes:** Creates a calendar invite (via the user's connected calendar) and optionally emails invites. On completion, generates a `Meeting` activity per target contact.

### AddToListAction
- **Level:** top-level
- **Extends:** Action (discriminator: `kind` = `"add_to_list"`)
- **Adds:**
  ```json
  {
    "properties": {
      "listId": { "type": "string" },
      "removeInstead": { "type": "boolean" }
    }
  }
  ```
- **Notes:** A bulk membership operation. Usually instant (no external provider), but modeled as an Action so bulk removals / undo / audit trail are uniform. `removeInstead: true` turns it into a bulk remove.

### AddToPipelineStageAction
- **Level:** top-level
- **Extends:** Action (discriminator: `kind` = `"add_to_pipeline_stage"`)
- **Adds:**
  ```json
  {
    "properties": {
      "pipelineId": { "type": "string" },
      "stageKey": { "type": "string" },
      "value": { "type": "number" },
      "currency": { "type": "string" }
    }
  }
  ```
- **Notes:** Creates or updates a `PipelineEntry` per target contact and emits a `StageChanged` activity when a move occurs.

### BulkTagAction
- **Level:** top-level
- **Extends:** Action (discriminator: `kind` = `"bulk_tag"`)
- **Adds:**
  ```json
  {
    "properties": {
      "tagsToAdd": { "type": "array", "items": { "type": "string" } },
      "tagsToRemove": { "type": "array", "items": { "type": "string" } }
    }
  }
  ```
- **Notes:** Adds/removes tags on every target contact. Both arrays are optional; at least one must be non-empty (validated in action verb).

### ActionTarget (embedded)
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "mode": { "type": "string", "enum": ["contacts","list","segment"] },
      "contactIds": { "type": "array", "items": { "type": "string" } },
      "listId": { "type": "string" },
      "segmentId": { "type": "string" },
      "resolution": { "type": "string", "enum": ["snapshot","live"] },
      "excludeContactIds": { "type": "array", "items": { "type": "string" } }
    },
    "required": ["mode","resolution"]
  }
  ```
- **Notes:** Single embedded field on `Action.target` describing what to send to. `resolution: "snapshot"` freezes the recipient set at enqueue time (creating `ActionDelivery` rows immediately); `resolution: "live"` defers resolution to execution time (recomputes from the `Segment` query at `scheduledFor`). **v1 default: `snapshot`** — it makes per-recipient status queryable the instant the action is enqueued, and it prevents surprise fan-out changes when a segment definition moves underneath a scheduled send. `excludeContactIds` supports "send to Segment except these".

### ActionStats (embedded)
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "pending": { "type": "integer" },
      "sending": { "type": "integer" },
      "sent": { "type": "integer" },
      "delivered": { "type": "integer" },
      "bounced": { "type": "integer" },
      "failed": { "type": "integer" },
      "skipped": { "type": "integer" },
      "opened": { "type": "integer" },
      "clicked": { "type": "integer" }
    }
  }
  ```
- **Notes:** Counters maintained by the delivery worker as `ActionDelivery` rows settle. Updated atomically; lets the UI show "237 / 500 sent, 3 bounced" without scanning deliveries on every render.

### SenderIdentity (embedded)
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "type": { "type": "string", "enum": ["email_address","sms_number","calling_number"] },
      "address": { "type": "string" },
      "displayName": { "type": "string" },
      "providerAccountId": { "type": "string" }
    },
    "required": ["type","address"]
  }
  ```
- **Notes:** Captures "who the send is from" without hard-coding a provider model. `providerAccountId` is an opaque string meaningful to the integration layer (e.g. a Twilio subaccount id). Kept embedded and denormalized so historic sends remain readable if provider accounts are later rotated.

### ActionAttachment (embedded)
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "fileName": { "type": "string" },
      "mimeType": { "type": "string" },
      "sizeBytes": { "type": "integer" },
      "storageUrl": { "type": "string", "format": "uri" },
      "inline": { "type": "boolean" }
    },
    "required": ["fileName","storageUrl"]
  }
  ```
- **Notes:** Distinct from the `Attachment` activity — this is an attachment **on an outbound email**, not a file attached to a contact's timeline.

### ActionDelivery
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "_id": { "type": "string" },
      "workspaceId": { "type": "string" },
      "actionId": { "type": "string" },
      "actionKind": { "type": "string" },
      "contactId": { "type": "string" },
      "resolvedAddress": { "type": "string" },
      "status": {
        "type": "string",
        "enum": ["pending","sending","sent","delivered","bounced","failed","skipped"]
      },
      "attemptCount": { "type": "integer" },
      "lastAttemptAt": { "type": "string", "format": "date-time" },
      "sentAt": { "type": "string", "format": "date-time" },
      "deliveredAt": { "type": "string", "format": "date-time" },
      "openedAt": { "type": "string", "format": "date-time" },
      "clickedAt": { "type": "string", "format": "date-time" },
      "failureReason": { "type": "string" },
      "providerMessageId": { "type": "string" },
      "providerStatus": { "type": "string" },
      "generatedActivityId": { "type": "string" },
      "createdAt": { "type": "string", "format": "date-time" },
      "updatedAt": { "type": "string", "format": "date-time" }
    },
    "required": ["_id","workspaceId","actionId","actionKind","contactId","status","createdAt"]
  }
  ```
- **Notes:** One row per recipient per action. Carries per-recipient lifecycle, retry bookkeeping, and the id of the generated timeline `Activity` (if any). `resolvedAddress` is the email / phone / etc. chosen at enqueue time — frozen for audit and idempotency. `actionKind` is denormalized from the parent `Action.kind` so a single query can filter "all failed SMS deliveries" without a join. Top-level (not embedded in Action) because per-recipient fan-out of 10k+ would blow the parent document size, and because we want per-contact delivery queries ("what did we send to Jane?").

### MessageTemplate
- **Level:** top-level
- **Extends:** none
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "_id": { "type": "string" },
      "workspaceId": { "type": "string" },
      "name": { "type": "string" },
      "channel": { "type": "string", "enum": ["email","sms"] },
      "subject": { "type": "string" },
      "bodyHtml": { "type": "string" },
      "bodyText": { "type": "string" },
      "smsBody": { "type": "string" },
      "variables": {
        "type": "array",
        "items": { "$ref": "#/definitions/TemplateVariable" }
      },
      "createdByUserId": { "type": "string" },
      "createdAt": { "type": "string", "format": "date-time" },
      "updatedAt": { "type": "string", "format": "date-time" },
      "archived": { "type": "boolean" }
    },
    "required": ["_id","workspaceId","name","channel","createdByUserId"]
  }
  ```
- **Notes:** Reusable email or SMS body. `subject` / `bodyHtml` / `bodyText` apply when `channel = "email"`; `smsBody` applies when `channel = "sms"`. **Recommendation for v1: introduce `MessageTemplate` but keep inline bodies as the primary path.** Templates are cheap to add and the moment a user sends the same email twice they will want them, but inline bodies must work so one-off sends don't force template creation.

### TemplateVariable (embedded)
- **Level:** embedded
- **JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "key": { "type": "string" },
      "label": { "type": "string" },
      "required": { "type": "boolean" },
      "defaultValue": { "type": "string" },
      "source": { "type": "string", "enum": ["contact_field","custom_field","input"] },
      "contactFieldPath": { "type": "string" }
    },
    "required": ["key"]
  }
  ```
- **Notes:** Declares a merge variable. `source: "contact_field"` with `contactFieldPath: "firstName"` auto-binds from the recipient contact; `source: "input"` expects the value in `Action.templateVariables`.

### Action lifecycle / state model

**Per-delivery state machine (`ActionDelivery.status`):**

```
pending -> sending -> sent -> delivered
                       |        |
                       |        +--> opened (email only, side-channel event, not a status)
                       v
                    failed / bounced
pending -> skipped  (e.g. no email on file, do-not-contact flag)
```

- `pending` — row exists, not yet dispatched.
- `sending` — worker has picked it up, provider call in flight.
- `sent` — provider accepted it.
- `delivered` — provider reported delivery (may equal `sent` for SMS).
- `bounced` / `failed` — terminal error states; `failureReason` populated.
- `skipped` — terminal; the recipient was not eligible (no address, opt-out).
- `opened` / `clicked` are **events** tracked on the delivery, not status values.

**Parent rollup (`Action.status`):**

- `draft` — not yet enqueued (user is editing).
- `scheduled` — enqueued with `scheduledFor` in the future.
- `queued` — enqueued, ready to run now.
- `running` — at least one delivery is `sending`.
- `partial` — all deliveries settled, some succeeded and some failed.
- `completed` — all deliveries succeeded (or were skipped with reason).
- `failed` — all deliveries failed, or the action itself errored before dispatch.
- `cancelled` — user cancelled before or during execution; any in-flight deliveries finish or are marked `skipped`.

**One shared machine on the base, not per-subclass.** Every subclass obeys the same lifecycle; variants only differ in what "sending" means (SMTP vs Twilio vs inserting a `ListMembership` row). Per-subclass states would duplicate state-machine UI code for no semantic gain.

**Retry semantics.** `ActionDelivery.attemptCount` increments on each retry; the dispatcher enforces a max (policy, not schema). Explicit retry is user-triggered via `retryActionDeliveries`; automatic retry is implementation-level.

### Relationship to Activity

When a delivery terminates successfully:

- `SendEmailAction` + delivery `sent`/`delivered` → writes an `EmailLog` activity per contact, with `direction = "outbound"`, `sourceActionId = action._id`, `sourceActionDeliveryId = delivery._id`. Delivery stores the resulting `generatedActivityId`.
- `SendSmsAction` + delivery `sent` → writes… nothing new. SMS does not currently have an Activity subclass; see open question 14. For v1 **recommendation: add a `SmsLog` Activity subclass** (symmetric to `EmailLog`) so the timeline is complete. (Not added to the schema in this pass — flagged as an open question.)
- `MakeCallAction` + delivery `sent` (user connected) → writes a `Call` activity.
- `ScheduleMeetingAction` + delivery `sent` → writes a `Meeting` activity.
- `AddToListAction` → writes the `ListMembership` row; no Activity (membership changes are not timeline-worthy by default).
- `AddToPipelineStageAction` → writes `PipelineEntry` + `StageChanged` activity (via existing mechanism).
- `BulkTagAction` → updates `Contact.tags`; no Activity.

**Recommendation: Action and Activity stay as two separate hierarchies.** The timeline renders `Activity` documents; the outbox / history UI renders `Action` documents. Actions are not placed in the timeline directly because (a) draft/scheduled actions should not appear in history, (b) bulk actions would flood the timeline, and (c) the per-recipient log entry (Activity) is what the user expects to see on a contact's page. The `sourceActionId` back-link on Activity means "click through to the originating action" is one hop away.

### Targeting model

`ActionTarget.mode` determines how recipients are resolved:

- `contacts` — explicit array of contact IDs. Used for ad-hoc sends ("email these three people").
- `list` — points to a `List._id`. Recipients are resolved by reading current `ListMembership` rows.
- `segment` — points to a `Segment._id`. Recipients are resolved by evaluating the segment query.

`ActionTarget.resolution` controls when resolution happens:

- `snapshot` (**v1 default**) — resolve immediately at `enqueueAction` time, materialize N `ActionDelivery` rows, freeze the recipient set. Scheduled sends go out to exactly the snapshot, not to whoever now matches the segment. Per-recipient status is queryable from the moment the action is enqueued.
- `live` — defer resolution to `scheduledFor`. `ActionDelivery` rows are created at dispatch time. Used sparingly; relevant for recurring segment-based campaigns where staleness is the point.

### Bulk / campaign grouping

One `Action` + N `ActionDelivery` rows — **not** N `SendEmailAction` rows, **not** one `Campaign` parent over `Action` children. Rationale:

- One `Action` per user intent keeps the campaign UI simple ("your 500-recipient send") and keeps cancel / retry / stats at the intent level.
- Per-recipient `ActionDelivery` keeps per-contact status queryable without scanning all actions ("what have we sent to Jane Doe?"), supports idempotent retries per recipient, and bounds document size (the parent stays small even for a 50k-recipient send).
- A separate `Campaign` parent would only matter if we needed N-step sequences (email 1 → wait 3 days → email 2). **That is v2.** For v1, one intent = one `Action`.

### Templates

**Recommendation: introduce `MessageTemplate` in v1, but keep inline bodies as the primary path.**

- Inline `subject` + `body*` on `SendEmailAction` (and `body` on `SendSmsAction`) is always allowed — so one-off sends don't force users to create a template first.
- `templateId` is an alternative to inline. When set, the dispatcher resolves the template at delivery time, merges `templateVariables` (plus per-contact contact-field values), and renders the final message.
- Templates are **referenced** from Actions, not copied. If a template is edited after a scheduled send is queued, the send uses the template as of dispatch time — acceptable for v1 (and makes "fix typo in template, resend" a natural operation). If that becomes surprising, we can snapshot the template body onto the `Action` at enqueue time.

### Scheduling

Two fields on the base: `scheduledFor` (UTC timestamp) and `timezone` (IANA tz string, e.g. `"America/Los_Angeles"`). Semantics:

- If `scheduledFor` is null and `status = draft` → user still editing.
- If `scheduledFor` is null and `status = queued` → send immediately.
- If `scheduledFor` is set → dispatch when `now >= scheduledFor`. `timezone` is stored so the UI can render "Tue 9 a.m. Pacific" back to the user even if they travel.

Recurring sends (daily digest, drip sequence) are **out of scope for v1**. If added later, a `RecurrenceRule` embedded field on `Action` is the natural extension.

### Permissions hook

Not enforced by schema (bootstrapp is declarative), but the action verbs below should check:

- **Any send action** (`SendEmail`, `SendSms`, `MakeCall`, `ScheduleMeeting`) — requires `Membership.role >= member`. `viewer` cannot send.
- **Bulk sends** — when `ActionTarget.mode` is `list` or `segment`, or `contactIds.length > N` (suggested N = 10), require `role >= admin`. This gates mass messaging to admins only in v1.
- **Cancellation** — the initiator (`initiatedByUserId`) or any `admin`/`owner` can cancel.
- **Cross-contact reads** during target resolution — must respect per-contact `visibility`; contacts that the initiator cannot see are excluded (with a `skipped` delivery and reason `"not_visible"` if they slipped in via a static list).

### Action verbs (bootstrapp actions)

These are the custom server-side verbs (distinct from auto-generated CRUD on every top-level class). The bootstrapp action target column refers to the **class** on which the verb operates.

#### enqueueAction
- **Target:** Action (operates on a specific Action instance, or creates one)
- **Request body JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "actionId": { "type": "string" },
      "draft": {
        "type": "object",
        "description": "Full Action subclass body if creating on the fly (no prior draft)."
      },
      "idempotencyKey": { "type": "string" }
    }
  }
  ```
- **Behavior:** Validates the Action (subject/body present or template resolvable; from-identity present; target non-empty), resolves recipients when `target.resolution = "snapshot"`, writes the `Action` (if created on the fly) plus N `ActionDelivery` rows in one atomic call, sets status to `scheduled` or `queued`, and stamps `recipientCount`. Enforces the bulk-send role gate. Idempotent on `idempotencyKey` to tolerate client retries. Reads: `Contact`, `List`, `ListMembership`, `Segment`, `MessageTemplate`, `Membership`. Writes: `Action`, `ActionDelivery`.

#### cancelAction
- **Target:** Action
- **Request body JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "actionId": { "type": "string" },
      "reason": { "type": "string" }
    },
    "required": ["actionId"]
  }
  ```
- **Behavior:** Marks the Action `cancelled`, marks all `pending` deliveries `skipped` with `failureReason = "cancelled"`, leaves already-sent deliveries untouched, stamps `cancelledAt` / `cancelledByUserId`. Invariants: only valid when current status is `draft | scheduled | queued | running | partial`; terminal actions cannot be cancelled. Reads: `Action`, `Membership`. Writes: `Action`, `ActionDelivery`.

#### retryActionDeliveries
- **Target:** Action
- **Request body JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "actionId": { "type": "string" },
      "deliveryIds": { "type": "array", "items": { "type": "string" } },
      "retryAll": { "type": "boolean" }
    },
    "required": ["actionId"]
  }
  ```
- **Behavior:** For the named `failed`/`bounced` deliveries (or all of them if `retryAll`), resets status to `pending`, increments `attemptCount`, clears `failureReason`. Recomputes `Action.status` from the rollup (e.g. `partial` → `running`). Reads: `Action`, `ActionDelivery`. Writes: `Action`, `ActionDelivery`.

#### previewActionTarget
- **Target:** system
- **Request body JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "workspaceId": { "type": "string" },
      "target": { "$ref": "#/definitions/ActionTarget" },
      "limit": { "type": "integer" }
    },
    "required": ["workspaceId","target"]
  }
  ```
- **Behavior:** Resolves the target without enqueuing anything and returns the matching contact IDs (up to `limit`) plus the total count, with per-contact eligibility flags (has email? has phone? opted out?). Lets the UI show "this will send to 237 contacts (12 have no email)". Read-only.

#### markDeliveryOutcome
- **Target:** ActionDelivery
- **Request body JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "deliveryId": { "type": "string" },
      "status": {
        "type": "string",
        "enum": ["sending","sent","delivered","bounced","failed","skipped"]
      },
      "providerMessageId": { "type": "string" },
      "providerStatus": { "type": "string" },
      "failureReason": { "type": "string" },
      "occurredAt": { "type": "string", "format": "date-time" },
      "emitActivity": { "type": "boolean" }
    },
    "required": ["deliveryId","status"]
  }
  ```
- **Behavior:** Called by the dispatch worker (or provider webhook handler) to settle a delivery. Updates the `ActionDelivery`, atomically updates the parent `Action.stats`, recomputes `Action.status`, and — when `emitActivity` is true and status is a success state — creates the corresponding Activity (e.g. `EmailLog`) on the contact's timeline and records `generatedActivityId`. Invariant: status transitions must be monotonic (no going back from `sent` to `pending` except via `retryActionDeliveries`). Reads: `Action`, `ActionDelivery`, `Contact`. Writes: `ActionDelivery`, `Action`, `Activity`.

#### sendActionNow
- **Target:** Action
- **Request body JSON Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "actionId": { "type": "string" }
    },
    "required": ["actionId"]
  }
  ```
- **Behavior:** Convenience verb that flips a `scheduled` action to `queued` (clearing `scheduledFor`) so the dispatcher picks it up immediately. Invariant: only valid from `scheduled`. Reads/writes: `Action`.

(Standard CRUD and filter endpoints on every top-level class — including `Action`, `ActionDelivery`, and `MessageTemplate` — are auto-generated and are not listed here.)

---

## Embeddings

| Parent class | Field | Form | Embedded class |
|---|---|---|---|
| Workspace | customFieldDefs | array | CustomFieldDef |
| Contact (Person, Company) | phones | array | PhoneNumber |
| Contact | emails | array | EmailAddress |
| Contact | addresses | array | PostalAddress |
| Contact | messagingHandles | array | MessagingHandle |
| Contact | socialProfiles | array | SocialProfile |
| Contact | customFields | dictionary | CustomFieldValue |
| Contact | externalIdentities | array | ExternalIdentity |
| Segment | query | single | SegmentQuery |
| SegmentQuery | filters | array | SegmentFilter |
| Pipeline | stages | array | PipelineStage |
| Action | target | single | ActionTarget |
| Action | stats | single | ActionStats |
| SendEmailAction | fromIdentity | single | SenderIdentity |
| SendEmailAction | attachments | array | ActionAttachment |
| SendSmsAction | fromIdentity | single | SenderIdentity |
| MakeCallAction | fromIdentity | single | SenderIdentity |
| MessageTemplate | variables | array | TemplateVariable |

Rationale highlights (updated for v0.2):

- **Phones, emails, addresses, handles, socials** are embedded arrays on `Contact`: they have no independent identity, are always fetched with the contact, and are always written as part of a contact-level save.
- **Custom field values** are a dictionary keyed by the workspace's `CustomFieldDef.key`. This gives O(1) access by key and keeps the Contact document self-describing.
- **Tags** are a plain `array of string` on `Contact` (no embedded class). Tag definitions are implicit; if we later need per-tag color/description we promote `Tag` to a top-level class.
- **List membership, pipeline entries, contact links, activities, action deliveries** are all **top-level** (not embedded) because they must be queryable from either side and can grow unbounded.
- **Pipeline stages** are embedded because they are bounded, ordered, and conceptually part of the pipeline definition.
- **Action target, stats, sender identity, action attachments, template variables** are embedded because they have no independent identity and are always read/written with the containing Action or Template.

---

## References

| Class | Field | Points to |
|---|---|---|
| Workspace | ownerUserId | User._id |
| Membership | workspaceId | Workspace._id |
| Membership | userId | User._id |
| Contact | workspaceId | Workspace._id |
| Contact | ownerUserId | User._id |
| Contact | assigneeUserId | User._id |
| Contact | sharedWithUserIds[] | User._id |
| Person | primaryCompanyId | Contact._id (company) |
| Company | parentCompanyId | Contact._id (company) |
| ContactLink | workspaceId | Workspace._id |
| ContactLink | fromContactId | Contact._id |
| ContactLink | toContactId | Contact._id |
| List | workspaceId | Workspace._id |
| List | createdByUserId | User._id |
| ListMembership | workspaceId | Workspace._id |
| ListMembership | listId | List._id |
| ListMembership | contactId | Contact._id |
| ListMembership | addedByUserId | User._id |
| Segment | workspaceId | Workspace._id |
| Segment | createdByUserId | User._id |
| Pipeline | workspaceId | Workspace._id |
| PipelineEntry | workspaceId | Workspace._id |
| PipelineEntry | pipelineId | Pipeline._id |
| PipelineEntry | contactId | Contact._id |
| PipelineEntry | ownerUserId | User._id |
| Activity | workspaceId | Workspace._id |
| Activity | contactIds[] | Contact._id |
| Activity | authorUserId | User._id |
| Activity | pipelineEntryId | PipelineEntry._id |
| Activity | sourceActionId | Action._id |
| Activity | sourceActionDeliveryId | ActionDelivery._id |
| Meeting | attendeeUserIds[] | User._id |
| Meeting | attendeeContactIds[] | Contact._id |
| Task | assigneeUserId | User._id |
| StageChanged | pipelineId | Pipeline._id |
| Action | workspaceId | Workspace._id |
| Action | initiatedByUserId | User._id |
| Action | cancelledByUserId | User._id |
| Action | relatedPipelineEntryId | PipelineEntry._id |
| ActionTarget | contactIds[] | Contact._id |
| ActionTarget | listId | List._id |
| ActionTarget | segmentId | Segment._id |
| ActionTarget | excludeContactIds[] | Contact._id |
| SendEmailAction | templateId | MessageTemplate._id |
| SendSmsAction | templateId | MessageTemplate._id |
| ScheduleMeetingAction | organizerUserId | User._id |
| AddToListAction | listId | List._id |
| AddToPipelineStageAction | pipelineId | Pipeline._id |
| ActionDelivery | workspaceId | Workspace._id |
| ActionDelivery | actionId | Action._id |
| ActionDelivery | contactId | Contact._id |
| ActionDelivery | generatedActivityId | Activity._id |
| MessageTemplate | workspaceId | Workspace._id |
| MessageTemplate | createdByUserId | User._id |

---

## Relations

| Relation | Source | Source field | Target | Target field |
|---|---|---|---|---|
| workspace-owner | Workspace | ownerUserId | User | _id |
| membership-workspace | Membership | workspaceId | Workspace | _id |
| membership-user | Membership | userId | User | _id |
| contact-workspace | Contact | workspaceId | Workspace | _id |
| contact-owner | Contact | ownerUserId | User | _id |
| contact-assignee | Contact | assigneeUserId | User | _id |
| person-primary-company | Person | primaryCompanyId | Contact | _id |
| company-parent | Company | parentCompanyId | Contact | _id |
| link-from | ContactLink | fromContactId | Contact | _id |
| link-to | ContactLink | toContactId | Contact | _id |
| list-workspace | List | workspaceId | Workspace | _id |
| listmembership-list | ListMembership | listId | List | _id |
| listmembership-contact | ListMembership | contactId | Contact | _id |
| segment-workspace | Segment | workspaceId | Workspace | _id |
| pipeline-workspace | Pipeline | workspaceId | Workspace | _id |
| pipelineentry-pipeline | PipelineEntry | pipelineId | Pipeline | _id |
| pipelineentry-contact | PipelineEntry | contactId | Contact | _id |
| pipelineentry-owner | PipelineEntry | ownerUserId | User | _id |
| activity-workspace | Activity | workspaceId | Workspace | _id |
| activity-contact | Activity | contactIds | Contact | _id |
| activity-author | Activity | authorUserId | User | _id |
| activity-pipelineentry | Activity | pipelineEntryId | PipelineEntry | _id |
| activity-source-action | Activity | sourceActionId | Action | _id |
| activity-source-delivery | Activity | sourceActionDeliveryId | ActionDelivery | _id |
| meeting-attendee-user | Meeting | attendeeUserIds | User | _id |
| meeting-attendee-contact | Meeting | attendeeContactIds | Contact | _id |
| task-assignee | Task | assigneeUserId | User | _id |
| stagechanged-pipeline | StageChanged | pipelineId | Pipeline | _id |
| action-workspace | Action | workspaceId | Workspace | _id |
| action-initiator | Action | initiatedByUserId | User | _id |
| action-cancelled-by | Action | cancelledByUserId | User | _id |
| action-pipeline-entry | Action | relatedPipelineEntryId | PipelineEntry | _id |
| action-target-list | ActionTarget | listId | List | _id |
| action-target-segment | ActionTarget | segmentId | Segment | _id |
| action-target-contacts | ActionTarget | contactIds | Contact | _id |
| sendemail-template | SendEmailAction | templateId | MessageTemplate | _id |
| sendsms-template | SendSmsAction | templateId | MessageTemplate | _id |
| schedulemeeting-organizer | ScheduleMeetingAction | organizerUserId | User | _id |
| addtolist-list | AddToListAction | listId | List | _id |
| addtopipelinestage-pipeline | AddToPipelineStageAction | pipelineId | Pipeline | _id |
| delivery-workspace | ActionDelivery | workspaceId | Workspace | _id |
| delivery-action | ActionDelivery | actionId | Action | _id |
| delivery-contact | ActionDelivery | contactId | Contact | _id |
| delivery-activity | ActionDelivery | generatedActivityId | Activity | _id |
| template-workspace | MessageTemplate | workspaceId | Workspace | _id |
| template-creator | MessageTemplate | createdByUserId | User | _id |

### Cardinality and direction map (human view)

- **Workspace 1—N Membership N—1 User** (many-to-many via Membership).
- **Workspace 1—N Contact.** Every contact belongs to exactly one workspace.
- **Contact (person) N—1 Contact (company)** via `primaryCompanyId` (shortcut, non-authoritative).
- **Contact N—N Contact** via `ContactLink` (directed or symmetric based on `type`). Covers Person↔Person, Person↔Company, Company↔Company.
- **Contact N—N List** via `ListMembership`.
- **Contact N—N Pipeline** via `PipelineEntry` (each entry also pins a single `stageKey`).
- **Contact 1—N Activity** (via `Activity.contactIds` — a single activity may touch multiple contacts; N—N in practice).
- **PipelineEntry 1—N Activity** (optional link via `Activity.pipelineEntryId` for deal-scoped timeline).
- **User 1—N Action** (via `initiatedByUserId`).
- **Action 1—N ActionDelivery** (fan-out; exactly one parent per delivery).
- **Contact 1—N ActionDelivery** (per-contact send history).
- **Action 0..1—N Activity** via `sourceActionId` (a completed send produces one Activity per successful delivery).
- **MessageTemplate 1—N Action** (optional `templateId`).

---

## Activity polymorphism

Activities are modeled as a **polymorphic hierarchy** rooted at an abstract `Activity` with a `type` discriminator. All activities share: `workspaceId`, `contactIds`, `authorUserId`, `occurredAt`, `createdAt`, and optional `body`, `pipelineEntryId`, `sourceActionId`, `sourceActionDeliveryId`. Subclasses add only their specific fields:

- **Note** — `pinned`.
- **Call** — `direction`, `durationSec`, `outcome`, `phoneUsed`.
- **Meeting** — `title`, `location`, `startAt`, `endAt`, `attendeeUserIds`, `attendeeContactIds`.
- **EmailLog** — `direction`, `subject`, `fromAddress`, `toAddresses`, `ccAddresses`, `messageId`, `threadId`.
- **Task** — `title`, `dueAt`, `assigneeUserId`, `status`, `priority`.
- **Attachment** — `fileName`, `mimeType`, `sizeBytes`, `storageUrl`, `caption`.
- **StageChanged** — `pipelineId`, `fromStageKey`, `toStageKey` (system-generated).

This lets the timeline UI query by `contactIds` alone (single collection scan) and filter or branch on `type` when rendering.

---

## CRM scaffolding

- **Workspace** is the tenancy root. Every queryable class carries `workspaceId` so one scope filter gates all reads.
- **User** is global; users access workspaces through **Membership** (role: `owner | admin | member | viewer`).
- **Ownership fields** on Contact: `ownerUserId` (who created / owns the record), `assigneeUserId` (who is actively working it). Both are `User._id`.
- **Visibility model (per-contact):** each Contact carries `visibility ∈ { workspace, private, shared }` plus `sharedWithUserIds[]`.
  - `workspace` — every workspace member with role >= viewer can read; only admins/assignee/owner can edit.
  - `private` — only the owner (and workspace admins/owners) can read or edit.
  - `shared` — owner + anyone in `sharedWithUserIds` can read; edit rules follow role.
  - **Why per-contact, not workspace-wide?** CRMs routinely mix public pipelines with private personal contacts in the same workspace, and making this per-record avoids a second "private workspace" kludge. The trade-off is that visibility must be evaluated client-side or via a permission service; it is declared, not enforced by the schema.
- **PipelineEntry.ownerUserId** and **Task.assigneeUserId** give CRM-standard "my deals / my tasks" queries.
- **Action initiator** (`Action.initiatedByUserId`) gives CRM-standard "my sends / my outbox" queries; combined with `status` filters, the UI can show drafts, scheduled, in-flight, and history.

---

## Design decisions (highest risk first)

1. **`Contact` as an abstract base with `Person` / `Company` subclasses (one discriminator `kind`).** Rationale: the user wants cross-kind linking, cross-kind search ("find a contact called Acme"), and identical metadata on both. A single base collection makes those queries trivial and keeps activities, lists, segments, and pipelines indifferent to kind. The trade-off is that Person-only or Company-only queries require a `kind` filter — cheap, and the discriminator is indexed-friendly.
2. **`ContactLink` as a top-level collection, not embedded on Contact.** Rationale: links are semantically between two contacts (not owned by one), they carry their own temporal data (`startedAt` / `endedAt`), and "who works at Acme?" needs to be answered without scanning every Person document. One collection covers Person↔Person, Person↔Company, and Company↔Company uniformly.
3. **Activities as a single polymorphic collection with a `type` discriminator.** Rationale: the timeline is the dominant read pattern; one collection + one index on `(workspaceId, contactIds, occurredAt desc)` serves it. Splitting into six collections would force a client-side merge on every contact detail view.
4. **Static lists via `ListMembership` join; dynamic segments via a stored `SegmentQuery`.** Rationale: matches the user's ask (both static and dynamic). Memberships are stored because static lists must persist even if a contact later stops matching any filter; segments are computed on read so they stay fresh.
5. **Visibility is per-contact (field on Contact), not a separate ACL class.** Rationale: keeps v1 simple; easy to evolve into a richer ACL later without breaking existing data.
6. **Custom fields as a `dictionary` of typed values keyed by `CustomFieldDef.key`.** Rationale: O(1) access, self-describing Contact document, and upgrades cleanly when more types are added (just extend `CustomFieldValue`).
7. **`externalIdentities[]` placeholder on Contact now.** Rationale: the user wants room for future import without a migration; an empty array today costs nothing.
8. **Action and Activity as two separate hierarchies, linked by `sourceActionId`.** Rationale: they answer different questions — Activity answers "what happened with this contact?" (past tense, timeline), Action answers "what did I send out?" (intent + lifecycle, outbox). Conflating them would mean draft sends pollute timelines and bulk sends explode per-contact history. The back-link gives us the best of both: the timeline shows one `EmailLog` per recipient; the outbox shows one `Action` for the whole send; clicking either crosses over.
9. **One `Action` + N `ActionDelivery`, not N `SendEmailAction`.** Rationale: per-intent status rollup, per-recipient queryability, bounded parent document. See "Bulk / campaign grouping" above.
10. **Snapshot targeting as the v1 default (not live resolution).** Rationale: a scheduled send must be predictable — the user agreed to a recipient set when they clicked send, and moving segment membership underneath them is a bug, not a feature. Live resolution is still offered as an opt-in for advanced cases.
11. **Shared state machine on `Action` (not per-subclass).** Rationale: the lifecycle stages are semantic ("user's intent is queued / running / finished"), not mechanical, so all subclasses should obey the same one. Per-subclass variance lives in what "sending" does, not in the state names.
12. **`MessageTemplate` introduced in v1, but inline bodies remain the primary path.** Rationale: templates are clearly coming — the second send makes the case — but they must not be mandatory for one-off messages.

---

## Open questions

1. **Search capabilities.** "Search by name, by company, by related contacts" — is bootstrapp.cloud expected to do:
   - substring / prefix matching on `displayName`, `firstName`, `lastName`, `Company.legalName`?
   - queries that traverse `ContactLink` (e.g. "people who work at Acme") in a single call, or is a two-step client-side fetch acceptable?
   - If full-text / fuzzy matching is needed, we may need an explicit `searchIndex` denormalized field on Contact or an external search service.
2. **Segment query expressiveness.** Is flat AND/OR of leaf filters (current `SegmentQuery` with `match: all|any`) enough, or do we need nested groups (e.g. "(A or B) and (C or D)")? If nested, `SegmentFilter` should become recursive.
3. **Segment operators over embedded arrays.** How should filters reference multi-valued fields — e.g. "any email contains @acme.com"? Do we allow `field: "emails.address"` with implicit array quantification, or add an explicit `quantifier: any|all`?
4. **Symmetric link types.** For symmetric types (`spouse_of`, `sibling_of`), do we store one `ContactLink` row and render both directions, or always two rows? One-row is cheaper; two-row makes reverse queries uniform.
5. **Multiple employments per person.** `Person.primaryCompanyId` is a convenience shortcut; full history lives in `ContactLink` with `type: "works_at"` and `startedAt`/`endedAt`. Is this split acceptable, or do we want employment to be its own top-level class (`Employment`) with richer fields (title history, comp, etc.)?
6. **Tags as strings vs Tag class.** Today tags are plain strings. If we need tag colors, descriptions, or workspace-level tag management, promote `Tag` to top-level. Confirm whether that is needed in v1.
7. **Task as Activity vs separate.** Tasks are currently an Activity variant (so they appear in the timeline). Some CRMs keep tasks in a separate collection for a global "my tasks" queue. Are we OK with tasks being fetched via the activity timeline plus an index on `(type="task", assigneeUserId, status)`? Related: should "create task" become a `CreateTaskAction`, or remain a direct write? **Tentative answer: direct write.** A task has no send lifecycle and no per-recipient fan-out; wrapping it in an Action adds no value.
8. **Attachments storage.** `Attachment.storageUrl` (and `ActionAttachment.storageUrl`) assumes files live outside the data model. Confirm that external blob storage is available, or we need to treat attachments differently.
9. **Deletion semantics.** Hard delete vs soft delete on Contact (and cascade to ContactLink, ListMembership, PipelineEntry, Activity, ActionDelivery)? Actions are especially sensitive — deleting a contact should not delete the historical record of sends to them. Important to settle before `bootstrapp-architect` decides on referential cleanup.
10. **Visibility enforcement.** Bootstrapp relations are declarative, not enforced. Will the app layer enforce `visibility` / `sharedWithUserIds`, or do we need a gateway pattern? This also affects `previewActionTarget` — contacts the initiator can't see must be filtered out before enqueue.
11. **External identity dedup key.** When import lands, do we want a unique constraint on `(workspaceId, externalIdentities.source, externalIdentities.externalId)` to prevent duplicate imports? If so, that affects how `externalIdentities` is stored (likely needs to be queryable, which it already is as an array on a top-level class).
12. **Provider identity / account model.** `SenderIdentity.providerAccountId` is a free-form string today. Do we need a top-level `ProviderAccount` (Twilio sub-account, Gmail OAuth connection, SMTP credential set) that workspaces configure once and actions reference? Likely yes by v1.1; deferred for now so Actions don't block on it.
13. **Scheduling granularity and recurrence.** `scheduledFor` + `timezone` covers one-shot scheduled sends. Do we need recurrence (daily digest, drip sequences) in v1? Current answer: no — v2 via a `RecurrenceRule` embedded field. Confirm.
14. **`SmsLog` Activity subclass.** `SendSmsAction` currently has no matching timeline Activity. Recommendation is to add `SmsLog` (fields: `direction`, `fromNumber`, `toNumber`, `providerMessageId`, optional `mediaUrls`) so the timeline shows SMS history alongside email. Do we add it now or defer?
15. **Template variables and merge semantics.** The `TemplateVariable` schema names sources but says nothing about formatting (dates, currency, fallbacks). For v1: minimal string substitution, fallback = `defaultValue`. Confirm that is enough.
16. **Per-recipient data on `ActionDelivery`.** Right now the delivery stores `resolvedAddress` but not, say, the per-recipient merged subject/body. For audit ("what exactly did Jane receive?") we may want to snapshot the rendered subject/body on each delivery. That multiplies storage by N; for v1, recommendation is to **not** snapshot and rely on the template + variables + contact-at-send-time to reconstruct. Confirm.
17. **Action audit / webhooks.** External providers (Twilio, SendGrid) deliver status asynchronously via webhook. `markDeliveryOutcome` assumes an internal dispatcher; will there be a webhook-facing action that maps provider event → delivery update? Likely yes but not modeled here.
