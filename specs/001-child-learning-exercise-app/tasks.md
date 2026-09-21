# Tasks: Child Learning Exercise Application

**Input**: Design documents from `/specs/001-child-learning-exercise-app/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Not explicitly requested in spec.md or by the user — no dedicated test-writing tasks are included. Validation is instead performed via the quickstart.md walkthrough (Polish phase) and the Jest/Playwright harness configured in Setup, which the team can use to add tests during/after implementation.

**Organization**: Tasks are grouped by user story (from spec.md, priorities P1–P8 as of 2026-09-18) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Maps the task to US1–US7 from spec.md
- File paths are relative to the repository root, per plan.md's Project Structure

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and tooling, per plan.md's Project Structure and research.md's tooling decisions

- [X] T001 Create the Angular workspace and standalone-app scaffold matching plan.md's structure (`src/app/{core,data,features,shared,sync-engine}`, `apps-script/`, `tests/{unit,integration,e2e}`)
- [X] T002 [P] Add the `@angular/pwa` schematic and a baseline `ngsw-config.json` with app-shell asset-group caching (research.md #3)
- [X] T003 [P] Install and configure Dexie.js as the IndexedDB access layer (research.md #1)
- [X] T004 [P] Install and configure `ajv` for JSON Schema validation (research.md #5)
- [X] T005 [P] Configure ESLint + Prettier for the workspace
- [X] T006 [P] Configure Jest as the unit/component test runner per Angular's Jest builder (research.md #8)
- [X] T007 [P] Configure Playwright for e2e tests, including multi-browser-context support (for the concurrent-sync scenario) and offline network emulation (research.md #8)
- [X] T008 [P] Scaffold the `apps-script/` project (`clasp init`, `appsscript.json`, V8 runtime) as an independent, separately-deployed project per plan.md's Structure Decision

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared data layer, auth, and cross-cutting infrastructure every user story depends on

**⚠️ CRITICAL**: No user story phase may begin until this phase is complete

- [X] T009 Define the Dexie schema in `src/app/data/db.ts` for every entity in data-model.md (§1–§11: Profile, Category, QuizItem, Exercise+ExerciseItem, Assignment, Rotation, Attempt, AnswerResult, Reward, AppSettings, SyncTransaction, DeletedRecord), including the shared sync envelope fields (`id`, `localVersion`, `lastGoogleVersion`, `syncStatus`, `updatedAt`, `updatedByDeviceId`, `deletedAt`) on every entity marked **(synced)** in data-model.md §0
- [X] T010 [P] Implement a generic base repository (CRUD + `localVersion` auto-increment on every local write, per data-model.md §0) in `src/app/data/repositories/base-repository.ts`
- [X] T011 [P] Implement `ProfileRepository` in `src/app/data/repositories/profile.repository.ts`: exactly 3 records ever exist (2 `role=child` + 1 `role=parent`, no create/delete UI per spec Assumptions); `credential` field is always excluded from any exported or synchronized payload (FR-066)
- [X] T012 Seed exactly 3 `Profile` records (Child One, Child Two, Parent) with placeholder credentials on first launch in `src/app/data/seed.ts` (depends on T011)
- [X] T013 [P] Implement `AppSettingsRepository` with defaults (`storageMode=localOnly`, `audioEnabled=true`, `reducedMotion=false`, sensible `feedbackDelay`) in `src/app/data/repositories/app-settings.repository.ts`
- [X] T014 Implement the core session service in `src/app/core/auth/session.service.ts`: avatar + 4-digit PIN login for children and password login for parent (FR-002); an incorrect credential shows a friendly retry message without revealing which part was wrong (FR-003); logout returns to profile selection (FR-005) (depends on T011)
- [X] T015 [P] Implement route guards in `src/app/core/auth/auth.guard.ts` so a logged-in profile can only reach routes/data scoped to itself (FR-004)
- [X] T016 Build the Profile Selection screen (three profile cards + credential entry) in `src/app/core/auth/profile-selection/` (FR-001) (depends on T014)
- [X] T017 [P] Build a Settings screen skeleton for editing display name, avatar, and local credentials per profile in `src/app/core/settings/` (FR-006)
- [X] T018 [P] Create the centralized Vietnamese string table in `src/app/shared/i18n/vi.ts` and wire the app root to consume it exclusively, with no runtime language switch in scope (FR-068, research.md #9)
- [X] T019 [P] Implement a seeded PRNG utility (mulberry32 or equivalent) in `src/app/shared/random/seeded-random.ts` for deterministic random-group resolution and choice shuffling (research.md #4)
- [X] T020 [P] Implement an offline-ready indicator service in `src/app/core/offline/offline-ready.service.ts`, set true only once the Angular ServiceWorker reports the app-shell (and required media asset groups) fully cached (FR-051)
- [X] T021 [P] Implement `CategoryRepository` (plain CRUD) in `src/app/data/repositories/category.repository.ts`, enforcing `(normalizedName, subject)` uniqueness among non-deleted records at write time (data-model.md §2)
- [X] T022 [P] Implement `QuizItemRepository` (plain CRUD) in `src/app/data/repositories/quiz-item.repository.ts`, storing the type-specific `answerRule` shape and `choices[].id`-based references described in data-model.md §3
- [X] T023 [P] Implement `ExerciseRepository` and embedded `ExerciseItem` handling (plain CRUD) in `src/app/data/repositories/exercise.repository.ts` (data-model.md §4/§4a)
- [X] T024 [P] Implement `AssignmentRepository` (plain CRUD) in `src/app/data/repositories/assignment.repository.ts`, enforcing at most one `isPrimary` Assignment per `(profileId, assignedDate)` at write time (FR-033, data-model.md §5)
- [X] T025 [P] Implement `RotationRepository` in `src/app/data/repositories/rotation.repository.ts` with the "today's exercise" resolution rule: the `isPrimary` Assignment for today's local date if one exists, otherwise `orderedExerciseIds[cursor]` from Rotation, advancing `cursor` only when that exercise is actually started (FR-007, FR-033, FR-069, data-model.md §5a)
- [X] T026 Implement a dev/test seed-data script in `src/app/data/seed-dev-data.ts` (sample Categories, QuizItems across the MVP types, one Exercise, one dated Assignment, one Rotation entry per child) so every user story phase below can be independently exercised from a known starting state (depends on T021–T025)

**Checkpoint**: Foundation ready — user story phases can now begin (sequentially or in parallel, per team capacity)

---

## Phase 3: User Story 1 - Child completes a daily practice exercise (Priority: P1) 🎯 MVP

**Goal**: A child can log in, play today's exercise (dated or rotation fallback) one question at a time with lives/timer, reach a clear result on any end condition, and never lose progress to an interruption.

**Independent Test**: With Foundational's seed data (T026) in place, log in as a child, start the assigned exercise, answer every question, and reach a Completed result with score/accuracy/lives shown — fully offline, no parent tooling involved.

### Implementation for User Story 1

- [X] T027 [P] [US1] Implement `AttemptRepository` in `src/app/data/repositories/attempt.repository.ts`: enforce at most one `status=inProgress` Attempt per child at a time (edge case), and stamp `ownerDeviceId` at creation (FR-063, data-model.md §6)
- [X] T028 [P] [US1] Implement `AnswerResultRepository` in `src/app/data/repositories/answer-result.repository.ts`: append-only, one immutable row per submitted answer, never edited after write (FR-062, data-model.md §7)
- [X] T029 [US1] Implement the random-group + shuffle resolution service in `src/app/features/child-play/services/attempt-resolver.service.ts`: using the seeded PRNG (T019), resolve an Exercise's fixed items and random groups into a play order with no repeated quiz within the attempt, and store `randomSeed`, `resolvedItemOrder`, and `answerOrderByItem` on the Attempt (FR-036, FR-038)
- [X] T030 [US1] Implement the scoring service in `src/app/features/child-play/services/scoring.service.ts`: award each item's configured points (default 10) on a correct answer; `accuracy = correct / submitted` (FR-039); remove exactly one life per incorrect submitted answer regardless of repeat submissions, and never for an unanswered question at time expiry (FR-040); `passed` = all questions completed AND accuracy ≥ the exercise's `passingPercent` (FR-041)
- [X] T031 [US1] Implement the attempt lifecycle service in `src/app/features/child-play/services/attempt-lifecycle.service.ts`: start with 5 lives and `deadlineAt = startedAt + timeLimitMinutes`, with the timer starting only after the child presses Start (FR-009); persist progress after every submitted answer (FR-014); end as `completed`/`timeUp`/`tryAgain` per FR-013; block starting a second scored attempt while one is `inProgress` for that child (edge case) (depends on T027, T029, T030)
- [X] T032 [P] [US1] Build the Child Home screen in `src/app/features/child-play/child-home/`: surface today's exercise (dated Assignment or Rotation fallback via T025) with subject/title/question-count/estimated-time/grade/completion-state (FR-007), with placeholders for streak/stars/badges/last-7-days (populated fully in US5, T074)
- [X] T033 [P] [US1] Build the Exercise Introduction screen in `src/app/features/child-play/exercise-intro/`: show rules (lives, time limit, possible reward) and a Start action that begins the timer (FR-009)
- [X] T034 [US1] Build the Question screen in `src/app/features/child-play/question/`: exactly one quiz item per screen with position/remaining-lives/remaining-time; answer control disabled until a valid response is given; a submitted answer is locked for the rest of the attempt (FR-010, FR-011); support the MVP types single-choice, short-text, and number (FR-018)
- [X] T035 [US1] Implement immediate feedback UI plus a double-submission guard in `src/app/features/child-play/question/feedback/`: correct → positive animation + configured points; incorrect → one life removed + encouraging correction; the correct answer is never revealed before submission; repeated taps/submissions never remove more than one life or apply twice (FR-012, edge cases) (depends on T030, T034)
- [X] T036 [P] [US1] Build the Exercise Result screen in `src/app/features/child-play/result/`: outcome, score, accuracy, time, remaining lives, rewards, and a Home action (FR-013)
- [X] T037 [US1] Implement the resume-on-relaunch flow in `src/app/features/child-play/services/attempt-resume.service.ts`: on app start, detect an `inProgress` Attempt owned by this device and resume at the next unanswered question with the original `deadlineAt` and `livesRemaining` intact, never reset (FR-014, User Story 1 scenario 7) (depends on T031)
- [X] T038 [P] [US1] Implement a minimal "reset unfinished attempt" action (parent-only) in `src/app/features/child-play/services/attempt-admin.service.ts`, to be surfaced fully from the dashboard in US3 (FR-016)
- [X] T039 [US1] Wire the full child daily-journey routing in `src/app/app.routes.ts`: profile selection → child home → exercise intro → question loop → result, guarded per T015 (depends on T016, T032–T037)

**Checkpoint**: User Story 1 is fully functional and independently testable/demoable as the MVP

---

## Phase 4: User Story 2 - Parent builds and assigns an exercise from the quiz bank (Priority: P2)

**Goal**: A parent authors categories and quiz items, assembles an exercise (fixed and/or random groups), and schedules it for a child — without any code.

**Independent Test**: Starting from Foundational's repositories, create a category, add several quiz items, build an exercise from them, set a time limit, and assign it to a child for a future date — independent of whether any child has played yet.

### Implementation for User Story 2

- [X] T040 [US2] Extend `CategoryRepository` (from T021) with rename/describe/archive/restore/merge operations in `src/app/data/repositories/category.repository.ts`: renaming preserves existing `QuizItem.categoryId` references; merging reassigns all referencing items to the winning category as one change group (FR-022, data-model.md §2)
- [X] T041 [US2] Implement quiz-item answer-configuration validation in `src/app/features/quiz-bank/services/quiz-validation.service.ts`: choice-based types require ≥2 choices and ≥1 correct answer id resolved by `choices[].id` (never position) (FR-017, data-model.md §3)
- [X] T042 [P] [US2] Build the Category management screen in `src/app/features/quiz-bank/categories/`: list with per-category item counts; create/rename/describe/archive/restore/merge (FR-022) (depends on T040)
- [X] T043 [US2] Implement inline category select-or-create in the quiz item form, in `src/app/features/quiz-bank/quiz-item-form/category-picker.component.ts`: exact + normalized-name duplicate detection, with a warning (not a silent duplicate) on close matches (FR-024)
- [X] T044 [P] [US2] Build the Quiz Bank list screen in `src/app/features/quiz-bank/quiz-bank-list/`: search (prompt/identifier/tags) and filter by subject/grade/type/difficulty/tag; Add/Edit/Duplicate/Preview/Archive/Delete actions (FR-019)
- [X] T045 [US2] Build the Quiz Item form in `src/app/features/quiz-bank/quiz-item-form/`: required fields (title/identifier, subject, grade, type, prompt, correct answer) and optional fields (explanation, image, audio, tags, difficulty, points) per data-model.md §3; type-specific inputs for all six supported types (FR-017, FR-018) (depends on T041, T043)
- [X] T046 [P] [US2] Build the Quiz Item Preview screen in `src/app/features/quiz-bank/quiz-item-preview/`: renders exactly as a child would see it, including feedback, without affecting any real child's progress (FR-021)
- [X] T047 [US2] Extend `ExerciseRepository` (from T023) with authoring operations in `src/app/data/repositories/exercise.repository.ts`: reorder items, enforce Mixed-subject requires explicit selection (FR-031), duplicate/archive/delete an unused exercise (FR-034)
- [X] T048 [US2] Build the Exercise Builder screen in `src/app/features/exercise-builder/builder/`: title/subject/grade/time-limit(1–60 min)/passing-threshold(default 70%)/toggles for randomization, replay, and correction review (FR-031, FR-032); add fixed items or configure a random group (count, subject, grade, categories, tags, difficulty range, allowed types, recent-use avoidance, weak-area preference, mode) (FR-035, FR-037) (depends on T047)
- [X] T049 [US2] Implement the random-group bank-satisfiability check in `src/app/features/exercise-builder/services/random-group-check.service.ts`: warn the parent at save time if the current bank cannot supply enough matching Approved items for a configured random group (FR-036) (depends on T048)
- [X] T050 [P] [US2] Build the Exercise Library screen in `src/app/features/exercise-builder/library/`: list title/subject/grade/question-count/time-limit/status; duplicate/edit/preview/archive/delete an unused exercise (FR-034)
- [X] T051 [US2] Extend `AssignmentRepository` (from T024) with parent-facing assignment logic and build the Schedule screen in `src/app/features/exercise-builder/schedule/`: assign to one child, both children, or a grade profile for a date; future-dated assignments; grade is informational only and never blocks assignment (FR-033)
- [X] T052 [P] [US2] Build the Rotation editor screen in `src/app/features/exercise-builder/rotation/` on top of `RotationRepository` (T025): parent-managed ordered list of enabled exercises per child (FR-069)
- [X] T053 [US2] Verify and enforce the "editing an exercise never changes an already-active attempt" invariant by confirming the question/result flow (US1) always reads `Attempt.exerciseSnapshot`, never the live Exercise/QuizItem records (FR-020, FR-034, data-model.md cross-entity invariants)

**Checkpoint**: User Stories 1 and 2 both work independently — a parent can now fully staff the daily exercise a child plays

---

## Phase 5: User Story 3 - Parent reviews a child's progress and learning needs (Priority: P3)

**Goal**: A parent sees a per-child overview, drills into any attempt's full detail, and identifies and acts on weak areas.

**Independent Test**: With at least one recorded Attempt (from US1), open that child's dashboard, see it reflected in the summary, and open its full detail.

### Implementation for User Story 3

- [X] T054 [P] [US3] Implement the progress-aggregation service in `src/app/features/dashboard/services/progress-aggregation.service.ts`: assigned/completed/passed/unfinished counts, accuracy by subject and grade, current streak, total practice time, lives lost, recent activity; filters for last 7 days (default), last 30 days, all time (FR-046)
- [X] T055 [P] [US3] Build the Dashboard Overview screen in `src/app/features/dashboard/overview/`: child selector, date filter, summary metrics (FR-046)
- [X] T056 [US3] Build the Attempt Detail screen in `src/app/features/dashboard/attempt-detail/`: every prompt, submitted answer, correct answer, outcome, response time; clearly distinguishes completed/time-expired/lives-lost/abandoned; reads from the historical snapshot so it stays correct even if the source quiz item later changes (FR-047)
- [X] T057 [US3] Implement weak-area detection in `src/app/features/dashboard/services/weak-areas.service.ts`: lists quiz items answered incorrectly ≥2 times; summarizes weak tags/skills only once ≥3 responses exist for them (FR-048)
- [X] T058 [P] [US3] Build the Learning Needs view in `src/app/features/dashboard/learning-needs/`, including a "build a practice exercise from this selection" action that hands off to the Exercise Builder (US2, T048) (FR-048) (depends on T057)
- [X] T059 [US3] Complete the parent "reset unfinished attempt" flow (started in T038) with a full entry point from the dashboard (FR-016)

**Checkpoint**: User Stories 1–3 together deliver the full play-author-review loop

---

## Phase 6: User Story 4 - Parent imports an AI-generated quiz package (Priority: P4)

**Goal**: A parent imports a JSON quiz package, resolves categories, and reviews questionable items before they're usable in exercises.

**Independent Test**: Import a sample package with valid items, one duplicate, and one new-category reference; confirm preview counts, approve the category, and end with valid items in the bank marked for review.

### Implementation for User Story 4

- [X] T060 [P] [US4] Author the downloadable quiz-package JSON Schema, template file, and instructions matching `contracts/quiz-package-format.md`, saved at `src/assets/templates/quiz-package-template.json` (FR-025)
- [X] T061 [US4] Implement the `ajv`-based package validator in `src/app/features/quiz-bank/import/services/package-validator.service.ts`: format-version check, required fields, subject/grade/type validity, choice/correct-answer-id integrity, category resolution by `externalKey` then normalized-name+subject (FR-026)
- [X] T062 [US4] Implement duplicate detection in `src/app/features/quiz-bank/import/services/duplicate-detector.service.ts`: matches on `externalId` and likely-duplicate prompt text (FR-026)
- [X] T063 [US4] Implement the import-preview builder in `src/app/features/quiz-bank/import/services/import-preview.service.ts`: total/valid/invalid/duplicate/replacement/skipped/proposed-category counts, plus a downloadable error report (FR-027) (depends on T061, T062)
- [X] T064 [US4] Build the Import Preview screen in `src/app/features/quiz-bank/import/import-preview/`: select items, map/approve categories, skip/replace duplicates, cancel, or download the error report (FR-027) (depends on T063)
- [X] T065 [US4] Implement import commit in `src/app/features/quiz-bank/import/services/import-commit.service.ts`: valid items save even when other items are invalid; every saved item gets a shared `importBatchId` and `reviewStatus=needsReview`, excluded from random selection until Approved (FR-028) (depends on T064)
- [X] T066 [P] [US4] Implement package export in `src/app/features/quiz-bank/export/export.service.ts`: round-trips selected quiz items to the same format, mapping `categoryId` back to `externalKey`/`name` (FR-029)
- [X] T067 [P] [US4] Build the bulk-review/edit screen in `src/app/features/quiz-bank/import/bulk-review/`: bulk-change grade/category/difficulty/tags/review-status/points/archive-status; undo the most recent import batch only if none of its items has been used in an attempt (FR-030)

**Checkpoint**: AI-assisted content authoring is fully usable on top of the manual quiz bank from US2

---

## Phase 7: User Story 5 - Motivation, rewards, and streaks (Priority: P5)

**Goal**: Streaks, stars, badges, and brief celebrations reward genuine performance without manipulative mechanics.

**Independent Test**: After a child completes their primary daily exercise with a passing score, the streak increases exactly once, stars are awarded per the rules, and a new badge (if earned) appears on the next home-screen visit.

### Implementation for User Story 5

- [X] T068 [P] [US5] Implement `RewardRepository` in `src/app/data/repositories/reward.repository.ts`: append-only star/badge/streakMilestone/personalBest/unlock entries (data-model.md §8)
- [X] T069 [US5] Implement the stars-awarding rule in `src/app/features/rewards/services/stars.service.ts`: 1 star for completion, 2 for passing, 3 for ≥90% accuracy with ≥1 life remaining (FR-042) (depends on T068)
- [X] T070 [US5] Implement the daily-streak rule in `src/app/features/rewards/services/streak.service.ts`: increases at most once per local calendar date, only on primary daily exercise completion (not replays), using the device's local date (FR-043, edge case) (depends on T068)
- [X] T071 [P] [US5] Implement personal-best detection in `src/app/features/rewards/services/personal-best.service.ts`: score, accuracy, or completion-time improvement on a repeated attempt of the same exercise (FR-044) (depends on T068)
- [X] T072 [US5] Implement badge-milestone rules in `src/app/features/rewards/services/badges.service.ts`: first completion, five-day streak, perfect score, persistence, subject milestones (FR-045) (depends on T068)
- [X] T073 [P] [US5] Build the motivation UI components in `src/app/features/rewards/motivation/`: avatar reactions, treasure-path progress view, unlockable cosmetic themes, deterministic daily bonus, and read-aloud (parent-recorded audio first, Web Speech API fallback per research.md #10); all animations brief/optional/non-blocking with no ads, purchases, public leaderboards, or manipulative countdowns (FR-045)
- [X] T074 [US5] Wire reward outputs into the Child Home (T032) and Exercise Result (T036) screens from US1: real streak/star/badge/last-7-days values instead of placeholders (FR-008) (depends on T069–T073)

**Checkpoint**: The full motivational layer sits on top of a working play loop without altering its core mechanics

---

## Phase 8: User Story 6 - Backup, restore, and offline reliability (Priority: P6)

**Goal**: A parent can export all local data to one file, restore it on a fresh installation, and reset data safely; the app works fully offline throughout.

**Independent Test**: Export a backup from a populated installation, import it into a reset installation, and confirm the quiz bank, exercises, profiles, and progress match — with network off throughout.

### Implementation for User Story 6

- [X] T075 [P] [US6] Implement the backup export service in `src/app/features/backup/services/export.service.ts` per `contracts/backup-format.md`: full local data plus media references in one versioned file, with `Profile.credential` excluded (FR-052)
- [X] T076 [US6] Implement the backup import service in `src/app/features/backup/services/import.service.ts`: validate format/schema version, show a summary, replace local data only after explicit confirmation, all-or-nothing within a single local transaction (FR-052) (depends on T075)
- [X] T077 [P] [US6] Build the Backup & Restore screen in `src/app/features/backup/backup-restore/`: export/import actions with confirmation dialogs (FR-052) (depends on T076)
- [X] T078 [US6] Implement the reset-all-data flow in `src/app/features/backup/services/reset.service.ts`: requires parent login, an explicit warning, and a second confirmation before clearing all local collections and re-seeding the 3 fixed profiles (FR-053, `contracts/backup-format.md`)
- [X] T079 [P] [US6] Finalize `ngsw-config.json` asset-group coverage for all required media and confirm the offline-ready indicator (T020) only reports true once fully cached (FR-051, SC-003)

**Checkpoint**: The product is fully safe against data loss and verified offline-capable, independent of whether Google sync (US7) is ever enabled

---

## Phase 9: User Story 7 - Optional synchronization across devices via Google Sheets (Priority: P7)

**Goal**: A parent can connect one Google account/spreadsheet so multiple devices share the same data, with safe concurrency, versioned conflict handling, and idempotent retries — entirely optional and additive.

**Independent Test**: Two installations connected to the same spreadsheet: a change on one becomes visible on the other after sync; simultaneous sync from both results in exactly one commit and one deferred `SYNC_BUSY`; disconnecting leaves local data intact.

### Implementation for User Story 7

- [X] T080 [P] [US7] Implement the Apps Script lock module in `apps-script/src/lock.ts`: `LockService.getScriptLock()` acquisition; return `SYNC_BUSY` immediately with no changes applied if the lock cannot be acquired (FR-058, `contracts/sync-api.md` step 1)
- [X] T081 [P] [US7] Implement the Apps Script versioning module in `apps-script/src/versioning.ts`: the five version-comparison outcomes (no-op / upload / download / conflict / invalid-state) exactly as specified in data-model.md §0 and `contracts/sync-api.md` steps 4–5 (FR-057)
- [X] T082 [US7] Implement the Apps Script transactions module in `apps-script/src/transactions.ts`: look up `syncId` in `SyncTransactions`; if already `Committed`, return the stored result verbatim with no re-application; otherwise record the new transaction and increment the global `commitSequence` by exactly 1 on commit (FR-059, `contracts/sync-api.md` steps 3, 8) (depends on T081)
- [X] T083 [US7] Implement Apps Script sheet read/write helpers in `apps-script/src/sheets/` for all 14 tabs (Metadata, Profiles, Categories, QuizItems, QuizChoices, Exercises, ExerciseItems, Assignments, Attempts, AnswerResults, Rewards, ChangeLog, DeletedRecords, SyncTransactions), writing deletions as tombstones rather than row removal (FR-064)
- [X] T084 [US7] Implement the Apps Script `doPost` entry point in `apps-script/src/main.ts` wiring the full algorithm — lock → schema-compatibility check → idempotency lookup → versioning re-evaluation → grouped commit → transaction record → lock release in `finally` — exactly per `contracts/sync-api.md` (FR-057–061, FR-065) (depends on T080, T082, T083)
- [X] T085 [P] [US7] Implement the client Google-auth connect flow in `src/app/features/sync/services/google-auth.service.ts`: Google Identity Services OAuth, minimal Sheets+Drive scope, create-or-select a compatible spreadsheet, initiated only from Parent Settings (FR-054)
- [X] T086 [US7] Implement the client sync-engine batch builder in `src/app/sync-engine/batch-builder.service.ts`: collects pending local changes grouped by `changeGroupId`, excluding `Profile.credential`, any OAuth token, and any local-only UI state (FR-057, FR-060, FR-066)
- [X] T087 [US7] Implement the client sync-engine request/response handler in `src/app/sync-engine/sync-client.service.ts`: posts to the Apps Script endpoint per `contracts/sync-api.md`, applies accepted commits/downloads locally, and surfaces reported conflicts (depends on T086, T084)
- [X] T088 [US7] Implement storage-mode logic in `src/app/sync-engine/storage-mode.service.ts`: Local Only / Manual Sync / Automatic Sync; Automatic Sync may run at app start and after a completed exercise but never blocks child login or exercise play (FR-055)
- [X] T089 [US7] Implement conflict-pause behavior in `src/app/sync-engine/conflict-state.service.ts`: on any reported conflict, halt further automatic sync until every conflict is resolved, while local child activity continues saving normally (FR-061) (depends on T087)
- [X] T090 [P] [US7] Build the Sync screen in `src/app/features/sync/sync-screen/`: Sync Normally, Review Conflicts, Retry, Replace Google With Local, Replace Local With Google, Pause Automatic Sync, Disconnect Google — replace actions require explicit confirmation and recommend a prior backup; disconnecting never deletes local data (FR-056)
- [X] T091 [US7] Implement conflict-resolution actions in `src/app/features/sync/services/conflict-resolution.service.ts`: Use Local / Use Google / Keep Both / Decide Later; `resolvedVersion = max(localVersion, googleVersion) + 1`; Keep Both creates the local content as a new record with a new UUID rather than merging fields (FR-061) (depends on T089, T090)
- [X] T092 [US7] Implement active-attempt device-ownership enforcement in `src/app/sync-engine/` and `src/app/features/child-play/`: another device may see an active Attempt exists but must not resume it; the parent may abandon a stale active attempt (FR-063)
- [X] T093 [US7] Implement retry-with-backoff for `SYNC_BUSY` and offline/network failures in `src/app/sync-engine/sync-client.service.ts`, always leaving changes safely pending rather than blocking child login or play (FR-058, FR-055) (depends on T087)
- [X] T094 [P] [US7] Implement the schema-compatibility guard on the client (surfaced in the Sync screen, T090): automatic sync refuses to run when the Google-side schema is newer than supported (FR-065)

**Checkpoint**: Multi-device sync is available as a strictly optional, additive capability; every prior user story continues to work with sync disabled

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Validation and release-readiness work spanning all user stories

- [X] T095 [P] Run the full `quickstart.md` validation pass (all 10 scenarios) and record results
- [X] T096 [P] Performance-test with 2,000 seeded QuizItems and 10,000 seeded AnswerResults; confirm no noticeable list/search slowdown using the Dexie compound indexes from T009/T022 (SC-006)
- [X] T097 [P] Verify the 300ms screen-transition / answer-evaluation budget on the agreed target devices (SC-005)
- [X] T098 Cross-cutting review of every rewards/motivation surface (US5, T073) confirming no advertising, purchases, public leaderboards, or manipulative countdowns anywhere (FR-045)
- [X] T099 [P] Finalize build/deploy scripts: Angular production build + PWA install icons for Windows and Android (FR-067), and the `apps-script` `clasp push`/deploy script
- [X] T100 Final README pass covering local dev setup, seeding, and Apps Script deployment steps

---

## Phase 11: Post-Launch Enhancements (Interface Polish & AI-Assisted Authoring UX)

**Purpose**: Work completed after the initial Phase 1–10 implementation pass, in response to direct real-world usage feedback. Captured here (rather than folded silently into earlier phases) so tasks.md stays an accurate record of what shipped and when. Implements FR-025 (extended), FR-070–072, and a correctness fix within the existing FR-018 scope.

- [X] T101 [P] Harden the Google Sheets sync endpoint: convert `apps-script/` from a standalone script to a container-bound script scoped to `spreadsheets.currentonly` OAuth access (one spreadsheet only, not the parent's whole Drive), gated by a `SHARED_SECRET` Script Property (FR-054, FR-057, `contracts/sync-api.md`)
- [X] T102 [P] Replace placeholder profile credentials in `src/app/data/seed.ts` with the deployed installation's real fixed display names and credentials (FR-002, FR-006 — see spec.md Assumptions)
- [X] T103 Verify true offline PWA operation end-to-end with the origin server process actually stopped (not simulated), including a full child play-through and a successful Google Sheets sync once connectivity returns, without relaunching the app (FR-051, SC-003; quickstart.md §2)
- [X] T104 [P] Build the self-hosted `IconComponent` in `src/app/shared/icon/` (CSS `mask-image` over `public/icons/*.svg`, sourced at build time from `@material-symbols/svg-400`) and apply it across every screen for consistent, fully-offline iconography (FR-071)
- [X] T105 [US2/US3/US4/US6/US7] Build `ParentShellComponent` in `src/app/shared/shell/`: docked sidebar ≥900px, off-canvas hamburger-triggered drawer below it, wrapping every parent-facing route so none depends on the browser back button (FR-070, SC-014)
- [X] T106 [P] [US1] Redesign the Question screen (`src/app/features/child-play/question/`): progress bar, heart-icon lives display, and a countdown timer with a depleting-ring visual plus a low-time color/shake cue — always paired with the existing numeric `MM:SS` label, never motion-only (FR-072)
- [X] T107 [P] Add a decorative, `prefers-reduced-motion`-aware animated background (pure CSS, no image assets) applied globally in `src/styles.scss` (FR-072)
- [X] T108 [P] [US4] Add the AI-prompt generator to the Import Preview screen (`src/app/features/quiz-bank/import/import-preview/`): subject/grade/topic/count inputs, a generated ready-to-paste prompt embedding the package format rules and the template as a few-shot example, and a one-action clipboard copy (FR-025, `contracts/quiz-package-format.md` §AI prompt generator) (depends on T060)
- [X] T109 Fix true-false grading: `question.component.ts` was converting the submitted choice to a boolean before evaluation while `answer-evaluator.ts`'s `choice` rule kind compares choice ids by string equality, so every true-false answer graded as incorrect regardless of the child's choice; fixed by submitting the raw choice id like every other choice-based type (within existing FR-018 scope, surfaced while building T108's template)

**Note**: T101–T103 were operational/configuration hardening rather than new user-facing functional requirements and are not separately spec'd beyond the Assumptions/contract updates referenced above.

---

## Phase 12: Passage-Based / Multi-Question Items (FR-073–075)

**Purpose**: A shared reading passage or problem statement with several linked sub-questions — e.g. a paragraph with 3 comprehension questions, or a math word-problem with 2 follow-up sub-questions — extending the quiz bank, exercise builder, child-play, and AI import/export pipelines built in earlier phases.

- [X] T110 [P] Add the optional `passage: {passageId, title, text, order, total}` field to `QuizItem` and `QuizItemSnapshot` in `src/app/shared/models/domain.model.ts` (data-model.md §3/§7); denormalized onto every sub-question rather than a new synced entity, so `Attempt.itemSnapshots` gives it snapshot-immutability for free (FR-020, FR-073)
- [X] T111 [US2] Add `byPassage(passageId)` and `retextPassage(passageId, title, text)` to `QuizItemRepository` in `src/app/data/repositories/quiz-item.repository.ts` (FR-073)
- [X] T112 [US2] Build the Passage Editor screen in `src/app/features/quiz-bank/passage-editor/`: shared subject/grade/category/title/text fields plus ≥2 inline sub-question rows (single-choice/multiple-choice/true-false/short-text/number — match-pairs excluded, matching the pre-existing child-play gap noted in spec.md Assumptions), saving each row as its own `QuizItem` sharing one `passageId` (FR-073) (depends on T111)
- [X] T113 [US2] Wire `/quiz-bank/passages/new` and `/quiz-bank/passages/:passageId/edit` routes in `src/app/app.routes.ts`; add the "Thêm đoạn văn/bài toán nhiều câu hỏi" entry point and a passage badge/grouped-edit routing to `quiz-bank-list.component` (FR-073)
- [X] T114 [US2] In `attempt-resolver.service.ts`, exclude `item.passage`-linked items from random-group candidate resolution — a passage's sub-questions are only ever addable as a fixed block, never split by a random draw (FR-074)
- [X] T115 [US2] In `exercise-builder.component.ts`, make `addFixedItem` auto-add every sibling of a passage together (in `passage.order`) when any one of them is chosen, and make `removeItem` remove the whole sibling group together, so a passage is never partially present in an exercise (FR-074, SC-015)
- [X] T116 [P] [US1] Render the shared passage panel (title, text, "Câu N/M của đoạn này") above the prompt in `question.component.html` whenever the current item has `passage` set, reading from the existing `Attempt.itemSnapshots` snapshot with no lifecycle-service changes needed (FR-075); add the same panel to `quiz-item-preview.component` for parent preview (FR-021)
- [X] T117 [US4] Extend `QuizPackage`/`QuizPackagePassage` (formatVersion `1.1`), the Ajv schema, `PackageValidatorService` (passage-level atomic validation, `normalizePackagePassages` defaulting), `ImportPreviewService`, and `ImportCommitService` to support a `passages[]` array alongside `quizzes[]`, importing each passage as one atomic unit (FR-073–075, FR-028 exception, `contracts/quiz-package-format.md`)
- [X] T118 [P] [US4] Add a passage section to the Import Preview screen (select/skip per passage, inline error list) and extend `QuizExportService` to round-trip passage-grouped items back into `passages[]` rather than flattening them (FR-029, FR-073)
- [X] T119 [P] [US4] Add a worked passage example to `QUIZ_PACKAGE_TEMPLATE` and extend `buildAiPrompt` to document the `passages[]` format so AI-generated content can use it (FR-025, FR-073)

**Checkpoint**: Verified end-to-end via Playwright — manual passage authoring → exercise-builder auto-grouping (adding one sub-question added all siblings) → child play showing the passage panel on every sub-question → correct/incorrect grading both scored correctly; and separately, AI-template download → passage-aware import preview → commit → correctly grouped/badged in the quiz bank, with the pre-existing standalone-item import path unaffected (same valid/invalid counts as before this phase).

---

## Phase 13: Per-Question Timing Modes (FR-076–078)

**Purpose**: Beyond the exercise's own overall time limit (always still a hard backstop), let the parent choose no per-question cap, an evenly-distributed one, or an explicit custom one per item — requested directly by the parent after finding no per-item timer existed at all.

- [X] T120 [P] Add `QuestionTimingMode` (`'none' | 'distribute' | 'custom'`), `Exercise.questionTimingMode` (defaults to `'none'` when absent on older records), `ExerciseItem`'s `timeLimitSeconds` (fixed items) and `RandomGroupConfig.timeLimitSeconds`, and `Attempt.perQuestionSeconds`/`currentQuestionDeadlineAt` to `src/app/shared/models/domain.model.ts` (data-model.md §4/§4a/§6, FR-076)
- [X] T121 In `attempt-resolver.service.ts`, compute `ResolvedAttemptPlan.perQuestionSeconds` from the exercise's `questionTimingMode`: `distribute` splits `timeLimitMinutes*60` evenly across every resolved question; `custom` reads each resolved item's originating `ExerciseItem.timeLimitSeconds` (fixed) or `RandomGroupConfig.timeLimitSeconds` (random group), leaving items with no explicit value out entirely (FR-076)
- [X] T122 In `attempt-lifecycle.service.ts`: `start()` persists `perQuestionSeconds` and computes the first question's `currentQuestionDeadlineAt`; `advanceToNext()` recomputes it for whichever item is now current; new `expirePerQuestionTimeout()` ends only the current question (unanswered, not scored, no life lost — FR-077) and advances to the next question, or ends the attempt as `completed` if it was the last one — the existing overall-deadline `expireDueToTimeout()` path is untouched and still takes priority
- [X] T123 [P] [US1] In `question.component.ts/.html/.scss`, show a distinct per-question countdown badge (separate from the existing overall-exercise timer) whenever `Attempt.currentQuestionDeadlineAt` is set for the question on screen, and call `expirePerQuestionTimeout()` when it reaches zero (FR-078)
- [X] T124 [US2] In `exercise-builder.component.ts/.html/.scss`, add the three-way timing-mode selector; `custom` mode shows a per-second input next to each item/group in the item list; `distribute` mode shows a live-computed "~N giây/câu" preview (FR-076)
- [X] T125 [P] Carry `questionTimingMode` through `ExerciseRepository.duplicate()`, `seed-dev-data.ts`, and `learning-needs.component.ts`'s practice-exercise builder (all default to `'none'`, preserving prior behavior for exercises that don't opt in)

**Checkpoint**: Verified end-to-end via Playwright in all three modes — `custom` mode: only the item given an explicit seconds value showed a countdown badge; letting it expire without answering advanced to the next question with zero lives lost, and the exercise still completed normally afterward. `distribute` mode: the builder's live preview and the actual in-play countdown both matched `timeLimitMinutes*60 / question count`. `none` mode is the pre-existing, already extensively-tested default and was left completely unchanged.

---

## Phase 14: Child-Play Reliability Fixes & Immediate-Advance Flow (FR-012, FR-077)

**Purpose**: Two real scoring/skip bugs found by directly testing play (not by inspection), plus a requested UX change removing the in-play feedback panel in favor of instant advance.

- [X] T126 [US1] Fix a double-advance bug in `question.component.ts`: the "Tiếp theo" button and the `feedbackDelayMs` auto-advance `setTimeout` could both call `goNext()` for the same question if the child tapped Next before the delay elapsed, silently skipping a question and ending the attempt as Completed before every question was ever shown; `goNext()` now cancels the pending timeout on whichever path runs first
- [X] T127 [US1] Fix a reentrancy bug in `attempt-lifecycle.service.ts`'s `expirePerQuestionTimeout()`: Angular's `effect()` watching `attempt()` re-invoked the same timeout handler several times concurrently for one expiry (once per intermediate signal write, before the old deadline was cleared), costing multiple lives and skipping a question; now guarded by the same `_isEvaluating` reentrancy lock as `submitAnswer()`, awaiting the full mutation chain as one atomic unit
- [X] T128 [US1] Make a per-question timeout (`expirePerQuestionTimeout()`) remove one life via `ScoringService.loseLife()`/new `outOfLives()`, matching FR-077 as amended (previously removed none)
- [X] T129 [US1] Remove the in-play correct/incorrect feedback panel from `question.component.html`; `submit()` now calls `goNext()` immediately after `AttemptLifecycleService.submitAnswer()` resolves, for every question type, with no `feedbackDelayMs` auto-advance timer left to race against (FR-012)

**Checkpoint**: Verified via Playwright against the pre-fix build first (both bugs reliably reproduced — a skipped question ending the attempt early with lives to spare, and a per-question timeout jumping two questions at once while losing multiple lives), then against the fix (a 3-question exercise played by tapping Next as fast as possible showed all 3 positions with no skip; a per-question timeout on a live exercise lost exactly one life and advanced exactly one question).

---

## Phase 15: Exercise Builder Question Browser (FR-082–084)

**Purpose**: Replace the exercise builder's flat item dropdown — unusable once the bank holds hundreds of items — with a real browsing experience, requested directly after the dropdown became impractical.

- [X] T130 [US2] Build `QuizPickerComponent` (`src/app/features/exercise-builder/quiz-picker/`): a 4-column modal — category tree (grouped by subject) | item list | selected-item detail (prompt, choices with correct marked, type/difficulty/default points) | live added-items panel — filtered to the exercise's own grade and subject (Mixed shows both subjects), replacing the old flat `<select>` dropdown; selecting an item never hides the list (FR-082)
- [X] T131 [US2] Add per-item points and (Custom timing mode only) per-item time override inputs to the picker's detail view, emitted on add and applied to that exact `ExerciseItem` only, never the underlying `QuizItem` (FR-083); add `ExerciseItem.points` to `domain.model.ts` (data-model.md §4a) and apply it onto the resolved item's Attempt snapshot in `attempt-resolver.service.ts`, verified end-to-end to actually change scoring (not just display)
- [X] T132 [US2] Add the added-items running summary (question count, total points, total explicitly-set per-item time) to the picker (FR-084)
- [X] T133 [P] Fix a pre-existing bug uncovered while building the picker's grade filter: several numeric `<select>` bindings (`exercise-builder`'s grade select, `quiz-item-form`'s grade and difficulty selects, `passage-editor`'s grade select) wrote the native `<select>`'s string change value straight into a `number`-typed signal with no coercion, so strict-equality grade/difficulty filtering silently excluded any item whose grade/difficulty had been set through the UI; fixed by coercing on change (`+$event`, or a dedicated `setDifficulty()` setter for the `1|2|3` union)

**Checkpoint**: Verified via Playwright — created a 24-question exercise (20 standalone items + one auto-grouped 4-question passage) entirely through the picker with zero console errors, confirmed grade/subject filtering, per-item overrides, duplicate-add prevention, and the running totals all matched expectations, then confirmed the saved exercise round-tripped through assignment and play with the correct question count.

---

## Phase 16: Simplified Child Login (FR-002, FR-003)

**Purpose**: Remove the child PIN step entirely — requested directly; only the parent profile holds anything worth protecting locally.

- [X] T134 [US1] `SessionService.login()` now logs a `child`-role profile in on avatar selection alone (no credential check); the `parent` role's password check is unchanged. `ProfileSelectionComponent.select()` routes a child profile straight to a new `loginChild()` path instead of ever showing the credential form (FR-002, FR-003)
- [X] T135 [P] Remove the now-dead PIN UI: the `enterPin` i18n string, the credential form's role-based label ternary (now always "Nhập mật khẩu của bạn", since only the parent ever reaches that form), and the "Mã PIN mới" field in `settings.component.html` (shown only for the `parent` row now)

**Checkpoint**: Verified via Playwright — clicking a child avatar reaches `/child-home` directly with no credential form ever rendered; the parent flow is unchanged (wrong password still shows the retry error, correct password still reaches `/dashboard`).

---

## Phase 17: Result Detail, One-Time Exercises, Configurable Lives & Point Redemption (FR-079–081, FR-032, FR-085–087)

**Purpose**: The largest single bundle of the post-launch work — a full per-question result breakdown, a child's running point total, strictly-one-attempt-per-exercise enforcement, a configurable (3–10, or unlimited) life count replacing the fixed five, and a new parent-facing point-redemption feature with its own append-only history.

- [X] T136 [US1] Build the per-question result breakdown in `result.component.ts/.html`: joins `Attempt.resolvedItemOrder`/`itemSnapshots` against `AnswerResultRepository.listForAttempt()`, rendering each question's prompt, choices with correct/selected-wrong markers (or "Bạn trả lời .../Đáp án đúng ..." for text/number types), and an explicit "Chưa trả lời" state (with the correct answer still shown) for any question with no matching `AnswerResult` row (FR-079)
- [X] T137 [US1] Add `totalPoints` to `child-home.component.ts`, computed as `sum(Attempt.score) − sum(PointRedemption.points)` for the profile, shown as a new stat alongside the existing streak/stars/badges (FR-080, FR-087)
- [X] T138 [US1] Enforce one-attempt-per-exercise: add `AttemptLifecycleService.findMostRecentCompletedAttempt()` (public) and `loadAttempt()` (hydrates the service from a past Attempt without scoring or side effects); `start()` refuses outright if a finished Attempt already exists for the `(exerciseId, profileId)` pair (hard backstop, not just a UI check); `exercise-intro.component.ts` and `child-home.component.ts` check first and route to that past result (a new "Đã hoàn thành — Xem kết quả" state replacing the Start button) instead of ever calling `start()` (FR-081); remove the now-dead "Cho phép luyện tập lại"/"Lặp lại cùng câu hỏi mỗi lần" toggles from `exercise-builder.component.html` and the now-unreachable `repeatSameQuestions`-driven reuse branch from `start()`
- [X] T139 [US2] Make exercise lives configurable: `Exercise.lives`/`ExerciseSnapshot.lives`/`Attempt.livesRemaining` become `number | 'unlimited'` (data-model.md §4/§6); `ScoringService.applyAnswer()`/`loseLife()`/new `outOfLives()` treat `'unlimited'` as never decrementing and never triggering Try Again; `question.component.ts`'s heart display renders the exercise's own configured count (not a hardcoded 5) or an "∞" marker; add the 3–10-or-unlimited selector to `exercise-builder.component.html` (FR-032)
- [X] T140 [US8] Add the `PointRedemption` entity end-to-end: `domain.model.ts` (data-model.md §12), a `pointRedemptions` Dexie store via a new `db.version(2)` migration (existing stores carried forward unchanged), `PointRedemptionRepository` (`redeem`/`listForProfile`/`totalRedeemed`, append-only per the AnswerResult/Reward pattern), and wiring into every place that already enumerates synced/backed-up entities — `EntityTypeName`, `BatchBuilderService`, `sync-client.service.ts`'s `TABLE_BY_ENTITY`, and `BackupExportService`/`BackupImportService` (with a backward-compatible `?? []` fallback for older backup files predating this field) (FR-085, FR-087). Note: the separately-deployed `apps-script/` sync backend was deliberately **not** updated — it cannot be tested or redeployed from this environment; redemption records save, back up, and restore correctly regardless, but cross-device Google Sheets sync of them needs a matching backend update first.
- [X] T141 [US8] Build `RedeemPointsComponent` (`src/app/features/rewards/redeem/`, routed at `/redeem-points`, added to the parent shell nav): child selector (defaulted to the first child to avoid the same empty-signal `<select>` bug fixed in T133/`schedule.component`), current balance display, points+note input, a client-side over-balance guard (FR-086), and a redemption history list (FR-085, FR-087)

**Checkpoint**: Verified via Playwright end-to-end — a 3-lives exercise depleted by wrong answers ended as Try Again with a correct 6-question breakdown (5 correct-choice markers, 3 selected-wrong markers matching the 3 actually-submitted wrong answers) and replay correctly blocked afterward (home screen showed "Đã hoàn thành", clicking through reopened the same past result); a separate unlimited-lives exercise survived repeated wrong answers without ending early and displayed "∞"; a redemption flow earned 20 points, rejected a 999-point over-redemption with a clear message, accepted a 15-point redemption with a note, and confirmed both the parent's balance view and the child's own home-screen total dropped by exactly 15 and the history entry appeared.

---

## Phase 18: Simplified Import — No Grade/Type Picker, No Prompt Generator, No Approval Step (FR-025, FR-027–028, FR-030)

**Purpose**: Requested directly — the import screen should use each question's own grade/type from the file rather than a parent-chosen value, show a summary breakdown instead of listing every question, skip the AI-prompt-generator UI entirely, and commit items as immediately usable with no separate approval step.

- [X] T142 [US4] Remove the AI-prompt-generator section from `import-preview.component.ts/.html` (the `promptSubject`/`promptGrade`/`promptTopic`/`promptCount`/`generatedPrompt` signals, `generatePrompt()`/`copyPrompt()`) and delete the now-fully-unused `buildAiPrompt()`/`AiPromptInput` from `quiz-package-template.ts`; the screen now shows only the template-download button and the file picker before a file is chosen (FR-025)
- [X] T143 [US4] Add `ImportPreview.gradeTypeBreakdown` (`GradeTypeCount[]`) to `import-preview.service.ts`, computed from every standalone quiz and every passage question's own `grade`/`type` in the normalized package (items missing a grade are skipped here, already reflected in the invalid count); render it as a summary list in `import-preview.component.html` in place of any per-item list (FR-027, SC-022)
- [X] T144 [US4] Remove `CommitOptions.autoApprove` and the "Nhập và duyệt luôn" checkbox entirely; `ImportCommitService.commit()` now unconditionally saves every item as `reviewStatus: 'approved'` (FR-028); rename the commit button/method from "Duyệt và nhập" / `approveAndImport()` to "Nhập câu hỏi" / `importQuizzes()`
- [X] T145 [P] Add `src/app/data/migrations.ts`'s `approveAllPendingQuizItems()`, run from a new `provideAppInitializer` in `app.config.ts` alongside the existing `seedDevData()` call: sweeps any quiz item still carrying the old `needsReview` status (from before this change) to `approved`, a no-op once nothing is left pending — verified directly by injecting a legacy `needsReview` row into IndexedDB and confirming a reload converts it (FR-028)
- [X] T146 [US4] Remove the "Duyệt câu hỏi" bulk-review screen entirely (`src/app/features/quiz-bank/import/bulk-review/`, its route, and its parent-shell nav entry) now that nothing is ever pending; move its still-needed undo-last-import action onto the import screen itself — `importQuizzes()` now records the returned `importBatchId` and a "Hoàn tác lần nhập này" button calls the pre-existing `ImportCommitService.undoBatch()` right there (FR-030). The bulk-review screen's separate multi-item bulk-edit tool (grade/category/difficulty/tags/points/archive-status in one shot) is not preserved elsewhere — editing an imported item afterward is one-item-at-a-time via the ordinary quiz-bank editor, same as any other item.

**Checkpoint**: Verified via Playwright — the import screen shows only "Tải tệp mẫu (.json)" and the file picker before a file is selected (no AI-prompt section, no auto-approve checkbox); selecting a file with grade-1/single-choice ×2 and grade-2/short-text ×1 items showed a breakdown of exactly "Lớp 1 · single-choice: 2" and "Lớp 2 · short-text: 1"; clicking "Nhập câu hỏi" committed all 3 immediately (result text never mentions "chờ duyệt") and the items were immediately visible in the quiz bank; "Hoàn tác lần nhập này" was present and wired to the real batch id; "Duyệt câu hỏi" no longer appears anywhere in the parent nav; and a legacy `needsReview` item injected directly into IndexedDB was confirmed converted to `approved` after one app reload.

---

## Phase 19: Import Screen Polish — Collapsed Passages, Loading States, Result Popup (FR-027)

**Purpose**: Requested directly right after Phase 18 shipped — the passage list should default collapsed, both the file-read and the commit steps need a visible loading state, and a successful import should end in a popup whose Close fully resets the screen for the next import.

- [X] T147 [US4] Collapse the import preview's passage list by default: add `passagesExpanded` (defaults to `false`) to `import-preview.component.ts`, reset to `false` on every new file selection; the passage section header becomes a toggle button ("Đoạn văn/bài toán nhiều câu hỏi (N) — tất cả đã chọn" + rotating chevron) that shows/hides the existing per-passage checkbox list — the underlying selection state and default-all-included behavior are unchanged, only the default visibility (FR-027)
- [X] T148 [US4] Add `isReadingFile`/`isImporting` signals, set synchronously before the first `await` in `onFileSelected()`/`importQuizzes()` respectively (in a `try`/`finally` so a thrown error can't leave the UI stuck loading); show a spinning-icon "Đang đọc tệp…" row while reading and an in-button "Đang nhập…" state (button disabled) while importing (FR-027)
- [X] T149 [US4] Replace the inline post-import result text with a popup dialog (`showResultPopup`, matching the existing `quiz-picker` modal-overlay pattern for visual consistency): shows the "Đã nhập N câu hỏi." message and the undo-last-import button from T146; a new `closeResultPopupAndReset()` clears every preview/result signal back to its initial value and resets the file `<input>` element itself via a `#fileInput` `ViewChild` (`.value = ''`), so re-selecting the identical file afterward triggers a genuinely fresh read rather than a no-op (FR-027)

**Checkpoint**: Verified via Playwright — after selecting a file with one passage, the passage section rendered collapsed with the correct "tất cả đã chọn" summary text and its checkboxes defaulted to checked once expanded; committing the import showed the result popup with the correct count and a working undo button; clicking Close removed the popup, cleared the summary/breakdown from the page, and left the file input's value empty; re-selecting the exact same file immediately afterward produced a brand-new preview, confirming the reset was real rather than cosmetic.

---

## Phase 20: Named 5-Level Difficulty, Default-Category Import Fallback, Quiz Bank Tree Redesign (FR-017, FR-019, FR-022, FR-026, FR-035, FR-088)

**Purpose**: Requested directly — difficulty needed named levels beyond a plain 1–3 number; an imported item/passage with no category was being silently dropped instead of falling back to a default category; and the Quiz Bank management screen needed to become a Subject → Grade → Category → Quiz tree with an editable detail panel, so changing a quiz's category is visible immediately without leaving the page.

- [X] T150 [US2] Widen `QuizDifficulty` from `1|2|3` to `1|2|3|4|5` in `domain.model.ts`; add `src/app/shared/difficulty.ts` (`DIFFICULTY_LABELS`, `DIFFICULTY_LEVELS`, `difficultyLabel()`, `coerceDifficulty()` defaulting out-of-range input to 2); update every place that read/wrote a raw 1–3 difficulty number — `quiz-package.schema.ts` (schema max 3→5), `quiz-package.model.ts`, `exercise-builder.component.ts`'s random-group default (`difficultyMax` 3→5), `quiz-picker.component.ts/.html` (display via `difficultyLabel()`), `passage-editor.component.ts` (`SubQuestionRow.difficulty`, blank-row default 1→2), `quiz-item.repository.ts`'s `QuizItemFilter`, and `import-commit.service.ts`'s two `?? 1` defaults (now `?? 2`) — so every surface shows/accepts the same 5 named levels with the same default (FR-017, FR-035)
- [X] T151 [US2] In `quiz-item-form.component.ts/.html`, replace the difficulty `<select>`'s raw `1`/`2`/`3` options with `DIFFICULTY_LEVELS` (Dễ/Trung bình/Khó/Rất khó/Chuyên gia), default signal value `2`, coercing any select-change event through `coerceDifficulty()` (FR-017)
- [X] T152 [US2] Fix `PackageValidatorService.validate()` so a standalone item or passage with no `category` field at all still resolves a `CategoryResolution` — via `resolveCategory(item.category ?? { name: DEFAULT_CATEGORY_NAME }, ...)` (new exported `DEFAULT_CATEGORY_NAME = 'Khác'` constant), reusing the existing lookup-existing-else-propose-new logic unchanged — instead of leaving that item's resolution `undefined`, which previously caused `ImportCommitService.resolveCategoryId()`/`commit()` to silently skip the item entirely (FR-022, FR-026)
- [X] T153 [P] [US2] Dedupe `ImportPreviewService`'s `proposedCategories` by `(subject, normalizedName)` into a `Map`, adding a `count` field (how many items proposed it) instead of one row per item — needed because T152 means many items missing a category now all propose the same default "Khác" row; render `count` in `import-preview.component.html`'s proposed-categories list
- [X] T154 [US2] Refactor `QuizItemFormComponent` to work embedded as well as routed: new `@Input() itemId?: string`, `@Input() embedded = false`, `@Output() saved = new EventEmitter<QuizItem>()`; `ngOnInit()` bails out when `embedded` (state is driven by `[itemId]` instead), a new `ngOnChanges()` reloads via a shared `loadItem()`/`resetToBlank()` pair whenever the embedded `itemId` input changes; `save()` emits `saved` with the created/updated item instead of navigating to `/quiz-bank` when `embedded` is true. The routed `/quiz-bank/new` and `/quiz-bank/:id/edit` pages are unchanged (FR-088)
- [X] T155 [US2] Redesign `QuizBankListComponent`/`.html`/`.scss` from a flat searchable table into a two-column layout: a left-hand collapsible tree (`tree` computed signal grouping `items()` by subject → grade → categoryId, category names resolved from a loaded `categories()` list) with expand/collapse state in a `collapsedKeys` Set, and a right-hand detail panel embedding `<app-quiz-item-form [itemId]="selectedItemId()" [embedded]="true" (saved)="onSaved($event)">`; selecting a non-passage leaf sets `selectedItemId`, "Thêm câu hỏi" clears it to enter create mode, and `onSaved()` reloads the tree and re-selects the saved item so a category change is reflected in the item's new tree location immediately. Preview/Duplicate/Archive/Delete move into a small toolbar above the detail panel, operating on the currently-selected item; a passage-grouped leaf still routes to the existing passage editor rather than opening in the panel (FR-019, FR-088)

**Checkpoint**: Verified via Playwright against the real built app. Difficulty: the quiz-item-form's difficulty select showed all 5 named levels (Dễ/Trung bình/Khó/Rất khó/Chuyên gia) and a newly-created item defaulted to "Trung bình" with no explicit selection. Default-category import: importing a 2-item package where neither item specified `category` showed "Danh mục mới: 1" (deduped, not 2) proposing "Khác", committed successfully (not skipped), and both items appeared in the tree under Toán → Lớp 3 → Khác afterward. Tree + detail panel: the quiz bank rendered a Toán/Tiếng Việt → grade → category tree matching seeded data; clicking a leaf loaded its data into the embedded form; creating a brand-new category via the Categories screen, then selecting an existing quiz, changing its category to the new one, and pressing Save moved that quiz to the new category's branch of the tree with no page reload, while the sibling item left behind in the old category remained there; adding a new quiz through "Thêm câu hỏi" (grade 2, math, category "Số học") appeared correctly nested under a newly-created Lớp 2 branch immediately after save.

---

## Phase 21: Quiz Bank Tree Bulk Actions — Change Grade / Delete All Quizzes in a Category Node (FR-089)

**Purpose**: Requested directly — one-at-a-time grade edits and deletes in the Quiz Bank tree were tedious when an entire category (within one grade) needed to move to a different grade or be removed outright; each category node in the tree now gets its own bulk grade-change and bulk-delete actions, scoped to exactly the items grouped under that node.

- [X] T156 [US2] Add `bulkGradeEditKey`/`bulkGradeValue`/`bulkDeleteConfirmKey` signals and `startBulkGradeChange()`/`cancelBulkGradeChange()`/`confirmBulkGradeChange()`/`startBulkDelete()`/`cancelBulkDelete()`/`confirmBulkDelete()` methods to `QuizBankListComponent`; bulk grade-change calls `QuizItemRepository.update(id, {grade})` for every item in the target `CategoryGroup`, bulk delete calls `softDelete(id)` for every item in it (closing the detail panel first if the currently-selected item is among them), both followed by a tree `reload()` (FR-089)
- [X] T157 [US2] [P] Add a small icon-button pair ("Đổi lớp cả danh mục" / "Xóa cả danh mục", reusing the existing `edit`/`delete` icons) to each category node's header row in `quiz-bank-list.component.html`, restructured into a `.category-header` flex row (toggle button + bulk-actions) since two sibling buttons can't nest inside the existing toggle `<button>`; an inline form (grade `<select>` + Xác nhận/Hủy) appears under the node when its bulk-grade action is active, and an inline confirmation ("Xóa toàn bộ N câu hỏi…?" + Xóa tất cả/Hủy) appears when its bulk-delete action is active — both scoped by comparing the open signal's value against that node's own `CategoryGroup.key` (FR-089)

**Checkpoint**: Verified via Playwright against the real built app — clicking a category node's bulk grade-change button, picking a new grade, and confirming moved every item under that exact (subject, grade, category) node to the new grade branch of the tree immediately (1-item Tiếng Việt → Lớp 1 → Số học node moved intact to Lớp 3), while the separate Toán → Lớp 1 → Số học node (2 items) was completely untouched; clicking that same (now Lớp 3) node's bulk-delete button, confirming, removed every item in it (the whole now-empty Tiếng Việt subject branch disappeared from the tree), again with the Toán branch unaffected.

---

## Phase 22: Exercise Builder Bulk Random-Add by Category (FR-082, FR-084, FR-090)

**Purpose**: Requested directly — adding many questions to an exercise one click at a time was tedious; the question browser's detail panel now offers a bulk random-add form whenever no single item is selected, letting the parent draw a whole batch of distinct, non-duplicate quiz items from a category (and difficulty) at once.

- [X] T158 [US2] Add `pickedMany` output, `bulkDifficulty`/`bulkCount`/`bulkSeconds`/`bulkPoints`/`bulkMessage` signals, a `bulkPool()` method, and `setBulkDifficulty()`/`confirmBulkAdd()` methods to `QuizPickerComponent`; `bulkPool()` narrows `filteredItems()` (the same category/search-scoped list already shown in the middle panel) to the chosen difficulty, excludes passage items entirely (mirrors a random *group*'s own candidate resolution, so a passage can never be split by a bulk draw), and excludes anything `isAdded()`; `confirmBulkAdd()` Fisher-Yates-shuffles the pool, takes the requested count (or fewer if the pool is smaller), and emits one `pickedMany` array carrying every drawn id plus the shared time/points override, then reports exactly how many were added (FR-090)
- [X] T159 [US2] Replace the detail panel's "Chọn một câu hỏi…" placeholder in `quiz-picker.component.html` with the bulk random-add form (difficulty select, count, conditional per-question-time field, points field, live pool-count, Add button disabled at 0, result message) whenever `selectedItem()` is empty — clicking an individual quiz row still shows its existing single-item detail/add flow unchanged (FR-082, FR-090)
- [X] T160 [US2] Add `onQuizPickedMany()` to `ExerciseBuilderComponent`, appending every payload as a `fixed` `ExerciseItem` in one `items.update()` (re-checking for duplicates against the current item list as a second guard, on top of the picker's own exclusion); wire `(pickedMany)="onQuizPickedMany($event)"` on `<app-quiz-picker>` (FR-090)

**Checkpoint**: Verified via Playwright against the real built app. A real reactivity bug was found and fixed before this checkpoint passed (see tasks.md's Notes / checklists/requirements.md addendum): `bulkPool` was first written as a `computed()`, but since it read the plain (non-signal) `@Input() existingItems` through `isAdded()`, it never invalidated when new items were added — the displayed pool count stayed wrong (still showing 8 immediately after adding 4 of those 8) until an unrelated signal dependency changed. Fixed by making `bulkPool` a plain method, matching how `isAdded()`/`totalPoints()` already handle the same plain `@Input()` elsewhere in this exact component. After the fix: importing 6 fresh "Số học" items (plus 2 pre-existing seed items at the same difficulty, 8 total) and bulk-adding 4 at Dễ difficulty added exactly 4 distinct items and correctly showed a live pool count of 4 remaining; bulk-adding 4 more added exactly the remaining 4 (8 total, zero duplicates); requesting 50 against an exhausted 2-item pool added exactly 2 with a "Chỉ thêm được 2/50 câu" message, and the Add button then showed disabled at a pool of 0.

---

## Phase 23: Daily Exercises — Renews Daily, Category/Difficulty Slots Only, No Specific Quiz (FR-091, amends FR-015/FR-032/FR-035/FR-081)

**Purpose**: Requested directly — a new "daily exercise" kind that a child can replay once per calendar day, each time with a freshly randomized question set; the parent can only ever add content by category/difficulty/count/time/points "slot", never a specific quiz, and can add multiple such slots to build up the full daily set.

- [X] T161 [US2] Add `Exercise.isDaily?: boolean` (default `false`) and `RandomGroupConfig.pointsOverride?: number` to `domain.model.ts`; apply `pointsOverride` in `AttemptResolverService.resolveWithSeed()`'s random-group branch the same way a fixed item's own `points` override is already applied — a frozen Attempt-snapshot-only override, never mutating the underlying QuizItem (FR-091, FR-035)
- [X] T162 [US2] Add `AttemptLifecycleService.findCompletedAttemptToday()` (a local-calendar-date-scoped variant of the existing `findMostRecentCompletedAttempt()`, using a `localDateOf()` helper matching the same pattern already duplicated per-file in `streak.service.ts`/`daily-bonus.service.ts`); branch `start()`'s one-attempt guard on `exercise.isDaily` to use it instead of the normal "ever" check — a daily exercise's `resolveNew()` call already draws a fresh random set on every `start()`, so no extra logic is needed to make a new day's attempt re-randomized (FR-091, FR-015, FR-081)
- [X] T163 [US2] [P] Apply the same `isDaily`-aware branching to `ChildHomeComponent.completedAttempt` and `ExerciseIntroComponent.start()`'s prior-completion check — both previously called the "ever" variant unconditionally, which would have kept showing "Xem kết quả" forever for a daily exercise instead of ever offering Start again the next day (FR-081, FR-091)
- [X] T164 [US2] Add `QuizPickerComponent`'s `[dailyMode]` input and `(addedRandomGroup)` output: individual-item `selectItem()` becomes a no-op in `dailyMode`, and the detail panel's "no item selected" form swaps its hint/button copy and Add handler to a new `confirmAddRandomGroup()`, which emits a ready-to-store `RandomGroupConfig` (scoped to the exercise's own grade/subject, the currently-selected category, chosen difficulty as both `difficultyMin`/`difficultyMax`, count, and the time/points overrides) instead of resolving any concrete quiz right now (FR-091, FR-090)
- [X] T165 [US2] Add `ExerciseBuilderComponent.isDaily` signal and its "Bài tập hàng ngày" checkbox; toggling it on strips any existing fixed items from `items()` immediately; `save()` refuses (via the existing `warnings` mechanism) if any fixed item is present while `isDaily` is true, as a hard backstop behind the UI-level stripping; the raw "+ Thêm nhóm ngẫu nhiên" button (which bypasses category/difficulty scoping) is hidden while daily, leaving the picker's guided `dailyMode` flow as the only way to add content; wire `onAddedRandomGroup()` to append the picker's emitted config as a new `randomGroup` item (FR-091)
- [X] T166 [US2] [P] Add a "Hàng ngày" badge (child-home's today-exercise card and the exercise-library table) and enrich the random-group summary shown in the picker's "added" panel and the builder's own item list to include category name(s), difficulty, points override, and time (e.g. "Số học · Dễ · 3 điểm/câu · không giới hạn riêng") instead of just a bare question count — needed so a daily exercise's slot-only item list is still legible at a glance, per the "just show an entry like 5 default hard quiz, 3 point per quiz, 30s" request

**Checkpoint**: Verified via Playwright against the real built app, in two passes. Builder: toggling "Bài tập hàng ngày" on hid the raw random-group button and disabled every individual quiz row in the picker (clicking one did nothing, the slot-add form stayed showing); configuring Dễ/5-questions/3-points-per-question and adding, then a second 2-question slot, produced exactly 2 `randomGroup` items whose summaries correctly read "5 câu · Số học · Dễ · 3 điểm/câu" / "2 câu · Số học · Dễ · 3 điểm/câu", with the picker's running total showing 15 + 6 = 21 points (computed purely from `count × pointsOverride`, with no concrete items resolved yet); the saved exercise showed a "Hàng ngày" badge in the library. Play + renewal: assigned to a child, played to completion with zero duplicate questions shown across the exercise's two slots; the child's home screen correctly switched to "Đã hoàn thành … quay lại vào ngày mai" (Start blocked); the just-created attempt's `startedAt`/`completedAt` were then rewritten directly in IndexedDB to 3 days in the past (simulating "a new day began" without waiting); reloading and logging back in as the same child showed the Start button again instead of "Xem kết quả," confirming the daily-renewal gate is scoped to the local calendar day and not "ever."

---

## Phase 24: Difficulty "All" Option, Legacy-Difficulty Default Everywhere, Passage Per-Question Override Fix (amends FR-017/FR-083/FR-090)

**Purpose**: Requested directly, three related fixes to the exercise-builder's question browser. (1) The bulk-add/daily-slot difficulty picker needed an "All" option to draw from every difficulty at once, not just one level at a time. (2) A quiz item with no `difficulty` stored (legacy data predating the field) was only defaulted to 2/Trung bình at import time — every other read site (editing, difficulty-range matching, bulk-add pool matching, display) needed the same default so such an item behaves identically to one that was always Trung bình, everywhere. (3) A real bug: adding one question of a multi-question passage with a per-question time/points override configured only applied that override to the specific question clicked, silently leaving its pulled-in siblings with none at all.

- [X] T167 [US2] Widen `QuizPickerComponent.bulkDifficulty` from `signal<QuizDifficulty>` to a new local `BulkDifficultySelection = QuizDifficulty | 'all'` type (this "All" concept is specific to the bulk/daily-slot picker — a single QuizItem's own difficulty field, and `DIFFICULTY_LEVELS`/`DIFFICULTY_LABELS` in `shared/difficulty.ts`, are untouched and still always one concrete level); add `bulkDifficultyOptions` (`[{value:'all', label:'Tất cả độ khó'}, ...DIFFICULTY_LEVELS]`) for the template's `<select>`; `setBulkDifficulty()` recognizes the literal `'all'` string ahead of `coerceDifficulty()`; `bulkPool()` skips the difficulty check entirely when `'all'` is selected; `confirmAddRandomGroup()` maps `'all'` to `difficultyMin: 1, difficultyMax: 5` on the stored `RandomGroupConfig`, since it has no separate "any difficulty" marker of its own
- [X] T168 [US2] [P] Make `difficultyLabel()` (`shared/difficulty.ts`) accept `QuizDifficulty | undefined`, defaulting a missing value to 2/Trung bình's label — this alone fixes every display call site that already passes a live `QuizItem.difficulty` (Quiz Bank tree badge, quiz-picker's single-item detail line) with no per-call-site change needed; separately default every *matching* read site the same way, since a label default can't cover a comparison: `QuizPickerComponent.bulkPool()`, `AttemptResolverService.resolveRandomGroup()`'s candidate filter, `RandomGroupCheckService.checkSatisfiable()`'s candidate filter, and `QuizItemRepository.search()`'s `filter.difficulty` comparison, all changed from `item.difficulty` to `(item.difficulty ?? 2)`; also fix the two remaining *write* sites that were silently propagating an undefined value forward without ever healing it — `QuizItemFormComponent.loadItem()` and `PassageEditorComponent.rowFromItem()` — to `existing.difficulty ?? 2` (FR-017)
- [X] T169 [US2] Fix `ExerciseBuilderComponent.addFixedItem()` to return the quiz item ids it actually newly added (every sibling, in passage order, when the clicked item belongs to a passage — same set it already computed internally, just not previously exposed) instead of `void`; `onQuizPicked()` now applies the picker's time/points override to every one of those returned ids in a loop, instead of looking up only the single `payload.quizItemId` that was clicked (FR-083)

**Checkpoint**: Verified via Playwright against the real built app. All option + legacy default: injected a quiz item with no `difficulty` field directly into IndexedDB — it displayed with a "Trung bình" badge in the Quiz Bank tree; in the exercise builder's picker, the difficulty select showed "Tất cả độ khó" as its first, default option; with All selected the pool count included the legacy item plus 2 Dễ-level seed items (3 total); switching to "Trung bình" narrowed the pool to exactly the legacy item (1); switching to "Dễ" narrowed it to exactly the 2 seed items (2), excluding the legacy one — proving the default applies consistently to both display and matching. Passage override fix: authored a 2-question passage, then in the exercise builder added only its first sub-question via the single-item flow with a 45-second/8-point override configured — both resulting exercise items (question 1 *and* question 2, pulled in as a sibling) showed the identical 45s/8-point override, where before the fix only the clicked question would have received it.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS every user story phase
- **User Stories (Phases 3–9)**: All depend on Foundational completion only
  - US1 (P1) has no dependency on any other user story and is the recommended MVP
  - US2 (P2) depends only on Foundational; it deepens the content/scheduling that US1 consumes but does not require US1's UI to be built first
  - US3 (P3) reads Attempt/AnswerResult data produced by US1 — build US1 first for a meaningful independent test, though the code itself only depends on Foundational
  - US4 (P4) extends the quiz bank from US2 (T042–T046) with an import pipeline; build US2 first
  - US5 (P5) wires into US1's Child Home/Result screens (T074 depends on T032/T036) — build US1 first
  - US6 (P6) is independent of every other story's logic (pure export/import/reset of whatever data exists)
  - US7 (P7) is additive to all local data produced by any other story; build it last since it has the largest, most isolated surface (its own `apps-script/` project)
- **Polish (Phase 10)**: Depends on whichever user stories are in scope for the release

### Parallel Opportunities

- All Setup tasks marked [P] (T002–T008) run in parallel after T001
- Within Foundational, T010–T013 and T015 and T017–T025 are marked [P] once their direct predecessor (if any) is done
- Once Foundational (T009–T026) is complete, teams can work US1 through US6 fully in parallel; US7 can also start in parallel since its `apps-script/` half (T080–T084) has no dependency on the other stories, though its client half depends on Foundational's sync-envelope schema (T009)
- Within each story, tasks marked [P] touch different files and can run together; unmarked tasks depend on a preceding task in the same story

---

## Parallel Example: User Story 1

```bash
# After Foundational is complete, launch these together:
Task: "Implement AttemptRepository in src/app/data/repositories/attempt.repository.ts"
Task: "Implement AnswerResultRepository in src/app/data/repositories/answer-result.repository.ts"

# Then, once the above land, these screens can proceed together:
Task: "Build the Child Home screen in src/app/features/child-play/child-home/"
Task: "Build the Exercise Introduction screen in src/app/features/child-play/exercise-intro/"
Task: "Build the Exercise Result screen in src/app/features/child-play/result/"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational) — the latter is a hard blocker
2. Complete Phase 3 (User Story 1)
3. **STOP and VALIDATE**: run quickstart.md steps 1–4 against User Story 1 alone
4. Demo: a child can play a full daily exercise offline, end-to-end

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. + US1 → MVP: child can practice daily (demo-able)
3. + US2 → parent can author and schedule content (no more hand-seeded data needed)
4. + US3 → parent gets visibility into progress and weak areas
5. + US4 → AI-assisted content authoring speeds up US2
6. + US5 → motivation layer makes daily practice more engaging
7. + US6 → backup/restore safety net, offline reliability finalized
8. + US7 → optional multi-device sync, fully additive
9. Phase 10 → cross-cutting validation and release polish

### Suggested Team Split (if parallelized)

- Developer A: US1 → US5 (both touch `child-play`/`rewards` and are naturally sequenced)
- Developer B: US2 → US4 (both touch `quiz-bank`/`exercise-builder`)
- Developer C: US3 (dashboard, reads what A/B produce) → US6 (backup, independent)
- Developer D: US7 (`apps-script/` + `sync-engine/`, the most isolated surface)

---

## Notes

- [P] tasks touch different files with no dependency on an incomplete task
- [Story] labels map every phase-3+ task to its user story for traceability
- Every user story phase is independently testable per its stated Independent Test
- Commit after each task or logical group; stop at any checkpoint to validate a story in isolation
- Total: 169 tasks (T001–T169) — T001–T100 from the initial implementation pass, T101–T109 from Phase 11 post-launch enhancements, T110–T119 from Phase 12 passage-based/multi-question items, T120–T125 from Phase 13 per-question timing modes, T126–T129 from Phase 14 child-play reliability fixes, T130–T133 from Phase 15 exercise builder question browser, T134–T135 from Phase 16 simplified child login, T136–T141 from Phase 17 result detail/one-time exercises/configurable lives/point redemption, T142–T146 from Phase 18 simplified import (no grade/type picker, no prompt generator, no approval step), T147–T149 from Phase 19 import screen polish (collapsed passages, loading states, result popup), T150–T155 from Phase 20 named 5-level difficulty, default-category import fallback, and the Quiz Bank tree + detail-panel redesign, T156–T157 from Phase 21 Quiz Bank tree bulk actions (change grade / delete all quizzes in a category node), T158–T160 from Phase 22 exercise builder bulk random-add by category, T161–T166 from Phase 23 daily exercises (renews daily, category/difficulty slots only), T167–T169 from Phase 24 difficulty "All" option, legacy-difficulty default everywhere, and the passage per-question override fix
- User Story 8 (point redemption, P8) is new as of 2026-09-18 — added directly to spec.md alongside US1–US7, its tasks (T140–T141) labeled `[US8]` following the same convention
