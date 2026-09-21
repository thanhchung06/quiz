# Contract: Local Backup Export/Import Format

Implements FR-052 (independent of and in addition to Google Sheets sync — a backup restores a complete local installation with no network involved).

## Envelope

```json
{
  "formatVersion": "1.0",
  "appVersion": "string",
  "localSchemaVersion": 1,
  "exportedAt": "ISO-8601 datetime",
  "exportedByDeviceId": "string",
  "data": {
    "profiles": [ "...Profile records, credential field EXCLUDED..." ],
    "categories": [ "...Category records..." ],
    "quizItems": [ "...QuizItem records..." ],
    "exercises": [ "...Exercise + embedded ExerciseItem records..." ],
    "assignments": [ "...Assignment records..." ],
    "rotations": [ "...Rotation records..." ],
    "attempts": [ "...Attempt records, including exerciseSnapshot..." ],
    "answerResults": [ "...AnswerResult records..." ],
    "rewards": [ "...Reward records..." ],
    "deletedRecords": [ "...tombstones, per FR-064..." ]
  },
  "mediaReferences": [
    { "id": "string", "kind": "image | audio", "checksum": "string", "sizeBytes": 0 }
  ]
}
```

Notes:
- `profiles[].credential` (child PINs, parent password) is never included in an export (same rule as sync, FR-066) — on import, existing local credentials are kept unless the parent explicitly re-sets them afterward.
- `mediaReferences` lists what cached media the backup expects; actual binary media travels alongside the JSON file (e.g., in a zip) or is expected to already be cached locally — the JSON itself never embeds binary media.
- `localSchemaVersion` and `appVersion` are checked before import; an incompatible/newer schema fails the import with a clear message rather than partially applying it.

## Import behavior (FR-052)

1. Validate `formatVersion` and `localSchemaVersion` compatibility.
2. Validate the full `data` payload against this contract's schema (structurally, the same validation approach as the quiz-package format).
3. Show the parent a summary (counts per collection) and require explicit confirmation before replacing any current local data.
4. Replace local IndexedDB contents with the backup's `data` in a single local transaction (all-or-nothing) — a failure partway through must not leave a half-restored database.
5. Existing device credentials are preserved (see note above); everything else — quiz bank, exercises, assignments, rotations, attempts, rewards — matches the exported source exactly (SC-011).

## Reset-all-data flow (FR-053)

A destructive reset (distinct from import) requires: parent login → explicit warning screen recommending a backup first → a second explicit confirmation → then, and only then, clearing all local collections and re-seeding the three fixed Profile records with default (unset) credentials.
