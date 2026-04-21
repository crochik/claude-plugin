# Data Model Blueprint — Contact Management App

Draft v0.1 — 2026-04-21. Design-only. Intended for review before handoff to `bootstrapp-architect`.

## Overview

A CRM-style contact manager. Contacts are both **people** and **companies**, and they can link to each other (works-at, spouse-of, reports-to, subsidiary-of, etc.). Data is scoped to a **Workspace**; users join a workspace via **Membership**. Contacts carry rich multi-valued metadata (phones, emails, addresses, messaging handles, social profiles, tags, custom fields). Grouping happens via **static Lists** and **dynamic Segments**. A lightweight **Pipeline / Stage** model supports CRM-style progression. Activity history (notes, calls, meetings, emails, tasks, attachments) is modeled as a polymorphic `Activity` hierarchy.

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
      "body": { "type": "string" }
    },
    "required": ["_id","workspaceId","type","authorUserId","contactIds","occurredAt"]
  }
  ```
- **Notes:** `contactIds` is an array so one activity (e.g. a meeting) can attach to multiple contacts. `body` is a shared optional free-text field; subclasses add structure on top.

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
- **Notes:** A record of an email that happened. Not an outbox — no send semantics.

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

Rationale highlights:
- **Phones, emails, addresses, handles, socials** are embedded arrays on `Contact`: they have no independent identity, are always fetched with the contact, and are always written as part of a contact-level save.
- **Custom field values** are a dictionary keyed by the workspace's `CustomFieldDef.key`. This gives O(1) access by key and keeps the Contact document self-describing.
- **Tags** are a plain `array of string` on `Contact` (no embedded class). Tag definitions are implicit; if we later need per-tag color/description we promote `Tag` to a top-level class.
- **List membership, pipeline entries, contact links, activities** are all **top-level** (not embedded) because they must be queryable from either side and can grow unbounded.
- **Pipeline stages** are embedded because they are bounded, ordered, and conceptually part of the pipeline definition.

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
| Meeting | attendeeUserIds[] | User._id |
| Meeting | attendeeContactIds[] | Contact._id |
| Task | assigneeUserId | User._id |
| StageChanged | pipelineId | Pipeline._id |

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
| meeting-attendee-user | Meeting | attendeeUserIds | User | _id |
| meeting-attendee-contact | Meeting | attendeeContactIds | Contact | _id |
| task-assignee | Task | assigneeUserId | User | _id |
| stagechanged-pipeline | StageChanged | pipelineId | Pipeline | _id |

### Cardinality and direction map (human view)

- **Workspace 1—N Membership N—1 User** (many-to-many via Membership).
- **Workspace 1—N Contact.** Every contact belongs to exactly one workspace.
- **Contact (person) N—1 Contact (company)** via `primaryCompanyId` (shortcut, non-authoritative).
- **Contact N—N Contact** via `ContactLink` (directed or symmetric based on `type`). Covers Person↔Person, Person↔Company, Company↔Company.
- **Contact N—N List** via `ListMembership`.
- **Contact N—N Pipeline** via `PipelineEntry` (each entry also pins a single `stageKey`).
- **Contact 1—N Activity** (via `Activity.contactIds` — a single activity may touch multiple contacts; N—N in practice).
- **PipelineEntry 1—N Activity** (optional link via `Activity.pipelineEntryId` for deal-scoped timeline).

---

## Activity polymorphism

Activities are modeled as a **polymorphic hierarchy** rooted at an abstract `Activity` with a `type` discriminator. All activities share: `workspaceId`, `contactIds`, `authorUserId`, `occurredAt`, `createdAt`, and optional `body` and `pipelineEntryId`. Subclasses add only their specific fields:

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

---

## Design decisions (highest risk first)

1. **`Contact` as an abstract base with `Person` / `Company` subclasses (one discriminator `kind`).** Rationale: the user wants cross-kind linking, cross-kind search ("find a contact called Acme"), and identical metadata on both. A single base collection makes those queries trivial and keeps activities, lists, segments, and pipelines indifferent to kind. The trade-off is that Person-only or Company-only queries require a `kind` filter — cheap, and the discriminator is indexed-friendly.
2. **`ContactLink` as a top-level collection, not embedded on Contact.** Rationale: links are semantically between two contacts (not owned by one), they carry their own temporal data (`startedAt` / `endedAt`), and "who works at Acme?" needs to be answered without scanning every Person document. One collection covers Person↔Person, Person↔Company, and Company↔Company uniformly.
3. **Activities as a single polymorphic collection with a `type` discriminator.** Rationale: the timeline is the dominant read pattern; one collection + one index on `(workspaceId, contactIds, occurredAt desc)` serves it. Splitting into six collections would force a client-side merge on every contact detail view.
4. **Static lists via `ListMembership` join; dynamic segments via a stored `SegmentQuery`.** Rationale: matches the user's ask (both static and dynamic). Memberships are stored because static lists must persist even if a contact later stops matching any filter; segments are computed on read so they stay fresh.
5. **Visibility is per-contact (field on Contact), not a separate ACL class.** Rationale: keeps v1 simple; easy to evolve into a richer ACL later without breaking existing data.
6. **Custom fields as a `dictionary` of typed values keyed by `CustomFieldDef.key`.** Rationale: O(1) access, self-describing Contact document, and upgrades cleanly when more types are added (just extend `CustomFieldValue`).
7. **`externalIdentities[]` placeholder on Contact now.** Rationale: the user wants room for future import without a migration; an empty array today costs nothing.

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
7. **Task as Activity vs separate.** Tasks are currently an Activity variant (so they appear in the timeline). Some CRMs keep tasks in a separate collection for a global "my tasks" queue. Are we OK with tasks being fetched via the activity timeline plus an index on `(type="task", assigneeUserId, status)`?
8. **Attachments storage.** `Attachment.storageUrl` assumes files live outside the data model. Confirm that external blob storage is available, or we need to treat attachments differently.
9. **Deletion semantics.** Hard delete vs soft delete on Contact (and cascade to ContactLink, ListMembership, PipelineEntry, Activity)? Important to settle before `bootstrapp-architect` decides on referential cleanup.
10. **Visibility enforcement.** Bootstrapp relations are declarative, not enforced. Will the app layer enforce `visibility` / `sharedWithUserIds`, or do we need a gateway pattern? This is an implementation concern but the schema choice depends on the answer.
11. **External identity dedup key.** When import lands, do we want a unique constraint on `(workspaceId, externalIdentities.source, externalIdentities.externalId)` to prevent duplicate imports? If so, that affects how `externalIdentities` is stored (likely needs to be queryable, which it already is as an array on a top-level class).
