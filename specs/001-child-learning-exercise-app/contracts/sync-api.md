# Contract: Google Apps Script Sync Endpoint

This is the only network contract the app has, and it exists solely to implement FR-054–066 (optional Google Sheets synchronization). It is a single Web App exposing one `doPost` entry point. There is no `doGet` data API — reads happen only as part of a sync request/response cycle, never as ad hoc queries, so the spreadsheet cannot be scraped as a general backend.

## Transport

- **Endpoint**: one Apps Script Web App deployment URL. The script is **container-bound** to exactly one spreadsheet (created via that Sheet's own Extensions > Apps Script menu) and reads it with `SpreadsheetApp.getActiveSpreadsheet()` — never `openById`, and never any spreadsheet ID a request might send. This keeps the OAuth scope the script needs down to `spreadsheets.currentonly` ("only this spreadsheet") rather than the broad all-Sheets scope `openById` would require, and means the script is structurally unable to touch any other spreadsheet regardless of what a caller claims.
- **Method**: `POST` only, `Content-Type: application/json`.
- **Auth**: a shared secret (`sharedSecret`) generated at setup time and stored in the script's Script Properties. Apps Script Web Apps have no clean way to verify an arbitrary Google OAuth bearer token, so real user identity is not attempted — the secret is the sole caller-auth gate, layered on top of the spreadsheet-binding restriction above.

## Request envelope

```json
{
  "syncId": "uuid",
  "deviceId": "string",
  "sharedSecret": "string — must match the script's Script Property SHARED_SECRET",
  "startedAt": "ISO-8601 datetime",
  "lastKnownDataRevision": 42,
  "action": "SYNC_NORMAL | REPLACE_GOOGLE_WITH_LOCAL | REPLACE_LOCAL_WITH_GOOGLE | RESOLVE_CONFLICT",
  "changes": [
    {
      "changeGroupId": "uuid",
      "entityType": "Profile | Category | QuizItem | QuizChoice | Exercise | ExerciseItem | Assignment | Rotation | Attempt | AnswerResult | Reward | DeletedRecord",
      "entityId": "uuid",
      "localVersion": 3,
      "lastGoogleVersion": 2,
      "operation": "upsert | delete",
      "payload": { "...entity fields, excluding credentials..." }
    }
  ],
  "conflictResolutions": [
    { "entityType": "QuizItem", "entityId": "uuid", "resolution": "useLocal | useGoogle | keepBoth", "payload": { "...only for keepBoth, the new local record..." } }
  ]
}
```

Notes:
- `changes` groups related records under the same `changeGroupId` so they commit/reject atomically (FR-060) — e.g., an Exercise plus its ExerciseItems.
- `conflictResolutions` is populated only when `action = RESOLVE_CONFLICT`, one entry per previously-flagged conflicting record.
- Fields excluded from every payload, per FR-066: `Profile.credential`, any Google OAuth token, and any purely local UI/cache state.

## Response envelope

```json
{
  "syncId": "uuid",
  "result": "SYNC_SUCCESS | SYNC_BUSY | SYNC_REJECTED",
  "commitSequence": 43,
  "committedChangeGroupIds": ["uuid"],
  "conflicts": [
    { "entityType": "QuizItem", "entityId": "uuid", "localVersion": 3, "googleVersion": 5, "lastGoogleVersion": 2 }
  ],
  "downloads": [
    { "entityType": "QuizItem", "entityId": "uuid", "version": 5, "payload": { } }
  ],
  "schemaCompatible": true
}
```

## Server-side algorithm (implements FR-057–061, FR-065; mirrors SYNC 01–06)

0. Compare `sharedSecret` against the script's `SHARED_SECRET` Script Property; mismatch → `{ result: "SYNC_REJECTED" }` before anything else runs.
1. Attempt `LockService.getScriptLock()` with a short timeout.
   - On failure to acquire: return `{ result: "SYNC_BUSY" }` immediately, no changes applied, no versions read. **Only the lock owner may ever return `SYNC_SUCCESS`.**
2. Check `Metadata.googleSchemaVersion` against the client's declared supported schema version; if the Google side is newer than supported, return `{ result: "SYNC_REJECTED", schemaCompatible: false }` and release the lock (FR-065).
3. Look up `syncId` in `SyncTransactions`. If a transaction with this `syncId` is already `Committed`, return that transaction's original stored result verbatim (no re-application) — this is the entire idempotent-retry behavior (FR-059) — then release the lock.
4. Read current Google versions for every `entityId` referenced in `changes`/`conflictResolutions`.
5. Re-evaluate each change against the version rules (see data-model.md §0 / spec FR-057):
   - `L = B, G = B` → no-op.
   - `L > B, G = B` → accept upload.
   - `L = B, G > B` → reject this change and include it in `downloads` instead.
   - `L != B, G != B` → conflict; exclude the entire `changeGroupId` from commit and include it in `conflicts`.
   - `L < B` or `G < B` → reject the whole batch with `SYNC_REJECTED` (invalid version state; requires manual repair).
6. If any `changeGroupId` contains a blocking conflict, that whole group is excluded from the commit (FR-060); other, unrelated groups may still commit.
7. Apply all accepted upserts/deletes (deletes become tombstones in `DeletedRecords`, not row removal — FR-064), flush the spreadsheet, and set every applied record's Google version to one greater than its previous value.
8. Write a `SyncTransactions` row with `status = Committed`, the final `commitSequence` (global data revision incremented by exactly 1), and the full response payload (so step 3 can replay it later).
9. Release the lock in a `finally` block, whether or not the above succeeded.

## Conflict resolution follow-up request

When the client-side parent chooses Use Local / Use Google / Keep Both (FR-061), it sends a second request with `action = RESOLVE_CONFLICT` and `conflictResolutions` populated. The server computes `resolvedVersion = max(localVersion, googleVersion) + 1` for `useLocal`/`useGoogle`, and for `keepBoth` inserts the local content as a brand-new record with a new UUID while leaving the original Google record untouched — never a merge of field-level content.

## Failure modes the client must handle without losing local data

- Network unreachable → local changes remain `pendingUpload`; no retry loop blocks child login or play (FR-055).
- `SYNC_BUSY` → local changes remain pending; client may retry after a randomized backoff.
- `SYNC_REJECTED` (schema too new) → automatic sync disables itself until the app is updated; manual sync actions surface a clear message.
- Conflicts present in the response → automatic sync pauses entirely (not just for the conflicting records) until the parent resolves every listed conflict (FR-061).
