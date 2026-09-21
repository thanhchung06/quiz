# Data Model: Child Learning Exercise Application

Source: spec.md Key Entities, Functional Requirements, and Edge Cases. Every synchronizable entity carries the sync envelope fields described in §0; entities that are purely local (device settings) do not.

## 0. Shared sync envelope

Applied to every entity below marked **(synced)**:

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Permanent identifier; stable across devices and sync. |
| `localVersion` | integer | Incremented on every local write; never reset. |
| `lastGoogleVersion` | integer | The Google version last confirmed equal to local, per FR-057. |
| `syncStatus` | enum: `synced`, `pendingUpload`, `conflict` | Derived, not independently authored. |
| `updatedAt` | ISO datetime | Device-local timestamp of last write. |
| `updatedByDeviceId` | string | Device that made the last local write. |
| `deletedAt` | ISO datetime, optional | Presence marks a tombstoned (soft-deleted) record; see DeletedRecord (§11). |

## 1. Profile

Represents Child One, Child Two, or Parent (FR-001–006).

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `role` | enum: `child`, `parent` | |
| `displayName` | string | Editable by parent (FR-006). |
| `avatar` | string (asset key) | |
| `credential` | hashed password, `parent` role only | Never synchronized (FR-066). A `child` profile has no credential at all — login is avatar selection alone (FR-002, amended 2026-09-18; this field is simply absent/unused for `child` rows). |
| `grade` | integer 1–5, optional (parent has none) | Informational only; never restricts assignment (FR-033). |
| `preferences` | object (audio, reduced motion, feedback delay) | Local-only fields may live here or in AppSettings; see §9. |
| `createdAt` | ISO datetime | |

**(synced)** — display/avatar/grade sync; `credential` is excluded from the synchronized payload at the mapping layer.

Validation: exactly 3 Profile records exist for the app's lifetime (2 `child` + 1 `parent`); no create/delete UI is exposed for Profile (FR-001, Assumptions).

## 2. Category

Parent-defined grouping (FR-022–024).

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `name` | string | Parent-facing. |
| `normalizedName` | string | Trimmed/lowercased; used for duplicate detection. |
| `subject` | enum: `math`, `language` | |
| `description` | string, optional | |
| `color`, `icon` | string, optional | |
| `status` | enum: `active`, `archived` | |

**(synced)**

Validation: `(normalizedName, subject)` unique among non-deleted categories. Merge operation: reassign all `QuizItem.categoryId` referencing the losing category to the winning category's `id` as one change group (FR-022, mirrors SYNC 06's `changeGroupId`).

## 3. QuizItem

One reusable question (FR-017–021, FR-025–030).

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `externalId` | string, optional | Set on AI-imported items for duplicate detection (FR-026). |
| `subject` | enum: `math`, `language` | |
| `grade` | integer 1–5 | Informational; not enforced against a child's own grade. |
| `type` | enum: `single-choice`, `short-text`, `number`, `multiple-choice`, `true-false`, `match-pairs` | First three are the MVP set (FR-018). |
| `prompt` | string | |
| `choices` | array of `{id, text}` | Only for choice-based types; `id` is the stable reference used everywhere else (never array position). |
| `answerRule` | type-specific (correct choice id(s), accepted text with case/punctuation sensitivity, numeric value/range, boolean, pair mapping) | Validated at save time (FR-017). |
| `explanation` | string, optional | |
| `media` | `{imageRef?, audioRef?}` | Local cache references; optional Drive file ID + checksum when mirrored (FR-066). |
| `tags` | string[] | |
| `difficulty` | integer 1–5, named: 1=Dễ, 2=Trung bình, 3=Khó, 4=Rất khó, 5=Chuyên gia | Default 2/Trung bình wherever unset (FR-017, amended 2026-09-18 — was 1–3, unnamed; amended again the same day so every *read* of this field — editing, difficulty-range matching, bulk-add pool matching, display — defaults a legacy missing value to 2, not only creation/import). `difficultyLabel()` (`src/app/shared/difficulty.ts`) itself now accepts `undefined` and applies this same default, so callers don't need their own `?? 2`. |
| `points` | integer | Default 10 (FR-039). |
| `categoryId` | UUID (Category) | Every QuizItem belongs to exactly one category, always (FR-022). An imported item/passage with no `category` in its file resolves to a per-subject default category ("Khác") rather than being left uncategorized (amended 2026-09-18). |
| `shuffleChoices` | boolean | Per-question override for FR-038. |
| `reviewStatus` | enum: `approved`, `needsReview` | Every path that creates a QuizItem (manual authoring, passage authoring, package import) sets `approved` — `needsReview` can no longer be newly created as of 2026-09-18 (FR-028 amended); the value is retained in the schema only because older synced/backed-up records may still carry `needsReview`, which `approveAllPendingQuizItems()` (`src/app/data/migrations.ts`) sweeps to `approved` once on every app start. |
| `status` | enum: `active`, `archived` | |
| `importBatchId` | UUID, optional | Set when created via package import (FR-030). |
| `passage` | `{passageId, title, text, order, total}`, optional | Set only for a sub-question of a shared passage/problem group (FR-073–075). Deliberately denormalized — copied identically onto every sub-question sharing `passageId` — rather than a separate synced entity, so `Attempt.itemSnapshots` (which already freezes the full QuizItem per id at attempt start) gives this the same snapshot-immutability guarantee as every other field, with no changes to the attempt/sync machinery. Editing a passage's `title`/`text` updates every sibling QuizItem's copy together as one operation. |

**(synced)**

Validation: choice-based types require ≥2 choices and ≥1 correct id; `answerRule` correctness is always resolved by `choices[].id`, never index. Editing/archiving/deleting never mutates any `AnswerResult`/`Attempt` snapshot that already captured this item (FR-020). A passage group requires ≥2 sub-questions; its sub-questions are always added to/removed from an exercise together (FR-074) and are excluded from random-group candidate resolution (see attempt-resolver.service.ts) so a random draw can never split a passage apart.

## 4. Exercise

Ordered/partly-randomized set of items (FR-031–038, FR-076–078, FR-082–084, FR-090–091).

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `title` | string | |
| `subject` | enum: `math`, `language`, `mixed` | `mixed` only when explicitly selected (FR-031). |
| `grade` | integer 1–5 | Informational only (FR-033). |
| `items` | ordered array of `ExerciseItem` (see §4a) | Fixed items and/or random groups, interleavable. |
| `timeLimitMinutes` | integer 1–60 | (FR-032) — always enforced as a hard backstop regardless of `questionTimingMode` below. |
| `lives` | integer 3–10, or literal `'unlimited'` | (FR-032, amended 2026-09-18 — was fixed at 5). An unlimited-lives attempt can never end via Try Again. |
| `passingPercent` | integer, default 70 | (FR-032) |
| `orderMode` | enum: `fixed`, `randomized` | Question randomization toggle (FR-032). |
| `replayAllowed` | boolean | **Dead as of 2026-09-18** — no longer read anywhere; every exercise is one-attempt-per-child regardless (FR-015). Kept only so existing records keep a value. |
| `correctionReviewEnabled` | boolean | (FR-032) |
| `repeatSameQuestions` | boolean | **Dead as of 2026-09-18** — the reuse-on-replay logic it gated is unreachable now that `start()` refuses a second attempt outright (FR-081); kept only so existing records keep a value. |
| `questionTimingMode` | enum: `none`, `distribute`, `custom`; defaults to `none` when absent (older records) | Per-question time cap mode (FR-076). `none` = this app's original behavior, no per-question cap. `distribute` = `timeLimitMinutes*60 / resolved question count`, applied uniformly. `custom` = only items with an explicit `timeLimitSeconds` (§4a) get a cap; others behave like `none`. |
| `status` | enum: `active`, `archived` | |
| `isDaily` | boolean, optional, defaults to `false`/absent | (FR-091, added 2026-09-18) When true: `items` may only ever contain `kind: 'randomGroup'` entries (enforced both by the builder UI and as a hard `save()` backstop) — never `fixed`; and `AttemptLifecycleService.start()`'s one-attempt-per-child check is scoped to "a finished attempt started today" (`findCompletedAttemptToday()`) instead of "any finished attempt ever" (`findMostRecentCompletedAttempt()`), so a child may start one freshly-randomized attempt per local calendar day. |

**(synced)**

### 4a. ExerciseItem (embedded/child collection of Exercise)

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `exerciseId` | UUID (Exercise) | |
| `position` | integer | Display/answer order. |
| `kind` | enum: `fixed`, `randomGroup` | |
| `quizItemId` | UUID (QuizItem), when `kind = fixed` | |
| `timeLimitSeconds` | integer ≥1, optional, when `kind = fixed` | Only meaningful when the owning Exercise's `questionTimingMode = custom` (FR-076). |
| `points` | integer ≥0, optional, when `kind = fixed` | Per-exercise points override, set from the question-browser's detail view (FR-083); applied onto this item's frozen Attempt snapshot at resolve time, never onto the QuizItem itself. Absent = use the QuizItem's own `points`. |
| `randomGroup` | object, when `kind = randomGroup`: `{count, subject, grade, categoryIds[], tags[], difficultyMin, difficultyMax, allowedTypes[], avoidRecentUse, preferWeakAreas, mode: fullyRandom \| balanced \| practiceWeakAreas, timeLimitSeconds?, pointsOverride?}` | Default `mode = balanced` (FR-037). `timeLimitSeconds`, same `custom`-mode-only meaning as above, applied to every item drawn from this group. `difficultyMin`/`difficultyMax` span the 1–5 named scale (amended 2026-09-18, was 1–3). `pointsOverride` (added 2026-09-18) mirrors the fixed-item `points` override above — when set, every item this group draws gets this points value instead of its own default, applied onto the Attempt snapshot only, same as the fixed-item override. |

## 5. Assignment

Links a profile, an exercise, and a date (FR-033), plus the rotation fallback (FR-069).

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `profileId` | UUID (Profile, child) | |
| `exerciseId` | UUID (Exercise) | |
| `assignedDate` | date (local calendar date) | |
| `isPrimary` | boolean | At most one primary Assignment per `(profileId, assignedDate)` (FR-033). |
| `replayAllowed` | boolean | Overrides Exercise-level default per assignment, optional. |

**(synced)**

### 5a. Rotation (per-child, per FR-069)

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `profileId` | UUID (Profile, child) | |
| `orderedExerciseIds` | UUID[] | Enabled rotation list; consumed round-robin when a date has no explicit Assignment. |
| `cursor` | integer | Index of the next exercise to serve from the rotation. |

**(synced)**

State rule: resolving "today's exercise" for a child = the `isPrimary` Assignment for today's local date if one exists, otherwise `orderedExerciseIds[cursor]` from Rotation, advancing `cursor` the first time that date's exercise is actually started (not merely viewed).

## 6. Attempt

One playthrough (FR-009–016, FR-036, FR-062–063, FR-079–081).

State rule (amended 2026-09-18, FR-081): a new Attempt MUST NOT be started for a `(profileId, exerciseId)` pair that already has any non-`inProgress` Attempt — enforced in `AttemptLifecycleService.start()` itself as a hard backstop, not only in the UI. `findMostRecentCompletedAttempt(exerciseId, profileId)` is the query used both to block a restart and to let the child/parent reopen that finished attempt's own result screen (`loadAttempt()` hydrates the service from a past record without creating or scoring anything new).

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `profileId` | UUID (Profile, child) | |
| `exerciseId` | UUID (Exercise) | |
| `assignmentId` | UUID (Assignment), optional | Null for unscored practice replays. |
| `exerciseSnapshot` | object | Frozen copy of the exercise's rules + resolved item list at start (title, timeLimitMinutes, lives, passingPercent, resolved question list with content snapshots). |
| `randomSeed` | number | PRNG seed used to resolve random groups and shuffle order (FR-036, FR-038); recorded even if `items` had no random groups. |
| `resolvedItemOrder` | UUID[] (QuizItem ids in play order) | |
| `answerOrderByItem` | map of `quizItemId → choiceId[]` | Displayed choice order per shuffled question (FR-038). |
| `isScored` | boolean | False for unscored practice replays (FR-015). |
| `startedAt` | datetime | |
| `deadlineAt` | datetime | `startedAt + timeLimitMinutes`; immutable once set (FR-014). Always the hard backstop, independent of the fields below (FR-076). |
| `perQuestionSeconds` | map of `quizItemId → integer seconds`, optional | Resolved once at attempt start from the exercise's `questionTimingMode` (FR-076); only ids with an actual cap appear here. Absent entirely when the mode is `none`. |
| `currentQuestionDeadlineAt` | datetime, optional | Recomputed each time the child reaches a new question that has an entry in `perQuestionSeconds`; absent when the current question has no per-question cap. Reaching it ends only that question — unanswered, not counted toward accuracy, but removing one life the same as a wrong answer (FR-077, amended 2026-09-18) — never the whole attempt by itself. |
| `completedAt` | datetime, optional | |
| `status` | enum: `inProgress`, `completed`, `timeUp`, `tryAgain`, `abandoned` | (FR-013) |
| `livesRemaining` | integer 0–10, or literal `'unlimited'` | Mirrors `exerciseSnapshot.lives` (FR-032, amended 2026-09-18 — was integer 0–5). `'unlimited'` never decrements and can never trigger a `tryAgain` end. |
| `score` | integer | Sum of earned points. |
| `accuracy` | decimal 0–1 | correct / submitted (FR-039). |
| `passed` | boolean | All questions completed AND accuracy ≥ exercise's `passingPercent` (FR-041). |
| `starsAwarded` | integer 0–3 | (FR-042) |
| `ownerDeviceId` | string | Device that started the attempt; only it may resume/advance it (FR-063). |

**(synced, append-only once `completedAt` is set)** — immutable after completion (FR-062); `inProgress` attempts sync as ordinary mutable records but remain resumable only on `ownerDeviceId` (FR-063).

State machine: `inProgress → completed | timeUp | tryAgain | abandoned` (terminal). No transition leaves a terminal state.

## 7. AnswerResult

One submitted answer within an Attempt (FR-012, FR-047, FR-079).

The result screen's per-question breakdown (FR-079) is built by joining `Attempt.resolvedItemOrder` (every question, including unanswered ones) against these rows keyed by `quizItemId` — a question with no matching row here was left unanswered (e.g. a per-question timeout) and is rendered as such, with the correct answer still shown from `Attempt.itemSnapshots`.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `attemptId` | UUID (Attempt) | |
| `quizItemId` | UUID (QuizItem) | Links back to the original item for aggregation (FR-048); display/history always reads `quizItemSnapshot`, never this live reference. |
| `quizItemSnapshot` | object | Prompt/choices/correct-answer exactly as presented, plus the `passage` context if this question belonged to one (FR-020, FR-047, FR-075). |
| `submittedAnswer` | type-specific value | |
| `isCorrect` | boolean | |
| `pointsEarned` | integer | |
| `responseSeconds` | decimal | |
| `submittedAt` | datetime | |

**(synced, append-only)** — never edited once written (FR-062); one row per submitted answer, in submission order.

## 8. Reward

Star/badge/streak entries (FR-042–045).

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `profileId` | UUID (Profile, child) | |
| `type` | enum: `star`, `badge`, `streakMilestone`, `personalBest`, `unlock` | |
| `key` | string | e.g., `badge.first-completion`, `badge.five-day-streak`. |
| `earnedAt` | datetime | |
| `sourceAttemptId` | UUID (Attempt), optional | |

**(synced, append-only)**

## 9. AppSettings

Device-level preferences (local only, not a sync target itself, though `schemaVersion` participates in compatibility checks).

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | integer | Local schema version; compared against `Metadata.localSchemaVersion` expectations. |
| `timerVisibility` | boolean | |
| `audioEnabled` | boolean | |
| `reducedMotion` | boolean | |
| `feedbackDelay` | integer (ms) | Auto-advance delay after feedback (FR-005 daily journey step 5/CH05 equivalent). |
| `storageMode` | enum: `localOnly`, `manualSync`, `automaticSync` | (FR-055) |
| `backupMetadata` | object (`lastExportAt`, `lastImportAt`) | |

## 10. SyncTransaction

One synchronization attempt (FR-058–060).

| Field | Type | Notes |
|---|---|---|
| `syncId` | UUID | Client-generated; idempotency key (FR-059). |
| `deviceId` | string | |
| `status` | enum: `started`, `committed`, `failed`, `conflict` | |
| `startedAt`, `completedAt` | datetime | |
| `recordCount` | integer | |
| `changeGroupIds` | UUID[] | Groups committed/rejected atomically together (FR-060). |
| `error` | string, optional | |
| `commitSequence` | integer | Server-assigned global order, incremented once per committed transaction (mirrors "global data revision"). |

Stored both locally (pending/last-known status) and in the `SyncTransactions` sheet tab (source of truth for idempotent-retry lookups, FR-059).

## 11. DeletedRecord (tombstone)

(FR-064)

| Field | Type | Notes |
|---|---|---|
| `entityType` | string | Which collection the tombstone belongs to. |
| `entityId` | UUID | |
| `version` | integer | Version at deletion. |
| `deletedAt` | datetime | |
| `updatedByDeviceId` | string | |

Retention: ≥90 days before permanent purge eligibility (FR-064). Attempt/AnswerResult/Reward snapshots referencing a tombstoned QuizItem/Category/Exercise remain fully readable (FR-020, FR-047, FR-064) because they hold content snapshots, not live references.

## 12. PointRedemption (added 2026-09-18)

Parent-recorded real-world point spend (FR-085–087).

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `profileId` | UUID (Profile, child) | |
| `points` | integer > 0 | Amount deducted. |
| `note` | string, optional | What was traded, e.g. "Đổi đồ chơi". |
| `redeemedAt` | datetime | |

**(synced, append-only)** — never edited once written, same rule as AnswerResult/Reward (FR-087).

A child's spendable point balance is never stored — it is always computed as `sum(Attempt.score for profileId) − sum(PointRedemption.points for profileId)` (FR-085, FR-087), read fresh wherever shown (child home screen, the parent's redemption screen). A redemption MUST be refused client-side if `points` would exceed the current computed balance (FR-086) — enforced in the UI at submit time; there is no server-side/repository-level guard beyond that, consistent with this app's single-parent-author trust model (Assumptions).

## Cross-entity invariants (from spec Business Rules/Edge Cases)

- A child has at most one `Attempt` with `status = inProgress` at a time (no second scored attempt while one is active).
- A child has at most one non-`inProgress` `Attempt` per `exerciseId` — ever (FR-015, FR-081, amended 2026-09-18); once one exists, `start()` refuses to create another for that pair.
- `Attempt.exerciseSnapshot` and `AnswerResult.quizItemSnapshot` are the only sources read during play and in historical review — never the live `Exercise`/`QuizItem` records — so edits/deletes to bank content never alter history.
- `Category` cannot be hard-deleted while any non-archived `QuizItem.categoryId` references it (FR-023); merge/rename operations update all referencing `QuizItem` rows as a single change group.
- Version fields (`localVersion`, `lastGoogleVersion`) are compared, never record content, to detect sync state (§0, FR-057); an out-of-order version relationship halts automatic sync rather than auto-merging.
