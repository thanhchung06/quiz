# Child Learning Exercise Application Requirements

*Local first Angular PWA for daily mathematics and language practice*

Version 2.0 \| Product requirements \| Offline first synchronization scope

# Purpose and product decision

This document defines an offline-first learning application for two children and one parent. The application will make short daily practice enjoyable, give each child immediate feedback, and let the parent create exercises and review progress. It will use one Angular Progressive Web Application codebase, install on Windows and supported mobile browsers, and continue working after its files have been cached.

IndexedDB is the operational database on every device. Optional Google synchronization stores parent and child data in a Google Sheet through a Google Apps Script synchronization endpoint. The application continues working when Google is unavailable. The product intentionally avoids online classrooms, role administration, enterprise audit, messaging, and a custom application server.

# Goals

- A child can start the daily exercise in no more than three actions after login.

- Each question is clear, focused, and displayed on its own screen.

- Practice feels playful through lives, points, streaks, celebrations, and unlockable rewards.

- A parent can reuse quiz-bank questions to assemble an exercise without editing application code.

- A parent can understand each child's activity, accuracy, completion, and areas needing practice.

- The installed application works without an active web server after the required files are cached.

# Scope

| **Included in the current release scope**             | **Excluded from the current release scope**         |
|-------------------------------------------------------|-----------------------------------------------------|
| Two fixed child profiles and one fixed parent profile | Registration, password recovery, or online identity |
| Mathematics and language content                      | Other subjects or classroom course management       |
| Five grade levels                                     | Automatic curriculum alignment                      |
| Quiz bank and exercise builder                        | Collaborative authoring or approval workflows       |
| Daily exercises, five lives, and exercise timer       | Live multiplayer or social messaging                |
| Local progress with optional Google Sheet sync        | Real-time collaboration or cloud analytics          |
| Export and import backup                              | Enterprise security, RBAC, and audit logs           |
| Dynamic categories and AI quiz package import         | Built-in AI generation service                      |

# Definitions and assumptions

| **Term**       | **Definition**                                                                                                           |
|----------------|--------------------------------------------------------------------------------------------------------------------------|
| Quiz item      | One reusable question stored in the quiz bank, including prompt, answer rules, feedback, subject, grade, and difficulty. |
| Exercise       | An ordered set of quiz items assigned for practice, with a time limit, availability, and reward settings.                |
| Grade          | A content level from Grade 1 through Grade 5. It is not the score received for an answer.                                |
| Health         | Five lives available at the start of an exercise. An incorrect submitted answer removes one life.                        |
| Daily exercise | The exercise selected for a child on a calendar day. The parent may use a schedule or a default rotation.                |
| Completion     | The child answers all questions before time or lives reach zero. Completion can be successful or unsuccessful.           |

Assumption to confirm: the phrase five grades means Grade Levels 1 through 5. Questions must be completed in their configured order unless the parent enables random order for that exercise.

# Users and access

| **Profile** | **Authentication**                                         | **Main capabilities**                                                                                   |
|-------------|------------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| Child One   | Select avatar and enter a fixed four digit PIN or password | Open today's exercise, answer questions, see feedback, collect rewards, and view personal progress.     |
| Child Two   | Select avatar and enter a fixed four digit PIN or password | Same capabilities as Child One with separate progress and settings.                                     |
| Parent      | Select Parent and enter a fixed password                   | Manage quiz bank, build and assign exercises, configure rules, review both children, and manage backup. |

Credentials are defined in the local application configuration for the current release. The parent can change display names, avatars, and local PINs after login if this optional setting is implemented. Security against a technically skilled user is outside scope.

# Child experience

## Daily journey

1.  The child opens the installed app and selects their avatar.

2.  The child enters their PIN or password.

3.  The home screen shows today's exercise, current streak, earned stars, and a friendly start button.

4.  The exercise introduction shows subject, number of questions, five lives, time limit, and possible reward.

5.  The child answers one question per screen and receives immediate feedback.

6.  After every answer, the app saves the result and advances to the next question.

7.  The result screen celebrates completion and shows score, accuracy, time, remaining lives, rewards, and optional corrections.

## Child functional requirements

**CH 01 Child login**

The login screen shall display the two child avatars and the parent profile.

- A correct credential opens only the selected profile.

- An incorrect credential shows a friendly message and allows another attempt.

- Logging out returns to profile selection.

**CH 02 Child home**

The child home screen shall prioritize the current daily exercise.

- The screen shows subject, title, question count, estimated time, grade, and completion state.

- The child can view current streak, star total, recent badges, and the last seven days of activity.

- A completed daily exercise cannot accidentally create a duplicate attempt; the child may replay it as practice if enabled.

**CH 03 Exercise start**

Before starting, the app shall show the exercise rules and initialize the attempt.

- The attempt starts with five lives and the configured exercise time limit.

- The timer begins only after the child presses Start.

- The app records the start date and time locally.

**CH 04 Question screen**

The app shall display exactly one quiz item per screen.

- The screen shows question position, remaining lives, and remaining time.

- The answer button remains disabled until the child provides a valid response.

- The layout uses large touch targets, readable text, and optional audio playback for language prompts.

- Previously submitted answers cannot be changed during the scored attempt.

**CH 05 Answer feedback**

The app shall evaluate each submitted answer locally and provide immediate feedback.

- A correct answer displays a brief positive animation and awards configured points.

- An incorrect answer removes one life, displays an encouraging correction or hint, and records the response.

- Feedback does not reveal answers before the child submits.

- The child presses Next, or the screen advances automatically after a short configurable delay.

**CH 06 End conditions**

An attempt shall end when all questions are answered, time expires, or no lives remain.

- Completing all questions produces a Completed result.

- Time expiration produces a Time Up result and preserves answered questions.

- Losing all five lives produces a Try Again result and preserves answered questions.

- Every end condition saves the final status, score, duration, and question results.

**CH 07 Resume interrupted attempt**

The app shall save progress after every submitted answer.

- If the app closes unexpectedly, the child can resume from the next unanswered question.

- The timer uses the stored deadline so closing the app does not reset it.

- The parent may reset an unfinished attempt.

# Quiz bank

## Supported question types

| **Type**        | **Example use**                            | **Answer behavior**                                        |
|-----------------|--------------------------------------------|------------------------------------------------------------|
| Single choice   | Select the correct word or calculation     | One correct option from two to six choices                 |
| Multiple choice | Select all vowels or all correct equations | One or more correct options; all required for correctness  |
| Short text      | Spell a word or provide a short answer     | Trim spaces; configurable case and punctuation sensitivity |
| Number          | Enter the result of a calculation          | Numeric comparison with optional accepted range            |
| True or false   | Evaluate a statement                       | Two large answer buttons                                   |
| Match pairs     | Match words to meanings                    | All pairs required; touch friendly interaction             |

Single choice, short text, and number questions form the minimum viable set. The remaining types are recommended additions after the core exercise flow is stable.

**QB 01 Create quiz item**

The parent shall be able to add a quiz item to the local bank.

- Required fields are title or short identifier, subject, grade, question type, prompt, and correct answer.

- Optional fields are explanation, hint, image, audio, tags, difficulty from one to three, and points.

- The app validates the answer configuration before saving.

**QB 02 Manage quiz items**

The parent shall be able to view, edit, duplicate, preview, archive, and delete quiz items.

- The bank can be filtered by mathematics or language, Grade 1 through Grade 5, question type, difficulty, and tag.

- Search matches the prompt, identifier, and tags.

- Deleting a used item does not alter historical attempt records; the app stores an attempt snapshot.

**QB 03 Preview quiz item**

The parent shall be able to preview a question as the child will see it.

- Preview includes answer interaction and feedback.

- Preview activity does not affect child progress.

## Dynamic categories

Categories shall be parent-managed records rather than a fixed application list. Each quiz item shall reference one primary category by stable category ID and may also contain multiple tags. Category names shall be unique within a subject, but mathematics and language may use the same category name.

| **Field** | **Purpose** |
|---|---|
| `id` | Permanent generated UUID used by quiz references |
| `name` | Parent-facing category name |
| `normalizedName` | Trimmed lowercase name used for duplicate detection |
| `subject` | Mathematics, language, or both |
| `description` | Optional parent description |
| `color` and `icon` | Optional visual presentation |
| `status` | Active or archived |
| `localVersion` | Current local record version |
| `lastGoogleVersion` | Google version seen during the last successful sync |

**CAT 01 Manage categories**

The parent shall be able to create, rename, describe, archive, restore, and merge categories. The category screen shall show the number of quiz items referencing each category.

- Renaming a category shall not change quiz references.
- A referenced category cannot be permanently deleted until its quiz items are moved or archived.
- Merging categories shall update all quiz references as one change group.
- Archived categories remain readable in existing exercises and attempt history but are hidden from new exercise filters by default.

**CAT 02 Select or create category**

When creating a quiz, the parent shall be able to select an existing category or create a new category without leaving the quiz form.

- The app shall check exact and normalized names before creating a category.
- Differences in capitalization and surrounding spaces shall not create a new category.
- Similar names shall produce a warning and allow the parent to select an existing category or continue with the new one.

**CAT 03 Resolve imported categories**

An imported quiz may reference a category using an external key and name.

```json
{
  "category": {
    "externalKey": "arithmetic",
    "name": "Arithmetic",
    "subject": "math"
  }
}
```

The importer shall match by external key first and normalized name plus subject second. If no category exists, it shall propose a new category. Proposed categories, possible duplicates, and subject mismatches shall appear in the import preview. The parent must approve, rename, or map proposed categories before quiz items are saved.

## AI quiz template and import

**QB 04 Provide quiz generation template**

The application shall provide a downloadable JSON template and a copyable AI instruction. The template shall document supported question types, required fields, subjects, grades, answer rules, category references, validation rules, and examples.

```json
{
  "formatVersion": "1.0",
  "packageTitle": "Grade 3 Addition Practice",
  "language": "en",
  "quizzes": [
    {
      "externalId": "math-g3-addition-001",
      "subject": "math",
      "grade": 3,
      "category": {
        "externalKey": "arithmetic",
        "name": "Arithmetic"
      },
      "tags": ["addition", "two-digit"],
      "difficulty": 1,
      "type": "single-choice",
      "prompt": "What is 24 + 18?",
      "choices": [
        {"id": "a", "text": "32"},
        {"id": "b", "text": "42"},
        {"id": "c", "text": "52"}
      ],
      "correctAnswerIds": ["b"],
      "shuffleChoices": true,
      "hint": "Add the ones first, then add the tens.",
      "explanation": "24 + 18 equals 42.",
      "points": 10
    }
  ]
}
```

Correct answers shall reference stable choice IDs and never depend on array position or a displayed letter.

**QB 05 Import quiz package**

The parent shall be able to import a JSON quiz package into the quiz bank.

- Validate the format version and all required fields.
- Validate subject, grade, type, choice IDs, correct answer IDs, and category information.
- Require at least two choices and at least one correct answer for choice questions.
- Detect duplicate external IDs and likely duplicate prompts.
- Import valid items even when other items in the package are invalid.
- Assign an import batch ID and mark AI-generated items as Needs Review.
- Only Approved items shall be available to random exercises by default.

**QB 06 Preview and complete import**

Before saving, the app shall show total, valid, invalid, duplicate, replacement, skipped, and proposed-category counts. The parent may select items, map categories, skip duplicates, replace matches, approve suitable items, cancel, or download an error report.

**QB 07 Export quiz package**

The parent shall be able to export selected quizzes in the same versioned JSON format for backup, editing, AI-assisted revision, or transfer to another installation.

**QB 08 Bulk review and editing**

The parent shall be able to select multiple imported quizzes and change grade, category, difficulty, tags, review status, points, or archive status. The parent may undo the most recent import batch if none of its items has been used by an attempt.

# Exercise builder and scheduling

**EX 01 Create exercise**

The parent shall create an exercise from quiz-bank items.

- Required settings are title, subject, grade, at least one quiz item, and time limit in whole minutes.

- The parent can reorder items using move controls or drag and drop.

- An exercise may contain both subjects only if the parent selects Mixed; otherwise all items must match its subject.

- The app shows estimated duration based on question count and configured time limit.

**EX 02 Exercise rules**

Each exercise shall support configurable play rules.

- Lives default to five and remain fixed at five in the current release.

- The parent configures a time limit from one to sixty minutes.

- The parent can enable question randomization, replay after completion, hints, and correction review.

- The parent sets the passing threshold as a percentage; the default is seventy percent.

**EX 03 Daily assignment**

The parent shall assign an exercise to one child, both children, or a grade profile for a date.

- Only one exercise is designated as the primary daily exercise for each child.

- The parent may schedule future dates.

- If no dated assignment exists, the app may select the next exercise from the child's enabled rotation.

- Changing an assignment does not delete earlier attempts.

**EX 04 Exercise library**

The parent shall be able to manage reusable exercises.

- The list shows title, subject, grade, question count, time limit, and active or archived state.

- The parent can duplicate, edit, preview, archive, and delete an unused exercise.

- Editing an exercise after a child begins does not change that active attempt.

**EX 05 Add random quiz group**

The exercise builder shall allow the parent to add a fixed quiz item or a random quiz group. A random group shall define question count, subject, grade, category IDs, optional tags, difficulty range, allowed question types, recent-use avoidance, and weak-area preference.

An exercise may combine fixed and random groups, such as two fixed review questions, five random addition questions, and three random multiplication questions.

**EX 06 Resolve random questions**

Random items shall be selected when the child starts an attempt.

- Select only active and Approved items matching all filters.
- Do not select the same quiz twice in one attempt.
- Store selected quiz IDs, order, random seed, content snapshots, and answer order in the attempt.
- Preserve the same selection when an interrupted attempt resumes.
- Select a new set for a new attempt unless Repeat Same Questions is selected.
- Do not duplicate questions when the bank contains fewer matches than requested.
- Warn the parent while saving an exercise if the current bank cannot satisfy a random group.

The available modes shall be Fully Random, Balanced, and Practice Weak Areas. Balanced shall be the default and shall distribute selections across matching topics and difficulties.

**CH 08 Randomize answer choices**

Choice-based questions shall display answers in a randomized order when `shuffleChoices` is enabled.

- Evaluate answers by stable choice ID.
- Save the displayed answer order in the attempt snapshot.
- Preserve the answer order when resuming an attempt.
- Generate a new order for a new attempt.
- Allow the parent to disable shuffling when position or sequence is part of the question.
- Provide Shuffle Again in parent preview.

# Scoring lives and rewards

| **Rule**      | **Current release behavior**                                                                                                  |
|---------------|--------------------------------------------------------------------------------------------------------------------------------|
| Base score    | Each correct answer earns its configured points; default ten points.                                                           |
| Accuracy      | Correct answers divided by submitted answers, shown as a percentage.                                                           |
| Lives         | Start with five; subtract one for each incorrect submitted answer; do not subtract for unanswered questions when time expires. |
| Pass          | All questions completed and accuracy meets the exercise threshold.                                                             |
| Stars         | One star for completion, two for passing, and three for at least ninety percent accuracy with one or more lives remaining.     |
| Streak        | Increase once per local calendar day when the primary daily exercise is completed; replay does not increase it.                |
| Personal best | Show when the child improves score, accuracy, or completion time for the same exercise.                                        |

# Parent progress dashboard

**PR 01 Progress overview**

The parent shall see a separate overview for each child.

- The overview shows exercises assigned, completed, passed, and unfinished for the selected period.

- It shows accuracy by subject and grade, current streak, total practice time, lives lost, and recent activity.

- The default period is the last seven days, with options for thirty days and all time.

**PR 02 Attempt details**

The parent shall be able to inspect an individual attempt.

- Details include every prompt, submitted answer, correct answer, outcome, response time, and hint use.

- The app distinguishes completion, time expiration, loss of lives, and abandonment.

- Historical details remain readable if the original quiz item is later changed.

**PR 03 Learning needs**

The dashboard shall identify simple areas for further practice.

- It lists quiz items answered incorrectly two or more times.

- It summarizes weak tags or skills only when at least three responses exist.

- The parent can create a new practice exercise from selected incorrect items.

# Features that make practice more exciting

| **Feature**       | **Behavior**                                                                                            | **Priority** |
|-------------------|---------------------------------------------------------------------------------------------------------|--------------|
| Avatar reactions  | The selected avatar celebrates correct answers and encourages the child after mistakes.                 | High         |
| Daily streak      | A visible streak grows when the primary daily exercise is completed.                                    | High         |
| Badges            | Award badges for first completion, five day streak, perfect score, persistence, and subject milestones. | High         |
| Treasure path     | Each completed exercise moves the child one step along a short visual map toward a reward.              | Medium       |
| Unlockable themes | Stars unlock optional colors, avatar accessories, or celebration effects without changing scores.       | Medium       |
| Surprise bonus    | A deterministic daily bonus awards a small badge or visual item after completion.                       | Low          |
| Read aloud        | Language prompts can play parent recorded audio or device speech when supported.                        | Medium       |

Rewards should recognize effort and improvement as well as perfect scores. Animations must be brief, optional, and must not block the next question. No advertising, purchases, public leaderboards, or manipulative countdowns are permitted.

# Screens and navigation

| **Screen**            | **Primary content and actions**                                                          |
|-----------------------|------------------------------------------------------------------------------------------|
| Profile selection     | Three profile cards, avatar, name, and credential entry.                                 |
| Child home            | Today's exercise, start or resume action, streak, stars, badges, and recent days.        |
| Exercise introduction | Title, subject, grade, question count, five lives, timer, rewards, and Start.            |
| Question              | One prompt, response control, progress, lives, timer, Submit, feedback, and Next.        |
| Exercise result       | Outcome, score, accuracy, time, lives, stars, badge, corrections, and Home.              |
| Parent dashboard      | Child selector, date filter, summary metrics, progress, weak areas, and recent attempts. |
| Quiz bank             | Search, filters, item list, Add, Edit, Duplicate, Preview, Archive, and Delete.          |
| Exercise builder      | Settings, selected questions, order, preview, save, and assignment.                      |
| Schedule              | Child, date, primary exercise, and upcoming assignments.                                 |
| Settings and backup   | Profile names, avatars, local credentials, audio, motion, export, import, and reset.     |

# Local data and offline behavior

- IndexedDB stores profiles, quiz items, exercises, schedules, attempts, progress summaries, rewards, and settings.

- The service worker caches the Angular application shell and all required static assets.

- All scoring, timer, scheduling, filtering, and reporting run on the device without network calls.

- The app saves an attempt after it starts and after every submitted answer.

- An export produces one versioned backup file containing local data and references to supported media.

- Import validates format and version before replacing data and requires parent confirmation.

- The app displays an offline ready indicator only after essential application files are cached.

- Each device owns an independent local database and may synchronize through the parent-configured Google Sheet.

## Offline first Google synchronization

IndexedDB shall remain the operational database. Every child and parent action shall save locally before synchronization is attempted. Google Sheets shall hold the shared synchronized copy of profiles, categories, quizzes, exercises, assignments, attempts, answers, progress, and rewards. Google Apps Script shall control application writes and exclusive synchronization. The system requires no parent-operated server, and local use remains available while Google is offline.

Child PINs, the parent password, Google authorization tokens, cached assets, and temporary interface state shall remain local and shall not be written to the spreadsheet.

**SYNC 01 Connect Google account**

The parent shall connect one Google account from Parent Settings, create or select a compatible spreadsheet, and enable or disable synchronization. Children shall not need Google accounts or see Google authorization controls.

**SYNC 02 Storage modes**

The parent shall be able to choose Local Only, Manual Sync, or Automatic Sync. Automatic Sync shall run when the app starts and may also run after a completed exercise. The app shall open from local data immediately and shall not block child login or exercise play while synchronization runs.

**SYNC 03 Parent manual synchronization**

The Sync screen shall provide Sync Normally, Review Conflicts, Retry, Replace Google With Local, Replace Local With Google, Pause Automatic Sync, and Disconnect Google.

- Normal sync shall apply version rules and shall not overwrite conflicts.
- Replace operations shall recommend a backup and require explicit confirmation.
- Disconnecting Google shall not delete local data.

## Spreadsheet structure

| **Sheet tab** | **Stored records** |
|---|---|
| `Metadata` | Schema versions, global data revision, and synchronization information |
| `Profiles` | Child and parent display settings without credentials |
| `Categories` | Dynamic category definitions |
| `QuizItems` | Quiz prompts, type, grade, category, difficulty, and feedback |
| `QuizChoices` | Stable answer choice IDs and quiz relationships |
| `Exercises` | Exercise rules and time limits |
| `ExerciseItems` | Fixed quiz references and random selection rules |
| `Assignments` | Daily assignments by child and date |
| `Attempts` | Attempt snapshots, status, score, lives, and timing |
| `AnswerResults` | Submitted answer IDs and outcomes |
| `Rewards` | Stars, badges, streaks, and unlocks |
| `ChangeLog` | Record-level version history |
| `DeletedRecords` | Synchronized deletion tombstones |
| `SyncTransactions` | Started, committed, failed, and conflict sync batches |

Custom images and audio shall be stored locally for offline use and may optionally be stored as files in a dedicated Google Drive folder. The spreadsheet shall contain Drive file IDs and checksums rather than binary media. An exercise shall not be marked Offline Ready until its required media is cached.

## Version model

Each local synchronized record shall contain `id`, `localVersion`, `lastGoogleVersion`, `syncStatus`, `updatedAt`, `updatedByDeviceId`, and optional `deletedAt`. Each Google record shall contain `id`, `version`, `updatedAt`, `updatedByDeviceId`, and optional `deletedAt`.

Let `L` be localVersion, `B` be lastGoogleVersion, and `G` be the current Google version read during synchronization.

| **Condition** | **Meaning** | **Automatic action** |
|---|---|---|
| `L = B` and `G = B` | Neither side changed | No action |
| `L > B` and `G = B` | Only local changed | Upload local record |
| `L = B` and `G > B` | Only Google changed | Download Google record |
| `L != B` and `G != B` | Both sides changed | Record conflict and pause automatic sync |
| `L < B` | Invalid local version | Stop and require repair |
| `G < B` | Google rollback or invalid data | Stop and require parent resolution |

Any local update shall increment `localVersion` and leave `lastGoogleVersion` unchanged. A successful upload or download shall make all three versions equal. The app shall detect conflicts only through versions and shall not compare record content.

The invariant `lastGoogleVersion <= googleVersion` shall hold during normal operation. A violation shall be treated as rollback or spreadsheet corruption rather than synchronized automatically.

## Exclusive synchronization

**SYNC 04 Single active synchronization**

Only one application instance shall be allowed to commit a Google synchronization at a time. Every request shall contain a unique `syncId`, device ID, start time, last global data revision, and complete change batch.

Google Apps Script shall:

1. Attempt to acquire an exclusive script lock.
2. Return `SYNC_BUSY` without changes if another sync owns the lock.
3. Read current Google versions only after acquiring the lock.
4. Reevaluate all submitted changes against those versions.
5. Reject the entire batch if any blocking conflict exists.
6. Apply the accepted batch and flush spreadsheet changes.
7. Mark the sync transaction Committed.
8. Increment the global data revision once.
9. Release the lock in a finally block.

Only the lock owner may return `SYNC_SUCCESS`. A `SYNC_BUSY` result shall leave local changes pending and may be retried after a randomized delay.

**SYNC 05 Idempotent retry**

Retrying the same batch shall reuse its `syncId`. If that ID already has a Committed transaction, Apps Script shall make no further changes and return the earlier committed result. This prevents duplicate updates when Google commits but the device loses the response.

**SYNC 06 All or nothing batch**

Related changes shall share a `changeGroupId`. A group, such as an exercise with its fixed items and random rules, shall be committed or rejected together. A synchronization is successful only when its `SyncTransactions` row is Committed.

## Conflict resolution

When automatic synchronization finds a conflict, it shall preserve the local data, stop further processing, set Manual Sync Required, and pause future automatic sync until the parent resolves every blocking conflict. Child activity shall continue saving locally.

The parent may Use Local Version, Use Google Version, Keep Both, or Decide Later. Resolving with either side shall create:

```text
resolvedVersion = max(localVersion, googleVersion) + 1
```

The chosen content and resolved version shall then be stored locally and in Google, and `lastGoogleVersion` shall equal the resolved version. Keep Both shall preserve the Google record and create the local content as a new record with a new UUID.

Completed attempts, answer results, and earned rewards shall be immutable or append-only where practical. Independent child attempts with different UUIDs shall be kept rather than treated as conflicts.

## Active attempt ownership

An active exercise attempt shall remain owned by the device where it started. Another device may show that the attempt exists but shall not resume it. After completion and synchronization, the result may be viewed on every synchronized device. The parent may abandon an old active attempt.

## Deletion and history

Synchronized deletions shall create versioned tombstones instead of immediately removing rows. Tombstones shall remain for at least 90 days. Attempt snapshots shall remain readable when their source category, quiz, or exercise is archived or deleted.

The `Metadata` tab shall store `appVersion`, `localSchemaVersion`, `googleSchemaVersion`, `quizImportFormatVersion`, and a global `dataRevision`. The application shall refuse automatic synchronization when the Google schema is newer than it supports.

Google synchronization shall not replace independent JSON export and import backup.

# Core data entities

| **Entity**   | **Minimum fields**                                                                                           |
|--------------|--------------------------------------------------------------------------------------------------------------|
| Profile      | id, role, displayName, avatar, credential, grade, preferences, createdAt                                     |
| Category     | id, name, normalizedName, subject, description, color, icon, status, version fields                          |
| QuizItem     | id, subject, grade, type, prompt, choices, answerRule, explanation, hint, tags, points, media, status        |
| Exercise     | id, title, subject, grade, quizItemIds, orderMode, timeLimitMinutes, passingPercent, settings, status        |
| Assignment   | id, profileId, exerciseId, assignedDate, isPrimary, replayAllowed                                            |
| Attempt      | id, profileId, exerciseSnapshot, startedAt, deadlineAt, completedAt, status, livesRemaining, score, accuracy |
| AnswerResult | attemptId, quizItemSnapshot, submittedAnswer, isCorrect, points, responseSeconds, hintUsed, submittedAt      |
| Reward       | id, profileId, type, key, earnedAt, sourceAttemptId                                                          |
| AppSettings  | schemaVersion, timerVisibility, audioEnabled, reducedMotion, feedbackDelay, backupMetadata                   |
| SyncTransaction | syncId, deviceId, status, startedAt, completedAt, recordCount, error, commitSequence                   |
| DeletedRecord | entityType, entityId, version, deletedAt, updatedByDeviceId                                                |

# Quality requirements

| **Area**          | **Requirement**                                                                                                                       |
|-------------------|---------------------------------------------------------------------------------------------------------------------------------------|
| Offline operation | After successful installation and caching, all child and parent functions except Google synchronization work with the server unavailable. |
| Responsiveness    | A screen transition or answer evaluation normally completes within 300 milliseconds on the target devices.                            |
| Recovery          | A submitted answer is not lost after an unexpected close. An active timer cannot be reset by closing and reopening the app.           |
| Usability         | Primary child actions use clear labels, large touch targets, and no horizontal scrolling at supported phone widths.                   |
| Accessibility     | Controls have accessible names, color is not the only feedback, keyboard operation works on Windows, and reduced motion is supported. |
| Client compatibility | The team defines and tests a specific Windows browser, Android browser, and iOS Safari version before release.                     |
| Privacy           | Child and parent learning data is sent only to the parent-configured Google spreadsheet when synchronization is enabled.              |
| Capacity          | The app supports at least 2,000 quiz items and 10,000 answer results on a target device without noticeable list slowdown.             |
| Sync isolation    | Only one device can commit a Google synchronization at a time; another concurrent request receives `SYNC_BUSY`.                       |
| Sync recovery     | Local activity remains usable after network, authorization, conflict, or partial-response failures.                                    |
| Compatibility     | A newer Google schema cannot be synchronized by an older incompatible application.                                                      |

# Business rules and edge cases

- A child cannot start a second scored attempt while another exercise attempt is active.

- A quiz item used by an active attempt is read from the stored snapshot, not the editable bank record.

- When time reaches zero during answer entry, the current unsubmitted answer is not scored.

- A wrong answer reduces lives only once, even if a button is tapped repeatedly.

- The app prevents double submission while evaluating or changing screens.

- The date for a daily streak uses the device's local date at the time of completion.

- Changing the device clock may affect schedules and streaks; preventing clock manipulation is outside scope.

- If required media is missing, the question shows a clear fallback and the parent sees a content warning.

- Resetting all data requires parent login, a warning, and a second confirmation. Backup is recommended first.

# Acceptance scenarios

| **Scenario**              | **Expected result**                                                                                                                                                                      |
|---------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Offline launch            | After installation and caching, turn off the server and network. The installed app opens and both child and parent flows remain usable.                                                  |
| Successful daily exercise | A child answers every question before the deadline with at least seventy percent accuracy. The attempt passes, progress updates, stars are awarded, and the daily streak increases once. |
| Five incorrect answers    | The fifth incorrect submitted answer reduces lives to zero. The attempt ends immediately with Try Again and saves all prior answers.                                                     |
| Time expiration           | The deadline is reached with unanswered questions. The attempt ends as Time Up and the timer cannot be reset by reopening the app.                                                       |
| Question per screen       | At every step only one prompt is visible. Next becomes available only after the current response is evaluated.                                                                           |
| Build from bank           | The parent filters Grade 3 mathematics items, selects questions, orders them, sets ten minutes, saves, and assigns the exercise to Child One for tomorrow.                               |
| Progress review           | After the child finishes, the parent sees the new attempt and can inspect each response and its correctness.                                                                             |
| Interrupted exercise      | The app is closed after question three. Reopening resumes at question four with the correct remaining lives and deadline.                                                                |
| Backup restore            | The parent exports data, resets a test installation, imports the backup, and sees the same quiz bank, exercises, profiles, and progress.                                                 |
| Dynamic category import   | An AI package references a new category. Import preview proposes it, the parent approves it, and quizzes reference the created category ID.                                             |
| Random exercise           | Starting an exercise selects the requested matching quizzes without duplicates and stores the selection, seed, and shuffled answer order in the attempt snapshot.                      |
| Local-only update sync    | A local record has advanced beyond its last Google version while Google remains unchanged. Normal sync uploads it and makes all versions equal.                                        |
| Google-only update sync   | Google has advanced while the local record remains at its last Google version. Normal sync downloads it and makes all versions equal.                                                   |
| Version conflict          | Local and Google both differ from the last Google version. Automatic sync writes neither copy, pauses, and requires parent resolution.                                                  |
| Concurrent synchronization | Two devices submit sync requests together. One acquires the lock and may commit; the other receives `SYNC_BUSY` and keeps its changes pending.                                       |
| Idempotent retry          | A committed sync loses its response. Retrying the same `syncId` returns the committed result without applying changes twice.                                                            |

# Implementation phases

| **Phase**          | **Deliverable**                                                                                                              |
|--------------------|------------------------------------------------------------------------------------------------------------------------------|
| One foundation     | Angular PWA shell, offline cache, local database, three static profiles, login, responsive navigation, and seed content.     |
| Two child play     | Daily home, exercise introduction, one question per screen, scoring, five lives, timer, resume, results, and local progress. |
| Three parent tools | Dynamic categories, quiz bank, AI package import, exercise builder, assignment schedule, dashboard, and attempt details.     |
| Four randomization | Random quiz groups, balanced selection, stable answer IDs, answer shuffling, attempt snapshots, and parent preview.         |
| Five motivation    | Stars, streaks, badges, avatar reactions, celebrations, reduced motion, and personal bests.                                  |
| Six Google backup  | Google authorization, spreadsheet creation, local-to-Google backup, and restore to an empty installation.                   |
| Seven synchronization | Version tracking, exclusive Apps Script lock, two-way sync, conflict review, idempotent retry, and tombstones.           |
| Eight reliability  | JSON backup, offline readiness, capacity, browser, concurrency, recovery, migration, and release testing.              |

# Release criteria

- All acceptance scenarios pass on the agreed Windows and mobile test devices.

- The application launches and completes an exercise after the installation server is shut down.

- No submitted answer is lost in interruption and recovery tests.

- The parent can create, assign, and review an exercise without developer assistance.

- Both children have independent progress, rewards, assignments, and credentials.

- The backup and restore test reproduces the expected local records.

- The interface has no blocking layout defects at the target Windows and mobile screen sizes.
- An AI quiz package can be validated, categorized, previewed, approved, and used in a random exercise.
- Local child activity remains usable during Google outages and synchronization conflicts.
- Concurrency testing proves that only one simultaneous synchronization can commit.
- A version conflict pauses automatic synchronization without overwriting either copy.
- Retrying a committed `syncId` does not duplicate records or versions.

# Product decisions and remaining confirmations

| **Decision**           | **Recommended starting choice**                                                         |
|------------------------|-----------------------------------------------------------------------------------------|
| Child ages and grades  | Configure Child One and Child Two independently within Grade 1 through Grade 5.         |
| Credential format      | Four digit PIN for children and a text password for the parent.                         |
| Minimum question types | Single choice, short text, and number.                                                  |
| Default timer          | Ten minutes per exercise, editable from one to sixty minutes.                           |
| Passing score          | Seventy percent, configurable per exercise.                                             |
| Wrong answer behavior  | Remove one life, show an explanation, then continue to the next question.               |
| Replay behavior        | Allow unscored practice replay after the primary daily attempt.                         |
| Mobile targets         | Confirm Android only or Android plus iPhone before packaging and final browser testing. |
| Content language       | Confirm the interface language and the languages taught by the language subject.        |
| Category model         | One dynamic primary category per quiz, with multiple optional tags.                      |
| Local storage          | IndexedDB is the operational database and always receives writes first.                  |
| Google storage         | One parent-configured Google Sheet is the synchronized shared copy.                      |
| Sync writer            | Google Apps Script owns spreadsheet writes and enforces one active sync.                 |
| Conflict detection     | Compare record versions only; do not compare record content.                             |
| Conflict behavior      | Pause automatic sync and require parent resolution.                                      |
| Conflict version       | Resolve to `max(localVersion, googleVersion) + 1`.                                       |
| Child progress         | Completed attempts and answers are immutable or append-only.                             |
| Active attempt         | Remains on the originating device until completed or abandoned.                          |
| Credentials            | Child PINs, parent password, and Google tokens remain local.                              |
| Media storage          | Cache locally; optionally store custom files in Drive and references in Sheets.           |
