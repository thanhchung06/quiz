# Contract: Local Backup Export/Import Format

Implements FR-052 (independent of and in addition to Google Sheets sync — a backup restores a complete local installation with no network involved).

## Envelope (format 2.0 — the sync redesign, specs/002-sync-data-redesign)

```json
{
  "formatVersion": "2.0",
  "exportedAt": "ISO-8601 datetime",
  "exportedByDeviceId": "string",
  "data": {
    "profiles": [ "...Profile records (password included, totalPoints)..." ],
    "categories": [ "...Category records..." ],
    "quizItems": [ "...QuizItem records..." ],
    "exercises": [ "...Exercise records..." ],
    "assignments": [ "...Assignment records, each with its exerciseSnapshot and tries..." ],
    "sessions": [ "...PlaySession records (one ongoing exercise per child)..." ],
    "results": [ "...PlayResult records (the last 1000 finished tries, full detail)..." ],
    "historyResults": [ "...HistoryResult records (every finished try, short)..." ],
    "pointUsages": [ "...PointUsage records..." ]
  }
}
```

Types: `BackupEnvelope` in `src/app/features/backup/services/backup-format.ts`.

### Older files (format 1.0)

Still importable, converted by `convertLegacyBackup`: profiles, categories, questions and exercises are kept
(the old sync fields dropped; a profile keeps the password this device has for it); finished attempts +
answers become HistoryResult (all) and Result (newest 1000) with stars and points by the new rules;
point redemptions become PointUsage; assignments, rotations, rewards and tombstones are dropped. Total
points are recomputed after import.

## Import behavior (FR-052)

1. Accept `formatVersion` "2.0", or "1.0" (converted, see above); anything else fails with a clear message.
2. Show the parent a summary (counts per collection) and require explicit confirmation before replacing any current local data.
3. Replace local IndexedDB contents with the backup's `data` in a single local transaction (all-or-nothing) — a failure partway through must not leave a half-restored database.
4. A profile without a password in the file keeps this device's; everything else matches the file exactly (SC-011). With sync on, the imported data is then sent to Google ("Máy này → Google").

## Reset-all-data flow (FR-053)

A destructive reset (distinct from import) requires: parent login → explicit warning screen recommending a backup first → a second explicit confirmation → then, and only then, clearing all local collections and re-seeding the three fixed Profile records with their default passwords. Google is not touched.
