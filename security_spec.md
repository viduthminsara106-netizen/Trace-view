# Security Specification (`security_spec.md`)

## 1. Data Invariants

1. **Authentication & Verification Invariant**: Every read (`get`, `list`) and write (`create`, `update`, `delete`) operation on `/activities/{activityId}` requires an authenticated user (`request.auth != null`) with a verified email (`request.auth.token.email_verified == true`).
2. **Ownership & Isolation Invariant**: An `ActivityItem` document can only be created, read, listed, updated, or deleted by the user whose `request.auth.uid` strictly matches `userId`. Cross-user reads or writes are strictly forbidden.
3. **Path Variable Hardening Invariant**: Every single-document operation (`get`, `create`, `update`, `delete`) must validate `isValidId(activityId)` (`id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\-]+$')`).
4. **Strict Key & Volumetric Boundary Invariant**: All required keys must be present, only allowlisted keys are permitted (`hasOnly`), and every string field is bounded by its exact `maxLength` defined in `firebase-blueprint.json`.
5. **Immutability & Temporal Integrity Invariant**: `userId` and `createdAt` are immutable after document creation. `createdAt` (on create) and `updatedAt` (on create and update) must equal `request.time`.

## 2. The "Dirty Dozen" Payloads

1. **Unauthenticated Write**: Creating an activity item with `request.auth == null`.
2. **Unverified Email Spoof**: Creating or reading an activity item when `request.auth.token.email_verified == false`.
3. **Cross-User Identity Spoofing on Create**: User `uid_A` creates an activity document with `userId: "uid_B"`.
4. **Shadow / Ghost Field Injection on Create**: Payload includes all required fields plus `isAdmin: true`.
5. **ID Poisoning Attack**: Creating a document at `/activities/invalid$id!@#` or an ID exceeding 128 characters.
6. **Denial-of-Wallet Oversized String**: Creating an activity item where `url` exceeds 2000 characters or `title` exceeds 300 characters.
7. **Invalid Enum Injection**: Creating an activity item with `category: "hacked"` or `source: "unknown_source"`.
8. **Negative or Overflow Numeric Values**: Creating an activity item with `visitCount: -5` or `durationSec: 999999999`.
9. **Spoofed Client Timestamp on Create**: Setting `createdAt` to a past/future timestamp instead of `request.time`.
10. **Immutable Field Mutation on Update**: Updating an existing activity document to change `userId` or `createdAt`.
11. **Unauthorized Field Mutation on Update**: Updating `url` or `domain` outside the permitted action-based `affectedKeys().hasOnly(...)` gates.
12. **Blanket List Query Scraping**: Listing `/activities` without constraining `resource.data.userId == request.auth.uid`.
