# Beer Tracking App - Design Session

Before I draft the full blueprint, I want to confirm a handful of decisions that materially change the schema. I'll state my default assumption for each so we can move fast if you agree.

## Clarifying questions (with proposed defaults)

1. **Beer catalog source.** Is the `Beer` catalog curated/shared across all users (one canonical entry per real-world beer), or does each user add their own beers ad-hoc?
   *Default:* shared canonical catalog. Users can *propose* a new beer (creates a pending entry), admins approve. This supports meaningful leaderboards and recommendations.

2. **Friend model.** Symmetric friendship (mutual accept, like Facebook) or asymmetric follow (one-way, like Twitter)?
   *Default:* symmetric friendship with an explicit `FriendRequest` lifecycle (pending / accepted / declined).

3. **Leaderboard metric.** "Most unique beers tried", "most check-ins", "highest average rating given", "most reviews written", or several of these?
   *Default:* multiple leaderboards, each derived from a single metric. Primary = unique beers tried. Others are just different queries against the same data, computed by a `getLeaderboard` action that takes the metric as input.

4. **Check-in vs review.** In apps like Untappd, a *check-in* (I drank this beer now, optional rating + short note) is distinct from a long-form *review*. Do you want both, or collapse into one?
   *Default:* keep both. `CheckIn` is lightweight and social (feeds the activity feed and leaderboard). `Review` is a longer, edited, single-per-user-per-beer document.

5. **Recommendation shape.** Is a recommendation "user A tells user B: try beer X" (one-to-one message) or "user A broadcasts: I recommend beer X" (one-to-many post)?
   *Default:* one-to-one directed recommendation from sender to one friend, referencing a beer, with an optional message. Recipient can mark it as seen / tried / dismissed.

6. **Activity feed.** Should there be a feed of friends' activity (check-ins, reviews, recommendations)?
   *Default:* yes, but derived — no separate `FeedEntry` class. A `getFriendsFeed` action queries recent check-ins/reviews/recommendations from the acting user's friends.

7. **Beer taxonomy.** Do we need `BreweryStyle` / `BeerStyle` as their own top-level classes (so we can browse "all IPAs"), or is `style` just a string on `Beer`?
   *Default:* `Brewery` is top-level (beers belong to a brewery, users may want to see all beers from one brewery). `BeerStyle` is a string enum on `Beer` for now.

I'll proceed with these defaults. Here is the blueprint.

---

# Backend Blueprint

## Namespaces

| Namespace | Purpose |
|---|---|
| `catalog`  | Shared beer catalog: breweries and beers. |
| `social`   | User-facing social model: profiles, friendships, check-ins, reviews, recommendations. |
| `actions`  | Input/output classes for server-side actions. |

One domain namespace would work, but `catalog` and `social` are genuinely different bounded contexts with different write patterns (catalog is mostly-read, admin-moderated; social is high-write, per-user), so splitting them now keeps naming clean later.

## Classes

### catalog.Brewery
- **Level:** top-level
- **Extends:** none
- **Summary:** Producer of beers with location and profile info.
- **Description:** A brewery that produces one or more beers in the catalog. Breweries are curated entries shared across all users; users can suggest new ones but cannot edit existing records directly.
- **JSON Schema:**
  ```json
  {
    "title": "Brewery",
    "description": "A producer of beers in the shared catalog, with identifying and descriptive metadata.",
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "title": "Brewery Name",
        "description": "Official name of the brewery as it appears on packaging.",
        "examples": ["Sierra Nevada Brewing Co."]
      },
      "country": {
        "type": "string",
        "title": "Country",
        "description": "ISO 3166-1 alpha-2 country code of the brewery's primary location.",
        "examples": ["US"]
      },
      "city": {
        "type": "string",
        "title": "City",
        "description": "City where the brewery is based.",
        "examples": ["Chico"]
      },
      "websiteUrl": {
        "type": "string",
        "title": "Website URL",
        "description": "Public website for the brewery, if any.",
        "examples": ["https://sierranevada.com"]
      },
      "description": {
        "type": "string",
        "title": "Description",
        "description": "Short prose description of the brewery, its history, or focus.",
        "examples": ["Family-owned craft brewery founded in 1980, best known for its pale ale."]
      }
    },
    "required": ["name", "country"],
    "examples": [
      {
        "name": "Sierra Nevada Brewing Co.",
        "country": "US",
        "city": "Chico",
        "websiteUrl": "https://sierranevada.com",
        "description": "Family-owned craft brewery founded in 1980, best known for its pale ale."
      }
    ]
  }
  ```
- **Notes:** Top-level because users will browse and filter breweries independently and many beers reference one brewery.

### catalog.Beer
- **Level:** top-level
- **Extends:** none
- **Summary:** Canonical catalog entry for a specific beer.
- **Description:** A single beer produced by a brewery, identified canonically so that check-ins, reviews, and recommendations across users all point at the same record. `status` distinguishes admin-approved entries from user-submitted pending ones.
- **JSON Schema:**
  ```json
  {
    "title": "Beer",
    "description": "A canonical entry in the shared beer catalog, produced by one brewery.",
    "type": "object",
    "properties": {
      "breweryId": {
        "type": "string",
        "title": "Brewery ID",
        "description": "Reference to the catalog.Brewery that produces this beer.",
        "examples": ["brw_4Uh2nA"]
      },
      "name": {
        "type": "string",
        "title": "Beer Name",
        "description": "Official name of the beer as it appears on packaging.",
        "examples": ["Pale Ale"]
      },
      "style": {
        "type": "string",
        "title": "Beer Style",
        "description": "Broad style category. Controlled vocabulary; extend as needed.",
        "enum": ["IPA", "PaleAle", "Lager", "Pilsner", "Stout", "Porter", "Wheat", "Sour", "Saison", "Other"],
        "examples": ["PaleAle"]
      },
      "abv": {
        "type": "number",
        "title": "Alcohol By Volume",
        "description": "Alcohol by volume as a percentage. Must be between 0 and 100.",
        "minimum": 0,
        "maximum": 100,
        "examples": [5.6]
      },
      "ibu": {
        "type": "integer",
        "title": "International Bitterness Units",
        "description": "Measured or published IBU value. Optional; not all beers publish one.",
        "minimum": 0,
        "examples": [38]
      },
      "description": {
        "type": "string",
        "title": "Description",
        "description": "Short prose description of the beer's flavor profile.",
        "examples": ["Classic American pale ale with citrus and pine from Cascade hops."]
      },
      "labelImageUrl": {
        "type": "string",
        "title": "Label Image URL",
        "description": "Optional URL to a label or can/bottle image.",
        "examples": ["https://cdn.example.com/labels/sierra-pale-ale.png"]
      },
      "status": {
        "type": "string",
        "title": "Catalog Status",
        "description": "Whether this entry has been approved by admins or is still pending review.",
        "enum": ["pending", "approved", "rejected"],
        "examples": ["approved"]
      }
    },
    "required": ["breweryId", "name", "style", "status"],
    "examples": [
      {
        "breweryId": "brw_4Uh2nA",
        "name": "Pale Ale",
        "style": "PaleAle",
        "abv": 5.6,
        "ibu": 38,
        "description": "Classic American pale ale with citrus and pine from Cascade hops.",
        "labelImageUrl": "https://cdn.example.com/labels/sierra-pale-ale.png",
        "status": "approved"
      }
    ]
  }
  ```
- **Notes:** Top-level because it is referenced by check-ins, reviews, and recommendations across users, and must be queryable on its own (search by name, filter by style).

### social.UserProfile
- **Level:** top-level
- **Extends:** none
- **Summary:** Public profile for an app user.
- **Description:** Per-user profile information visible to friends and surfaced on leaderboards. Authentication identity is managed by bootstrapp.cloud; this class holds only app-specific display data.
- **JSON Schema:**
  ```json
  {
    "title": "User Profile",
    "description": "Public-facing profile for a user of the beer tracking app.",
    "type": "object",
    "properties": {
      "authUserId": {
        "type": "string",
        "title": "Auth User ID",
        "description": "Opaque identifier linking this profile to the authenticated user in bootstrapp.cloud auth.",
        "examples": ["auth_9KmXpQ"]
      },
      "displayName": {
        "type": "string",
        "title": "Display Name",
        "description": "Name shown to other users on the leaderboard, reviews, and check-ins.",
        "examples": ["Beer Hunter Sam"]
      },
      "handle": {
        "type": "string",
        "title": "Handle",
        "description": "Unique short handle used for friend search. Lowercase alphanumerics and underscores, 3-20 chars.",
        "pattern": "^[a-z0-9_]{3,20}$",
        "examples": ["sam_hops"]
      },
      "avatarUrl": {
        "type": "string",
        "title": "Avatar URL",
        "description": "Optional URL to a profile picture.",
        "examples": ["https://cdn.example.com/avatars/sam.png"]
      },
      "bio": {
        "type": "string",
        "title": "Bio",
        "description": "Short prose bio the user writes about themselves.",
        "examples": ["Hop-forward IPAs and sour ales. Based in Portland."]
      },
      "homeCity": {
        "type": "string",
        "title": "Home City",
        "description": "Optional city the user lists as home.",
        "examples": ["Portland, OR"]
      },
      "joinedAt": {
        "type": "string",
        "format": "date-time",
        "title": "Joined At",
        "description": "Timestamp when the profile was first created.",
        "examples": ["2026-01-14T09:22:00Z"]
      }
    },
    "required": ["authUserId", "displayName", "handle", "joinedAt"],
    "examples": [
      {
        "authUserId": "auth_9KmXpQ",
        "displayName": "Beer Hunter Sam",
        "handle": "sam_hops",
        "avatarUrl": "https://cdn.example.com/avatars/sam.png",
        "bio": "Hop-forward IPAs and sour ales. Based in Portland.",
        "homeCity": "Portland, OR",
        "joinedAt": "2026-01-14T09:22:00Z"
      }
    ]
  }
  ```
- **Notes:** `handle` should be unique across the system. Uniqueness will be enforced by the `registerProfile` action, not by the schema.

### social.Friendship
- **Level:** top-level
- **Extends:** none
- **Summary:** Symmetric friendship link between two users.
- **Description:** Represents a confirmed, mutual friendship between two users. Exactly one `Friendship` document exists per pair of users, created when a `FriendRequest` is accepted. The two `userId` fields are stored in canonical (lexicographically sorted) order so duplicate rows cannot exist.
- **JSON Schema:**
  ```json
  {
    "title": "Friendship",
    "description": "A symmetric, accepted friendship between two user profiles.",
    "type": "object",
    "properties": {
      "userIdA": {
        "type": "string",
        "title": "User A ID",
        "description": "Lexicographically smaller of the two profile IDs in this friendship.",
        "examples": ["usr_3Hp9xC"]
      },
      "userIdB": {
        "type": "string",
        "title": "User B ID",
        "description": "Lexicographically larger of the two profile IDs in this friendship.",
        "examples": ["usr_8Lq2nM"]
      },
      "since": {
        "type": "string",
        "format": "date-time",
        "title": "Friends Since",
        "description": "Timestamp when the friend request was accepted and the friendship was established.",
        "examples": ["2026-02-03T18:45:00Z"]
      }
    },
    "required": ["userIdA", "userIdB", "since"],
    "examples": [
      {
        "userIdA": "usr_3Hp9xC",
        "userIdB": "usr_8Lq2nM",
        "since": "2026-02-03T18:45:00Z"
      }
    ]
  }
  ```
- **Notes:** The canonical-ordering rule is enforced by the `acceptFriendRequest` action. Querying "is X friend of Y" becomes a lookup on the sorted pair.

### social.FriendRequest
- **Level:** top-level
- **Extends:** none
- **Summary:** Pending or resolved request to befriend another user.
- **Description:** Lifecycle record for a friendship proposal. Created by `sendFriendRequest`, transitioned by `acceptFriendRequest` or `declineFriendRequest`. Once accepted, a corresponding `Friendship` document is created.
- **JSON Schema:**
  ```json
  {
    "title": "Friend Request",
    "description": "A directional request from one user to another to establish a friendship.",
    "type": "object",
    "properties": {
      "fromUserId": {
        "type": "string",
        "title": "From User ID",
        "description": "Reference to the social.UserProfile that sent the request.",
        "examples": ["usr_3Hp9xC"]
      },
      "toUserId": {
        "type": "string",
        "title": "To User ID",
        "description": "Reference to the social.UserProfile that received the request.",
        "examples": ["usr_8Lq2nM"]
      },
      "status": {
        "type": "string",
        "title": "Status",
        "description": "Current state of the request.",
        "enum": ["pending", "accepted", "declined", "cancelled"],
        "examples": ["pending"]
      },
      "message": {
        "type": "string",
        "title": "Message",
        "description": "Optional short note the sender attaches to the request.",
        "examples": ["Met you at the Fresh Hops fest, let's swap recommendations!"]
      },
      "sentAt": {
        "type": "string",
        "format": "date-time",
        "title": "Sent At",
        "description": "Timestamp when the request was created.",
        "examples": ["2026-04-15T10:12:00Z"]
      },
      "resolvedAt": {
        "type": "string",
        "format": "date-time",
        "title": "Resolved At",
        "description": "Timestamp when the request was accepted, declined, or cancelled. Absent while pending.",
        "examples": ["2026-04-16T08:05:00Z"]
      }
    },
    "required": ["fromUserId", "toUserId", "status", "sentAt"],
    "examples": [
      {
        "fromUserId": "usr_3Hp9xC",
        "toUserId": "usr_8Lq2nM",
        "status": "pending",
        "message": "Met you at the Fresh Hops fest, let's swap recommendations!",
        "sentAt": "2026-04-15T10:12:00Z"
      }
    ]
  }
  ```
- **Notes:** At most one `pending` request should exist per directed pair; enforced by `sendFriendRequest`.

### social.CheckIn
- **Level:** top-level
- **Extends:** none
- **Summary:** Lightweight record of drinking a beer.
- **Description:** A single act of drinking a beer at a moment in time. Powers the activity feed and the leaderboards. A user may check in the same beer many times; each check-in is independent.
- **JSON Schema:**
  ```json
  {
    "title": "Check-In",
    "description": "A user's record of consuming a specific beer at a given time, optionally with a quick rating and note.",
    "type": "object",
    "properties": {
      "userId": {
        "type": "string",
        "title": "User ID",
        "description": "Reference to the social.UserProfile that created this check-in.",
        "examples": ["usr_3Hp9xC"]
      },
      "beerId": {
        "type": "string",
        "title": "Beer ID",
        "description": "Reference to the catalog.Beer that was consumed.",
        "examples": ["beer_21QpzR"]
      },
      "rating": {
        "type": "integer",
        "title": "Quick Rating",
        "description": "Optional 1-5 star rating, lightweight and unvalidated compared to a full review.",
        "minimum": 1,
        "maximum": 5,
        "examples": [4]
      },
      "note": {
        "type": "string",
        "title": "Note",
        "description": "Optional short free-text note (think tweet-length, not review-length).",
        "maxLength": 280,
        "examples": ["Perfect after a long hike. Juicy and dry-finishing."]
      },
      "venue": {
        "type": "string",
        "title": "Venue",
        "description": "Optional free-text venue name where the beer was consumed.",
        "examples": ["Cascade Brewpub"]
      },
      "occurredAt": {
        "type": "string",
        "format": "date-time",
        "title": "Occurred At",
        "description": "Timestamp the user indicates they drank the beer. Defaults to the submission time if not provided.",
        "examples": ["2026-04-20T19:30:00Z"]
      }
    },
    "required": ["userId", "beerId", "occurredAt"],
    "examples": [
      {
        "userId": "usr_3Hp9xC",
        "beerId": "beer_21QpzR",
        "rating": 4,
        "note": "Perfect after a long hike. Juicy and dry-finishing.",
        "venue": "Cascade Brewpub",
        "occurredAt": "2026-04-20T19:30:00Z"
      }
    ]
  }
  ```
- **Notes:** Top-level because it is the primary signal behind both the leaderboards and the friends feed, and must be filterable by user, beer, and time range.

### social.Review
- **Level:** top-level
- **Extends:** none
- **Summary:** Long-form review of a beer by a user.
- **Description:** Single canonical review a user has written about a specific beer. One review per (user, beer) pair; re-submitting updates the existing document. Separate from `CheckIn` so that ratings in reviews remain stable while quick check-ins can vary.
- **JSON Schema:**
  ```json
  {
    "title": "Review",
    "description": "A user's considered, edited review of a single beer, with a rating and prose body.",
    "type": "object",
    "properties": {
      "userId": {
        "type": "string",
        "title": "User ID",
        "description": "Reference to the social.UserProfile that authored this review.",
        "examples": ["usr_3Hp9xC"]
      },
      "beerId": {
        "type": "string",
        "title": "Beer ID",
        "description": "Reference to the catalog.Beer being reviewed.",
        "examples": ["beer_21QpzR"]
      },
      "rating": {
        "type": "integer",
        "title": "Rating",
        "description": "Overall rating on a 1-5 integer scale.",
        "minimum": 1,
        "maximum": 5,
        "examples": [5]
      },
      "title": {
        "type": "string",
        "title": "Review Title",
        "description": "Short headline for the review.",
        "examples": ["The benchmark American pale ale"]
      },
      "body": {
        "type": "string",
        "title": "Review Body",
        "description": "Main prose content of the review.",
        "examples": ["Pine and grapefruit on the nose, medium body, dry bitter finish. Still the one I compare others to."]
      },
      "aromaScore": {
        "type": "integer",
        "title": "Aroma Score",
        "description": "Optional detail score for aroma, 1-5.",
        "minimum": 1,
        "maximum": 5,
        "examples": [5]
      },
      "tasteScore": {
        "type": "integer",
        "title": "Taste Score",
        "description": "Optional detail score for taste, 1-5.",
        "minimum": 1,
        "maximum": 5,
        "examples": [5]
      },
      "createdAt": {
        "type": "string",
        "format": "date-time",
        "title": "Created At",
        "description": "Timestamp when the review was first published.",
        "examples": ["2026-03-10T21:00:00Z"]
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time",
        "title": "Updated At",
        "description": "Timestamp of the most recent edit.",
        "examples": ["2026-03-11T07:45:00Z"]
      }
    },
    "required": ["userId", "beerId", "rating", "body", "createdAt"],
    "examples": [
      {
        "userId": "usr_3Hp9xC",
        "beerId": "beer_21QpzR",
        "rating": 5,
        "title": "The benchmark American pale ale",
        "body": "Pine and grapefruit on the nose, medium body, dry bitter finish. Still the one I compare others to.",
        "aromaScore": 5,
        "tasteScore": 5,
        "createdAt": "2026-03-10T21:00:00Z",
        "updatedAt": "2026-03-11T07:45:00Z"
      }
    ]
  }
  ```
- **Notes:** One-per-user-per-beer uniqueness is enforced by the `upsertReview` action.

### social.Recommendation
- **Level:** top-level
- **Extends:** none
- **Summary:** Directed suggestion of a beer from one friend to another.
- **Description:** A sender recommends a specific beer to a single friend with an optional note. The recipient can update the status as they engage with it (seen, saved, tried, dismissed). Only users who are already friends can receive recommendations.
- **JSON Schema:**
  ```json
  {
    "title": "Recommendation",
    "description": "A directed beer recommendation from one user to a friend, with a lifecycle status set by the recipient.",
    "type": "object",
    "properties": {
      "fromUserId": {
        "type": "string",
        "title": "From User ID",
        "description": "Reference to the social.UserProfile that sent the recommendation.",
        "examples": ["usr_3Hp9xC"]
      },
      "toUserId": {
        "type": "string",
        "title": "To User ID",
        "description": "Reference to the social.UserProfile that received the recommendation.",
        "examples": ["usr_8Lq2nM"]
      },
      "beerId": {
        "type": "string",
        "title": "Beer ID",
        "description": "Reference to the catalog.Beer being recommended.",
        "examples": ["beer_21QpzR"]
      },
      "message": {
        "type": "string",
        "title": "Message",
        "description": "Optional note explaining why the sender thinks the recipient would like this beer.",
        "maxLength": 500,
        "examples": ["You loved Zombie Dust - this has the same citrus punch but more body."]
      },
      "status": {
        "type": "string",
        "title": "Status",
        "description": "Recipient-controlled lifecycle state of the recommendation.",
        "enum": ["unseen", "seen", "saved", "tried", "dismissed"],
        "examples": ["unseen"]
      },
      "sentAt": {
        "type": "string",
        "format": "date-time",
        "title": "Sent At",
        "description": "Timestamp when the recommendation was created.",
        "examples": ["2026-04-18T14:02:00Z"]
      },
      "resolvedAt": {
        "type": "string",
        "format": "date-time",
        "title": "Resolved At",
        "description": "Timestamp of the last status change by the recipient. Absent until first viewed.",
        "examples": ["2026-04-19T08:30:00Z"]
      }
    },
    "required": ["fromUserId", "toUserId", "beerId", "status", "sentAt"],
    "examples": [
      {
        "fromUserId": "usr_3Hp9xC",
        "toUserId": "usr_8Lq2nM",
        "beerId": "beer_21QpzR",
        "message": "You loved Zombie Dust - this has the same citrus punch but more body.",
        "status": "unseen",
        "sentAt": "2026-04-18T14:02:00Z"
      }
    ]
  }
  ```
- **Notes:** `sendRecommendation` enforces the friendship precondition.

---

### Action I/O classes (namespace `actions`)

All classes below are **embedded** and live in the `actions` namespace. I'm including full JSON Schemas for the class-level inputs/outputs; the per-property documentation rule is applied throughout.

### actions.RegisterProfileInput
- **Level:** embedded
- **Extends:** none
- **Summary:** Payload to register a new user profile.
- **Description:** Input for the `registerProfile` action. Supplies the display attributes for a newly-authenticated user's first profile.
- **JSON Schema:**
  ```json
  {
    "title": "Register Profile Input",
    "description": "Input payload for the registerProfile action.",
    "type": "object",
    "properties": {
      "displayName": {
        "type": "string",
        "title": "Display Name",
        "description": "Public display name to show on the leaderboard and in feeds.",
        "examples": ["Beer Hunter Sam"]
      },
      "handle": {
        "type": "string",
        "title": "Handle",
        "description": "Requested unique handle. Must match ^[a-z0-9_]{3,20}$.",
        "pattern": "^[a-z0-9_]{3,20}$",
        "examples": ["sam_hops"]
      },
      "avatarUrl": {
        "type": "string",
        "title": "Avatar URL",
        "description": "Optional URL to a profile picture.",
        "examples": ["https://cdn.example.com/avatars/sam.png"]
      },
      "bio": {
        "type": "string",
        "title": "Bio",
        "description": "Optional short bio.",
        "examples": ["Hop-forward IPAs and sour ales."]
      },
      "homeCity": {
        "type": "string",
        "title": "Home City",
        "description": "Optional home city.",
        "examples": ["Portland, OR"]
      }
    },
    "required": ["displayName", "handle"],
    "examples": [
      {
        "displayName": "Beer Hunter Sam",
        "handle": "sam_hops",
        "avatarUrl": "https://cdn.example.com/avatars/sam.png",
        "bio": "Hop-forward IPAs and sour ales.",
        "homeCity": "Portland, OR"
      }
    ]
  }
  ```

### actions.RegisterProfileOutput
- **Level:** embedded
- **Extends:** none
- **Summary:** Result of registering a new profile.
- **Description:** Output for the `registerProfile` action. Returns the created profile's id.
- **JSON Schema:**
  ```json
  {
    "title": "Register Profile Output",
    "description": "Output payload for the registerProfile action.",
    "type": "object",
    "properties": {
      "userId": {
        "type": "string",
        "title": "User ID",
        "description": "ID of the newly created social.UserProfile.",
        "examples": ["usr_3Hp9xC"]
      }
    },
    "required": ["userId"],
    "examples": [{ "userId": "usr_3Hp9xC" }]
  }
  ```

### actions.ProposeBeerInput
- **Level:** embedded
- **Summary:** Payload to propose a new beer for the catalog.
- **Description:** Input for `proposeBeer`. Creates a catalog.Beer with `status: pending`. May reference an existing brewery by id or propose a new brewery inline.
- **JSON Schema:**
  ```json
  {
    "title": "Propose Beer Input",
    "description": "Input payload for the proposeBeer action.",
    "type": "object",
    "properties": {
      "breweryId": {
        "type": "string",
        "title": "Existing Brewery ID",
        "description": "Reference to an existing catalog.Brewery. Provide either this or newBrewery.",
        "examples": ["brw_4Uh2nA"]
      },
      "newBrewery": {
        "type": "object",
        "title": "New Brewery",
        "description": "Inline new brewery to create alongside the beer. Used when the brewery is not yet in the catalog.",
        "properties": {
          "name": { "type": "string", "title": "Name", "description": "Brewery name.", "examples": ["Fresh Cascade Brewing"] },
          "country": { "type": "string", "title": "Country", "description": "ISO country code.", "examples": ["US"] },
          "city": { "type": "string", "title": "City", "description": "City.", "examples": ["Bend"] }
        },
        "required": ["name", "country"],
        "examples": [{ "name": "Fresh Cascade Brewing", "country": "US", "city": "Bend" }]
      },
      "name": { "type": "string", "title": "Beer Name", "description": "Name of the beer being proposed.", "examples": ["Fresh Hops IPA"] },
      "style": { "type": "string", "title": "Style", "description": "Beer style.", "examples": ["IPA"] },
      "abv": { "type": "number", "title": "ABV", "description": "Alcohol by volume percent.", "examples": [6.8] },
      "description": { "type": "string", "title": "Description", "description": "Optional description.", "examples": ["Seasonal wet-hop IPA."] }
    },
    "required": ["name", "style"],
    "examples": [
      {
        "newBrewery": { "name": "Fresh Cascade Brewing", "country": "US", "city": "Bend" },
        "name": "Fresh Hops IPA",
        "style": "IPA",
        "abv": 6.8,
        "description": "Seasonal wet-hop IPA."
      }
    ]
  }
  ```

### actions.ProposeBeerOutput
- **Level:** embedded
- **Summary:** Result of proposing a new beer.
- **Description:** Output for `proposeBeer`. Returns the pending beer id and any newly-created brewery id.
- **JSON Schema:**
  ```json
  {
    "title": "Propose Beer Output",
    "description": "Output payload for the proposeBeer action.",
    "type": "object",
    "properties": {
      "beerId": { "type": "string", "title": "Beer ID", "description": "ID of the created pending beer.", "examples": ["beer_99AbCd"] },
      "breweryId": { "type": "string", "title": "Brewery ID", "description": "ID of the brewery (existing or newly created).", "examples": ["brw_NewXY"] }
    },
    "required": ["beerId", "breweryId"],
    "examples": [{ "beerId": "beer_99AbCd", "breweryId": "brw_NewXY" }]
  }
  ```

### actions.LogCheckInInput
- **Level:** embedded
- **Summary:** Payload to record a beer check-in.
- **Description:** Input for `logCheckIn`. The acting user's id is inferred from the authenticated session, not the payload.
- **JSON Schema:**
  ```json
  {
    "title": "Log Check-In Input",
    "description": "Input payload for the logCheckIn action.",
    "type": "object",
    "properties": {
      "beerId": { "type": "string", "title": "Beer ID", "description": "Reference to the catalog.Beer consumed.", "examples": ["beer_21QpzR"] },
      "rating": { "type": "integer", "title": "Rating", "description": "Optional 1-5 quick rating.", "minimum": 1, "maximum": 5, "examples": [4] },
      "note": { "type": "string", "title": "Note", "description": "Optional short note.", "maxLength": 280, "examples": ["Crisp and citrusy."] },
      "venue": { "type": "string", "title": "Venue", "description": "Optional venue.", "examples": ["Cascade Brewpub"] },
      "occurredAt": { "type": "string", "format": "date-time", "title": "Occurred At", "description": "Optional timestamp the user drank the beer; defaults to now.", "examples": ["2026-04-20T19:30:00Z"] }
    },
    "required": ["beerId"],
    "examples": [
      { "beerId": "beer_21QpzR", "rating": 4, "note": "Crisp and citrusy.", "venue": "Cascade Brewpub", "occurredAt": "2026-04-20T19:30:00Z" }
    ]
  }
  ```

### actions.LogCheckInOutput
- **Level:** embedded
- **Summary:** Result of logging a check-in.
- **Description:** Output for `logCheckIn`. Returns the check-in id and whether this was the user's first time with this beer (used to drive "first pour" UI).
- **JSON Schema:**
  ```json
  {
    "title": "Log Check-In Output",
    "description": "Output payload for the logCheckIn action.",
    "type": "object",
    "properties": {
      "checkInId": { "type": "string", "title": "Check-In ID", "description": "ID of the created social.CheckIn.", "examples": ["chk_AbCdEf"] },
      "isFirstTime": { "type": "boolean", "title": "Is First Time", "description": "True if the user has never checked in this beer before.", "examples": [true] },
      "uniqueBeerCount": { "type": "integer", "title": "Unique Beer Count", "description": "User's total unique-beer count after this check-in.", "examples": [47] }
    },
    "required": ["checkInId", "isFirstTime", "uniqueBeerCount"],
    "examples": [{ "checkInId": "chk_AbCdEf", "isFirstTime": true, "uniqueBeerCount": 47 }]
  }
  ```

### actions.UpsertReviewInput
- **Level:** embedded
- **Summary:** Payload to create or replace a review.
- **Description:** Input for `upsertReview`. Creates a new review or replaces the caller's existing review of the same beer.
- **JSON Schema:**
  ```json
  {
    "title": "Upsert Review Input",
    "description": "Input payload for the upsertReview action.",
    "type": "object",
    "properties": {
      "beerId": { "type": "string", "title": "Beer ID", "description": "Reference to the catalog.Beer being reviewed.", "examples": ["beer_21QpzR"] },
      "rating": { "type": "integer", "title": "Rating", "description": "Overall 1-5 rating.", "minimum": 1, "maximum": 5, "examples": [5] },
      "title": { "type": "string", "title": "Title", "description": "Review headline.", "examples": ["The benchmark American pale ale"] },
      "body": { "type": "string", "title": "Body", "description": "Prose body of the review.", "examples": ["Pine and grapefruit on the nose..."] },
      "aromaScore": { "type": "integer", "title": "Aroma Score", "description": "Optional aroma score 1-5.", "minimum": 1, "maximum": 5, "examples": [5] },
      "tasteScore": { "type": "integer", "title": "Taste Score", "description": "Optional taste score 1-5.", "minimum": 1, "maximum": 5, "examples": [5] }
    },
    "required": ["beerId", "rating", "body"],
    "examples": [
      { "beerId": "beer_21QpzR", "rating": 5, "title": "The benchmark American pale ale", "body": "Pine and grapefruit on the nose...", "aromaScore": 5, "tasteScore": 5 }
    ]
  }
  ```

### actions.UpsertReviewOutput
- **Level:** embedded
- **Summary:** Result of creating or updating a review.
- **Description:** Output for `upsertReview`. Indicates whether a new review was created or an existing one updated.
- **JSON Schema:**
  ```json
  {
    "title": "Upsert Review Output",
    "description": "Output payload for the upsertReview action.",
    "type": "object",
    "properties": {
      "reviewId": { "type": "string", "title": "Review ID", "description": "ID of the created or updated social.Review.", "examples": ["rev_12QwEr"] },
      "created": { "type": "boolean", "title": "Created", "description": "True if a new review was created; false if an existing one was updated.", "examples": [true] }
    },
    "required": ["reviewId", "created"],
    "examples": [{ "reviewId": "rev_12QwEr", "created": true }]
  }
  ```

### actions.SendFriendRequestInput
- **Level:** embedded
- **Summary:** Payload to send a friend request.
- **Description:** Input for `sendFriendRequest`. Target can be addressed by user id or by handle.
- **JSON Schema:**
  ```json
  {
    "title": "Send Friend Request Input",
    "description": "Input payload for the sendFriendRequest action.",
    "type": "object",
    "properties": {
      "toUserId": { "type": "string", "title": "To User ID", "description": "Target profile id. Provide this or toHandle.", "examples": ["usr_8Lq2nM"] },
      "toHandle": { "type": "string", "title": "To Handle", "description": "Target profile handle. Provide this or toUserId.", "examples": ["maya_ipa"] },
      "message": { "type": "string", "title": "Message", "description": "Optional note for the recipient.", "examples": ["Met you at the Fresh Hops fest!"] }
    },
    "examples": [{ "toHandle": "maya_ipa", "message": "Met you at the Fresh Hops fest!" }]
  }
  ```

### actions.SendFriendRequestOutput
- **Level:** embedded
- **Summary:** Result of sending a friend request.
- **Description:** Output for `sendFriendRequest`. Returns the resulting request id and its status (usually `pending`, but may be `accepted` if the target had already sent a matching request).
- **JSON Schema:**
  ```json
  {
    "title": "Send Friend Request Output",
    "description": "Output payload for the sendFriendRequest action.",
    "type": "object",
    "properties": {
      "friendRequestId": { "type": "string", "title": "Friend Request ID", "description": "ID of the created or resolved social.FriendRequest.", "examples": ["frq_PpQqRr"] },
      "status": { "type": "string", "title": "Status", "description": "Resulting status of the request.", "enum": ["pending", "accepted"], "examples": ["pending"] },
      "friendshipId": { "type": "string", "title": "Friendship ID", "description": "Present when status is accepted; id of the created social.Friendship.", "examples": ["frs_XYZ123"] }
    },
    "required": ["friendRequestId", "status"],
    "examples": [{ "friendRequestId": "frq_PpQqRr", "status": "pending" }]
  }
  ```

### actions.RespondToFriendRequestInput
- **Level:** embedded
- **Summary:** Payload to accept or decline a friend request.
- **Description:** Input for `respondToFriendRequest`.
- **JSON Schema:**
  ```json
  {
    "title": "Respond To Friend Request Input",
    "description": "Input payload for the respondToFriendRequest action.",
    "type": "object",
    "properties": {
      "friendRequestId": { "type": "string", "title": "Friend Request ID", "description": "Reference to the pending social.FriendRequest.", "examples": ["frq_PpQqRr"] },
      "decision": { "type": "string", "title": "Decision", "description": "Whether to accept or decline.", "enum": ["accept", "decline"], "examples": ["accept"] }
    },
    "required": ["friendRequestId", "decision"],
    "examples": [{ "friendRequestId": "frq_PpQqRr", "decision": "accept" }]
  }
  ```

### actions.RespondToFriendRequestOutput
- **Level:** embedded
- **Summary:** Result of responding to a friend request.
- **Description:** Output for `respondToFriendRequest`. When accepted, includes the new friendship id.
- **JSON Schema:**
  ```json
  {
    "title": "Respond To Friend Request Output",
    "description": "Output payload for the respondToFriendRequest action.",
    "type": "object",
    "properties": {
      "friendRequestId": { "type": "string", "title": "Friend Request ID", "description": "ID of the resolved friend request.", "examples": ["frq_PpQqRr"] },
      "status": { "type": "string", "title": "Status", "description": "New status of the request.", "enum": ["accepted", "declined"], "examples": ["accepted"] },
      "friendshipId": { "type": "string", "title": "Friendship ID", "description": "Present when accepted; id of the new social.Friendship.", "examples": ["frs_XYZ123"] }
    },
    "required": ["friendRequestId", "status"],
    "examples": [{ "friendRequestId": "frq_PpQqRr", "status": "accepted", "friendshipId": "frs_XYZ123" }]
  }
  ```

### actions.SendRecommendationInput
- **Level:** embedded
- **Summary:** Payload to recommend a beer to a friend.
- **Description:** Input for `sendRecommendation`.
- **JSON Schema:**
  ```json
  {
    "title": "Send Recommendation Input",
    "description": "Input payload for the sendRecommendation action.",
    "type": "object",
    "properties": {
      "toUserId": { "type": "string", "title": "To User ID", "description": "Recipient user id. Must be a confirmed friend of the caller.", "examples": ["usr_8Lq2nM"] },
      "beerId": { "type": "string", "title": "Beer ID", "description": "Beer being recommended.", "examples": ["beer_21QpzR"] },
      "message": { "type": "string", "title": "Message", "description": "Optional note for the recipient.", "maxLength": 500, "examples": ["You'll love this one."] }
    },
    "required": ["toUserId", "beerId"],
    "examples": [{ "toUserId": "usr_8Lq2nM", "beerId": "beer_21QpzR", "message": "You'll love this one." }]
  }
  ```

### actions.SendRecommendationOutput
- **Level:** embedded
- **Summary:** Result of sending a recommendation.
- **Description:** Output for `sendRecommendation`.
- **JSON Schema:**
  ```json
  {
    "title": "Send Recommendation Output",
    "description": "Output payload for the sendRecommendation action.",
    "type": "object",
    "properties": {
      "recommendationId": { "type": "string", "title": "Recommendation ID", "description": "ID of the created social.Recommendation.", "examples": ["rec_AaBbCc"] }
    },
    "required": ["recommendationId"],
    "examples": [{ "recommendationId": "rec_AaBbCc" }]
  }
  ```

### actions.UpdateRecommendationStatusInput
- **Level:** embedded
- **Summary:** Payload to update the recipient-side status of a recommendation.
- **Description:** Input for `updateRecommendationStatus`. Only the recipient can change status.
- **JSON Schema:**
  ```json
  {
    "title": "Update Recommendation Status Input",
    "description": "Input payload for the updateRecommendationStatus action.",
    "type": "object",
    "properties": {
      "recommendationId": { "type": "string", "title": "Recommendation ID", "description": "Reference to the social.Recommendation to update.", "examples": ["rec_AaBbCc"] },
      "status": { "type": "string", "title": "Status", "description": "New status.", "enum": ["seen", "saved", "tried", "dismissed"], "examples": ["tried"] }
    },
    "required": ["recommendationId", "status"],
    "examples": [{ "recommendationId": "rec_AaBbCc", "status": "tried" }]
  }
  ```

### actions.UpdateRecommendationStatusOutput
- **Level:** embedded
- **Summary:** Result of updating a recommendation status.
- **Description:** Output for `updateRecommendationStatus`.
- **JSON Schema:**
  ```json
  {
    "title": "Update Recommendation Status Output",
    "description": "Output payload for the updateRecommendationStatus action.",
    "type": "object",
    "properties": {
      "recommendationId": { "type": "string", "title": "Recommendation ID", "description": "ID of the recommendation that was updated.", "examples": ["rec_AaBbCc"] },
      "status": { "type": "string", "title": "Status", "description": "Persisted status after update.", "examples": ["tried"] }
    },
    "required": ["recommendationId", "status"],
    "examples": [{ "recommendationId": "rec_AaBbCc", "status": "tried" }]
  }
  ```

### actions.GetLeaderboardInput
- **Level:** embedded
- **Summary:** Payload to query a leaderboard.
- **Description:** Input for `getLeaderboard`. Chooses metric, scope (global vs friends), and time window.
- **JSON Schema:**
  ```json
  {
    "title": "Get Leaderboard Input",
    "description": "Input payload for the getLeaderboard action.",
    "type": "object",
    "properties": {
      "metric": {
        "type": "string",
        "title": "Metric",
        "description": "Which leaderboard to compute.",
        "enum": ["uniqueBeers", "totalCheckIns", "reviewsWritten", "recommendationsSent"],
        "examples": ["uniqueBeers"]
      },
      "scope": {
        "type": "string",
        "title": "Scope",
        "description": "Pool of users to rank across.",
        "enum": ["global", "friends"],
        "examples": ["friends"]
      },
      "window": {
        "type": "string",
        "title": "Window",
        "description": "Time window for the metric.",
        "enum": ["allTime", "year", "month", "week"],
        "examples": ["month"]
      },
      "limit": {
        "type": "integer",
        "title": "Limit",
        "description": "Maximum number of leaderboard rows to return.",
        "minimum": 1,
        "maximum": 100,
        "examples": [25]
      }
    },
    "required": ["metric", "scope", "window"],
    "examples": [{ "metric": "uniqueBeers", "scope": "friends", "window": "month", "limit": 25 }]
  }
  ```

### actions.GetLeaderboardOutput
- **Level:** embedded
- **Summary:** Leaderboard result rows.
- **Description:** Output for `getLeaderboard`. Ordered list of users with their score for the requested metric, and the caller's own rank if outside the top results.
- **JSON Schema:**
  ```json
  {
    "title": "Get Leaderboard Output",
    "description": "Output payload for the getLeaderboard action.",
    "type": "object",
    "properties": {
      "metric": { "type": "string", "title": "Metric", "description": "Echo of the requested metric.", "examples": ["uniqueBeers"] },
      "scope": { "type": "string", "title": "Scope", "description": "Echo of the requested scope.", "examples": ["friends"] },
      "window": { "type": "string", "title": "Window", "description": "Echo of the requested window.", "examples": ["month"] },
      "rows": {
        "type": "array",
        "title": "Rows",
        "description": "Ordered leaderboard entries, highest score first.",
        "items": {
          "type": "object",
          "title": "Leaderboard Row",
          "description": "One row of the leaderboard.",
          "properties": {
            "rank": { "type": "integer", "title": "Rank", "description": "1-based rank.", "examples": [1] },
            "userId": { "type": "string", "title": "User ID", "description": "Profile id of the ranked user.", "examples": ["usr_3Hp9xC"] },
            "displayName": { "type": "string", "title": "Display Name", "description": "Denormalized display name.", "examples": ["Beer Hunter Sam"] },
            "handle": { "type": "string", "title": "Handle", "description": "Denormalized handle.", "examples": ["sam_hops"] },
            "avatarUrl": { "type": "string", "title": "Avatar URL", "description": "Denormalized avatar url.", "examples": ["https://cdn.example.com/avatars/sam.png"] },
            "score": { "type": "number", "title": "Score", "description": "Metric value for this user.", "examples": [47] }
          },
          "required": ["rank", "userId", "displayName", "score"]
        },
        "examples": [[{ "rank": 1, "userId": "usr_3Hp9xC", "displayName": "Beer Hunter Sam", "handle": "sam_hops", "score": 47 }]]
      },
      "callerRank": {
        "type": "integer",
        "title": "Caller Rank",
        "description": "Caller's rank in the full leaderboard, even if outside the returned rows. Absent when caller is not in the scope.",
        "examples": [12]
      },
      "callerScore": {
        "type": "number",
        "title": "Caller Score",
        "description": "Caller's score. Absent when caller is not in the scope.",
        "examples": [19]
      }
    },
    "required": ["metric", "scope", "window", "rows"],
    "examples": [
      {
        "metric": "uniqueBeers",
        "scope": "friends",
        "window": "month",
        "rows": [
          { "rank": 1, "userId": "usr_3Hp9xC", "displayName": "Beer Hunter Sam", "handle": "sam_hops", "score": 47 },
          { "rank": 2, "userId": "usr_8Lq2nM", "displayName": "Maya IPA", "handle": "maya_ipa", "score": 31 }
        ],
        "callerRank": 2,
        "callerScore": 31
      }
    ]
  }
  ```

### actions.GetFriendsFeedInput
- **Level:** embedded
- **Summary:** Payload to fetch the friends activity feed.
- **Description:** Input for `getFriendsFeed`. Paginated by cursor over recent check-ins, reviews, and recommendations from the caller's friends.
- **JSON Schema:**
  ```json
  {
    "title": "Get Friends Feed Input",
    "description": "Input payload for the getFriendsFeed action.",
    "type": "object",
    "properties": {
      "cursor": { "type": "string", "title": "Cursor", "description": "Opaque cursor from a previous response. Omit for the first page.", "examples": ["eyJ0Ijoi..."] },
      "limit": { "type": "integer", "title": "Limit", "description": "Max entries to return.", "minimum": 1, "maximum": 100, "examples": [20] }
    },
    "examples": [{ "limit": 20 }]
  }
  ```

### actions.GetFriendsFeedOutput
- **Level:** embedded
- **Summary:** Friends feed page.
- **Description:** Output for `getFriendsFeed`. A merged, time-ordered stream of check-in, review, and recommendation entries from the caller's friends.
- **JSON Schema:**
  ```json
  {
    "title": "Get Friends Feed Output",
    "description": "Output payload for the getFriendsFeed action.",
    "type": "object",
    "properties": {
      "entries": {
        "type": "array",
        "title": "Entries",
        "description": "Feed entries in reverse chronological order.",
        "items": {
          "type": "object",
          "title": "Feed Entry",
          "description": "One item in the feed, discriminated by kind.",
          "properties": {
            "kind": { "type": "string", "title": "Kind", "description": "Type of activity.", "enum": ["checkIn", "review", "recommendation"], "examples": ["checkIn"] },
            "occurredAt": { "type": "string", "format": "date-time", "title": "Occurred At", "description": "When the activity happened.", "examples": ["2026-04-20T19:30:00Z"] },
            "actorUserId": { "type": "string", "title": "Actor User ID", "description": "User who performed the activity.", "examples": ["usr_3Hp9xC"] },
            "actorDisplayName": { "type": "string", "title": "Actor Display Name", "description": "Denormalized display name.", "examples": ["Beer Hunter Sam"] },
            "beerId": { "type": "string", "title": "Beer ID", "description": "Beer the activity is about.", "examples": ["beer_21QpzR"] },
            "beerName": { "type": "string", "title": "Beer Name", "description": "Denormalized beer name.", "examples": ["Pale Ale"] },
            "sourceId": { "type": "string", "title": "Source ID", "description": "ID of the underlying check-in, review, or recommendation.", "examples": ["chk_AbCdEf"] },
            "summary": { "type": "string", "title": "Summary", "description": "Short textual summary for display.", "examples": ["Sam checked in Pale Ale at Cascade Brewpub."] }
          },
          "required": ["kind", "occurredAt", "actorUserId", "beerId", "sourceId"]
        },
        "examples": [[
          { "kind": "checkIn", "occurredAt": "2026-04-20T19:30:00Z", "actorUserId": "usr_3Hp9xC", "actorDisplayName": "Beer Hunter Sam", "beerId": "beer_21QpzR", "beerName": "Pale Ale", "sourceId": "chk_AbCdEf", "summary": "Sam checked in Pale Ale at Cascade Brewpub." }
        ]]
      },
      "nextCursor": { "type": "string", "title": "Next Cursor", "description": "Opaque cursor for the next page. Absent when there are no more entries.", "examples": ["eyJ0Ijoi..."] }
    },
    "required": ["entries"],
    "examples": [
      {
        "entries": [
          { "kind": "checkIn", "occurredAt": "2026-04-20T19:30:00Z", "actorUserId": "usr_3Hp9xC", "actorDisplayName": "Beer Hunter Sam", "beerId": "beer_21QpzR", "beerName": "Pale Ale", "sourceId": "chk_AbCdEf", "summary": "Sam checked in Pale Ale at Cascade Brewpub." }
        ],
        "nextCursor": "eyJ0Ijoi..."
      }
    ]
  }
  ```

## Embeddings

| Parent class | Field | Form | Embedded class |
|---|---|---|---|
| *(none)* | — | — | — |

No embeddings in the domain model. The design is deliberately flat: each class is independently queryable, and cross-references are plain id strings. (Action I/O classes contain inline object properties that aren't worth promoting to their own named classes — e.g., `ProposeBeerInput.newBrewery`, `GetLeaderboardOutput.rows[]`.)

## References

| Class | Field | Points to |
|---|---|---|
| catalog.Beer | breweryId | catalog.Brewery._id |
| social.Friendship | userIdA | social.UserProfile._id |
| social.Friendship | userIdB | social.UserProfile._id |
| social.FriendRequest | fromUserId | social.UserProfile._id |
| social.FriendRequest | toUserId | social.UserProfile._id |
| social.CheckIn | userId | social.UserProfile._id |
| social.CheckIn | beerId | catalog.Beer._id |
| social.Review | userId | social.UserProfile._id |
| social.Review | beerId | catalog.Beer._id |
| social.Recommendation | fromUserId | social.UserProfile._id |
| social.Recommendation | toUserId | social.UserProfile._id |
| social.Recommendation | beerId | catalog.Beer._id |

## Relations

| Relation | Source | Source field | Target | Target field |
|---|---|---|---|---|
| beer-brewery | catalog.Beer | breweryId | catalog.Brewery | _id |
| friendship-userA | social.Friendship | userIdA | social.UserProfile | _id |
| friendship-userB | social.Friendship | userIdB | social.UserProfile | _id |
| friendrequest-from | social.FriendRequest | fromUserId | social.UserProfile | _id |
| friendrequest-to | social.FriendRequest | toUserId | social.UserProfile | _id |
| checkin-user | social.CheckIn | userId | social.UserProfile | _id |
| checkin-beer | social.CheckIn | beerId | catalog.Beer | _id |
| review-user | social.Review | userId | social.UserProfile | _id |
| review-beer | social.Review | beerId | catalog.Beer | _id |
| recommendation-from | social.Recommendation | fromUserId | social.UserProfile | _id |
| recommendation-to | social.Recommendation | toUserId | social.UserProfile | _id |
| recommendation-beer | social.Recommendation | beerId | catalog.Beer | _id |

## Actions

### registerProfile
- **Summary:** Create the caller's user profile.
- **Description:** Creates the social.UserProfile for the currently authenticated user. Enforces that no existing profile is linked to the caller's auth id and that the requested `handle` is not already taken. Idempotent failure if re-called by the same auth user.
- **Target:** system
- **Input class:** actions.RegisterProfileInput
- **Output class:** actions.RegisterProfileOutput
- **Example invocation:**
  ```json
  {
    "input": { "displayName": "Beer Hunter Sam", "handle": "sam_hops", "bio": "Hop-forward IPAs and sour ales.", "homeCity": "Portland, OR" },
    "output": { "userId": "usr_3Hp9xC" }
  }
  ```

### proposeBeer
- **Summary:** Submit a new beer to the catalog.
- **Description:** Creates a catalog.Beer with `status: pending`. If `newBrewery` is supplied, creates a pending catalog.Brewery in the same action so the caller does not need to orchestrate two CRUD calls. Enforces that exactly one of `breweryId` or `newBrewery` is provided.
- **Target:** catalog.Beer
- **Input class:** actions.ProposeBeerInput
- **Output class:** actions.ProposeBeerOutput
- **Example invocation:**
  ```json
  {
    "input": {
      "newBrewery": { "name": "Fresh Cascade Brewing", "country": "US", "city": "Bend" },
      "name": "Fresh Hops IPA",
      "style": "IPA",
      "abv": 6.8,
      "description": "Seasonal wet-hop IPA."
    },
    "output": { "beerId": "beer_99AbCd", "breweryId": "brw_NewXY" }
  }
  ```

### logCheckIn
- **Summary:** Record a beer check-in.
- **Description:** Creates a social.CheckIn for the caller against a specific beer. Rejects the call if the beer's `status` is not `approved`. Computes and returns whether this is the user's first check-in for the beer and their running unique-beer total, so the client does not have to aggregate.
- **Target:** social.CheckIn
- **Input class:** actions.LogCheckInInput
- **Output class:** actions.LogCheckInOutput
- **Example invocation:**
  ```json
  {
    "input": { "beerId": "beer_21QpzR", "rating": 4, "note": "Crisp and citrusy.", "venue": "Cascade Brewpub", "occurredAt": "2026-04-20T19:30:00Z" },
    "output": { "checkInId": "chk_AbCdEf", "isFirstTime": true, "uniqueBeerCount": 47 }
  }
  ```

### upsertReview
- **Summary:** Create or update the caller's review of a beer.
- **Description:** Guarantees at most one social.Review per (user, beer) pair. Creates a new review if none exists for the caller and beer, otherwise overwrites the existing body, rating, and scores and bumps `updatedAt`. Rejects if the beer is not approved.
- **Target:** social.Review
- **Input class:** actions.UpsertReviewInput
- **Output class:** actions.UpsertReviewOutput
- **Example invocation:**
  ```json
  {
    "input": { "beerId": "beer_21QpzR", "rating": 5, "title": "The benchmark American pale ale", "body": "Pine and grapefruit on the nose...", "aromaScore": 5, "tasteScore": 5 },
    "output": { "reviewId": "rev_12QwEr", "created": true }
  }
  ```

### sendFriendRequest
- **Summary:** Send a friend request to another user.
- **Description:** Creates a social.FriendRequest from the caller to the target. Rejects self-requests, duplicate pending requests from the caller, and requests to users who are already friends with the caller. If a reciprocal pending request already exists from target to caller, short-circuits by accepting it and creating a social.Friendship; the returned `status` reflects which path was taken.
- **Target:** social.FriendRequest
- **Input class:** actions.SendFriendRequestInput
- **Output class:** actions.SendFriendRequestOutput
- **Example invocation:**
  ```json
  {
    "input": { "toHandle": "maya_ipa", "message": "Met you at the Fresh Hops fest!" },
    "output": { "friendRequestId": "frq_PpQqRr", "status": "pending" }
  }
  ```

### respondToFriendRequest
- **Summary:** Accept or decline a friend request.
- **Description:** Transitions a pending social.FriendRequest to `accepted` or `declined`. On acceptance, atomically creates a social.Friendship with the two user ids in canonical order. Rejects if the caller is not the request's recipient or if the request is not `pending`.
- **Target:** social.FriendRequest
- **Input class:** actions.RespondToFriendRequestInput
- **Output class:** actions.RespondToFriendRequestOutput
- **Example invocation:**
  ```json
  {
    "input": { "friendRequestId": "frq_PpQqRr", "decision": "accept" },
    "output": { "friendRequestId": "frq_PpQqRr", "status": "accepted", "friendshipId": "frs_XYZ123" }
  }
  ```

### sendRecommendation
- **Summary:** Recommend a beer to a friend.
- **Description:** Creates a social.Recommendation with `status: unseen`. Enforces that sender and recipient are currently friends (a social.Friendship exists between them) and that the beer is approved. Only one unseen recommendation of the same beer from the same sender to the same recipient is allowed; re-sending the same beer updates the existing recommendation's `sentAt` and message rather than creating a duplicate.
- **Target:** social.Recommendation
- **Input class:** actions.SendRecommendationInput
- **Output class:** actions.SendRecommendationOutput
- **Example invocation:**
  ```json
  {
    "input": { "toUserId": "usr_8Lq2nM", "beerId": "beer_21QpzR", "message": "You'll love this one." },
    "output": { "recommendationId": "rec_AaBbCc" }
  }
  ```

### updateRecommendationStatus
- **Summary:** Update the status of a received recommendation.
- **Description:** Sets the recipient-controlled status of a social.Recommendation. Rejects if the caller is not the recipient, or if the transition is invalid (e.g., from `dismissed` back to `unseen`). Sets `resolvedAt` on first non-`unseen` transition.
- **Target:** social.Recommendation
- **Input class:** actions.UpdateRecommendationStatusInput
- **Output class:** actions.UpdateRecommendationStatusOutput
- **Example invocation:**
  ```json
  {
    "input": { "recommendationId": "rec_AaBbCc", "status": "tried" },
    "output": { "recommendationId": "rec_AaBbCc", "status": "tried" }
  }
  ```

### getLeaderboard
- **Summary:** Compute a leaderboard for a given metric and scope.
- **Description:** Aggregates the requested metric over the requested scope (all users or the caller's friends) and time window, ranks the users, and returns a capped list of rows plus the caller's own rank and score. Denormalizes display fields onto each row so the client does not need a second round-trip per user.
- **Target:** system
- **Input class:** actions.GetLeaderboardInput
- **Output class:** actions.GetLeaderboardOutput
- **Example invocation:**
  ```json
  {
    "input": { "metric": "uniqueBeers", "scope": "friends", "window": "month", "limit": 25 },
    "output": {
      "metric": "uniqueBeers",
      "scope": "friends",
      "window": "month",
      "rows": [
        { "rank": 1, "userId": "usr_3Hp9xC", "displayName": "Beer Hunter Sam", "handle": "sam_hops", "score": 47 },
        { "rank": 2, "userId": "usr_8Lq2nM", "displayName": "Maya IPA", "handle": "maya_ipa", "score": 31 }
      ],
      "callerRank": 2,
      "callerScore": 31
    }
  }
  ```

### getFriendsFeed
- **Summary:** Fetch the caller's friends activity feed.
- **Description:** Returns a unified, reverse-chronological page of check-ins, reviews, and recommendations authored by the caller's friends. Denormalizes actor and beer display fields per entry so the client renders without follow-up queries. Paginated with an opaque cursor.
- **Target:** system
- **Input class:** actions.GetFriendsFeedInput
- **Output class:** actions.GetFriendsFeedOutput
- **Example invocation:**
  ```json
  {
    "input": { "limit": 20 },
    "output": {
      "entries": [
        { "kind": "checkIn", "occurredAt": "2026-04-20T19:30:00Z", "actorUserId": "usr_3Hp9xC", "actorDisplayName": "Beer Hunter Sam", "beerId": "beer_21QpzR", "beerName": "Pale Ale", "sourceId": "chk_AbCdEf", "summary": "Sam checked in Pale Ale at Cascade Brewpub." }
      ],
      "nextCursor": "eyJ0Ijoi..."
    }
  }
  ```

## Design decisions

1. **Two domain namespaces (`catalog`, `social`).** The catalog is mostly-read and admin-moderated; the social graph is high-write and per-user. Splitting now avoids future renames and makes permissions easier to reason about. Single domain namespace would also have worked; this is a bet that the app will grow, not shrink.

2. **`CheckIn` and `Review` as separate classes.** A check-in is an event (many per user-beer, feeds leaderboards and the activity feed). A review is a document (one per user-beer, edited over time). Collapsing them would force awkward compromises on either the leaderboard (which wants raw events) or the review UI (which wants a single record). The cost is two classes and two actions instead of one.

3. **`Friendship` with canonical-ordered user ids, instead of two per-user-edge rows.** One document per pair, with `userIdA < userIdB`, makes "are X and Y friends?" a single lookup and eliminates divergence between the two directions. The action layer does the sort; the schema just stores it. Trade-off: neither `userIdA` nor `userIdB` alone is "the friend of the caller", so queries for "my friends" require OR-ing two fields (or a `getFriends` action that denormalizes).

4. **Leaderboard as an action, not a persisted class.** Rankings are derivable from check-ins/reviews/recommendations; persisting them invites staleness. `getLeaderboard` computes on demand with denormalized display fields baked into the response. If later profiling shows this is too expensive, we can introduce a materialized `LeaderboardSnapshot` top-level class without reshaping the primary model.

5. **Activity feed as an action, not a persisted class.** Same reasoning as the leaderboard: the feed is a query over friends' recent records, not its own entity. `getFriendsFeed` merges three sources server-side. If fan-out-on-write becomes necessary at scale, a `FeedEntry` class can be added later.

6. **`Recommendation.status` owned by the recipient only.** Senders cannot "revoke" a recommendation once sent (they can only re-send with an updated message, which upserts). Keeps the state machine small and the invariants clear.

## Open questions

- Do you want **private profiles / friends-only visibility**, or is all review/check-in data public to anyone with the app? This affects whether `getFriendsFeed` is the *only* feed or just *a* feed, and whether `scope: "global"` on the leaderboard is acceptable.
- Should users be able to **like or comment on** check-ins and reviews? If yes, add `CheckInReaction` / `ReviewComment` classes. Deliberately excluded for v1.
- Is there an **admin role** in v1 that approves pending beers/breweries, or do we defer moderation (pending items simply aren't shown) until later? If admin exists, we likely need an `approveBeer` / `rejectBeer` action pair.
- Should **leaderboard scope** include "followers of a specific brewery" or "beer-style-specific" rankings? Currently only `global` and `friends`; adding more is a one-enum change but I want to confirm scope before committing.
- Do check-ins need **geolocation** (lat/long) beyond the free-text `venue`? Adds a bit to `CheckIn` and enables "nearby activity" features later.
- Is there a **minimum-age gate** required at profile registration (alcohol app)? If yes, `registerProfile` needs a date-of-birth input and a server-side age check.

Relevant file path for this session: `/workspace/CLAUDE.md` (project instructions consulted).
agentId: aaead8ab821c0abb8 (use SendMessage with to: 'aaead8ab821c0abb8' to continue this agent)
<usage>total_tokens: 35204
tool_uses: 0
duration_ms: 244117</usage>
