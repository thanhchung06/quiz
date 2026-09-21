# Feature Specification: Child Learning Exercise Application

**Feature Branch**: `001-child-learning-exercise-app`

**Created**: 2026-09-13

**Status**: Draft

**Input**: User description: "Offline-first Angular PWA for two children and one parent to practice daily mathematics and language exercises, with a parent-managed quiz bank, exercise builder and scheduler, gamified rewards, a progress dashboard, JSON backup/restore, and optional two-way synchronization of local IndexedDB data to a parent-owned Google Sheet via Google Apps Script."

## Clarifications

### Session 2026-09-13

- Q: What should the child's home screen do on a day when the parent hasn't explicitly assigned a daily exercise? → A: Automatically fall back to the next exercise in a parent-enabled rotation for that child, so there's always something to play.
- Q: Should using a hint during a question cost the child anything (a life or points), or is it always free? → A: Hints are not part of this release — no hint feature is offered to children.
- Q: Can a parent assign an exercise whose configured grade differs from a child's own profile grade? → A: Allowed freely — grade is a label/filter, not an enforced restriction; the parent may assign any exercise to any child regardless of grade.
- Q: What accessibility and usability baseline must the app meet at launch? → A: No specific accessibility requirements for v1 — only basic touch-friendly UI is expected; no assistive-technology support or formal accessibility standard is required this release.

### Session 2026-09-18

- Q: Should a child still enter a PIN to log in? → A: No — a child logs in by avatar selection alone; only the parent profile remains password-protected (supersedes FR-002/FR-003 as originally written).
- Q: Should an exercise remain replayable (scored same-day-blocked, or unscored practice) as originally specified? → A: No — every exercise is strictly one-attempt-per-child from now on, with no replay of any kind; a finished exercise instead offers to reopen its own past result (supersedes FR-015).
- Q: Should the number of lives stay fixed at five? → A: No — the parent configures a per-exercise life count from three to ten, or unlimited (supersedes FR-032).
- Q: Should submitting an answer show an in-the-moment correct/incorrect panel during play, as originally specified? → A: No — play now advances immediately to the next question with no intermediate panel; the only in-play sign of a wrong answer is a lost heart in the header. A full per-question breakdown (selected vs. correct answer for every question) is shown once at the end, on the result screen, instead (supersedes FR-012's feedback-panel language; adds FR-079).
- Q: Can a parent record that a child traded earned points for a real-world item? → A: Yes — a new point-redemption feature lets the parent deduct a chosen number of points from a child's balance, with an optional note, kept as permanent history; the balance shown to the child is always computed (earned − redeemed), never a directly-edited number (adds FR-085–087).
- Q: Should an imported quiz package still let the parent choose a grade/type for the import, list every individual question in the preview, generate an AI prompt in-app, and require a separate approval step before items are usable? → A: No to all four — grade/type always come from each question's own file content (no picker); the preview shows a grade/type count breakdown instead of a full item list; the in-app AI-prompt generator was removed entirely; and import commits items as immediately usable with no approval step at all (supersedes FR-025/FR-027/FR-028/FR-030 as originally written; the bulk-review "Duyệt câu hỏi" screen was removed from navigation, with its still-needed undo-last-import action moved onto the import screen itself).
- Q: Should the import preview's passage/multi-question list always be shown open, and should the parent see any progress indication or confirmation after importing? → A: The passage list now starts collapsed (still all included by default) and only expands on request; the screen shows a loading state while reading the selected file and again while committing the import; and a successful import shows its result in a popup, whose Close action resets the whole screen — including the file picker itself — so the next import starts from a clean slate (further amends FR-027).
- Q: How many difficulty levels should a quiz item have, what happens on import when a category isn't specified, and how should the quiz bank be organized/edited? → A: Difficulty becomes a named 5-level scale — Dễ (easy), Trung bình (intermediate), Khó (hard), Rất khó (very hard), Chuyên gia (expert) — defaulting to Trung bình wherever unset (supersedes the earlier unnamed 1–3 scale in FR-017/FR-035/FR-082). Every quiz item still belongs to exactly one category, always: an imported item/question with no `category` in its file now resolves to a per-subject default category ("Khác") through the same lookup-or-propose-new path as any named category, instead of being silently skipped (amends FR-022, FR-026/FR-027). The Quiz Bank management screen is redesigned from a flat table into a collapsible Subject → Grade → Category → Quiz tree on the left with an edit detail panel on the right; selecting a quiz loads it into the panel, which has its own Save button, and changing a quiz's category and saving moves it to its new spot in the tree immediately (adds FR-088; amends FR-019).
- Q: Should the parent be able to change the grade of, or delete, every quiz in a category all at once, rather than one at a time? → A: Yes — each Subject → Grade → Category node in the Quiz Bank tree gets its own small bulk-action controls, scoped to exactly the items shown under that node (i.e. that category within that one grade, since the tree already splits a category by grade): one to move every quiz item in that node to a different grade in one action, and one to delete every quiz item in that node in one action (behind an inline confirmation, since it can affect many items at once) (adds FR-089).
- Q: Should the exercise builder's question browser support adding many questions at once by category, rather than one item at a time? → A: Yes — whenever no single item is selected in the browser, its detail panel shows a bulk random-add form instead: pick a difficulty level, how many questions to draw, and an optional per-question time (Custom timing mode only) and points override, then add — that many distinct quiz items matching the current category/search filter and chosen difficulty, and not already in the exercise, are drawn at random and added together in one action. Passages are excluded from this random pool (same as a random *group*'s own candidate resolution) so one can never be split apart by a bulk draw; if fewer matching items remain than requested, as many as are available are added and the parent is told exactly how many (adds FR-090; amends FR-082/FR-084).
- Q: Should there be a kind of exercise that renews daily with freshly randomized questions, rather than the existing strictly-one-attempt-ever kind? → A: Yes — a new "daily exercise" toggle (`Exercise.isDaily`). Its content can only ever be added as category/difficulty/count/time/points *slots*, never a specific quiz — in the question browser, individual-item selection is disabled entirely and the bulk-add form instead adds a `randomGroup` "slot" (no concrete quiz chosen yet) rather than resolving items now; the parent can add multiple such slots to one daily exercise. A daily exercise is exempt from the normal one-attempt-per-child-forever rule (FR-015/FR-081): a child may start a fresh, freshly-randomized attempt once per local calendar day — a completed attempt from a prior day never blocks today's, but today's does, same as before, until tomorrow. A random group may now also carry a per-question points override (`RandomGroupConfig.pointsOverride`), matching a fixed item's own override, so the "5 default hard quiz, 3 points/quiz, 30s" style slot the parent configures is fully expressed without a per-item points step (adds FR-091; amends FR-015, FR-032, FR-081, FR-035).
- Q: In the exercise builder's difficulty picker, should there be an "any difficulty" option; what should happen to a legacy quiz item with no difficulty stored at all; and when a per-question time/points override is set while adding a multi-question passage, should it apply to the one question clicked or to every question in that passage? → A: Three separate fixes. (1) The bulk-add/daily-slot difficulty `<select>` gains a leading "Tất cả độ khó" (All) option — selecting it matches items of any difficulty instead of narrowing to one level (this option exists only in that picker; a single quiz item's own difficulty field still always has one concrete level). (2) A quiz item with no `difficulty` stored (data predating the field) is treated as 2/Trung bình everywhere it's read for filtering, matching, or display — not just at import time as before — including the bulk-add pool, a random group's candidate resolution and its builder-time satisfiability check, and `difficultyLabel()` itself. (3) Adding one question of a multi-question passage pulls in every sibling question as a block (existing behavior); the per-question time/points override configured alongside that add was only being applied to the specific question clicked, leaving its siblings with no override at all — this was a bug, now fixed so the same override applies to every question in the passage (supersedes FR-090's implicit single-item framing; amends FR-017/FR-026/FR-035/FR-083/FR-090).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Child completes a daily practice exercise (Priority: P1)

A child selects their avatar and completes today's assigned exercise one question at a time, advancing immediately after each answer, keeping track of lives and time, and reaching a clear result at the end — including a full per-question breakdown of what they answered versus the correct answer — with no loss of progress even if the app is closed mid-attempt.

**Why this priority**: This is the core value of the product — a child practicing daily. Nothing else matters if this loop does not work reliably offline.

**Independent Test**: With a small number of seed quiz items and one seed exercise already assigned, a child can log in, start the exercise, answer every question, and see a completion result with score, accuracy, and lives remaining — fully offline, with no parent tooling involved.

**Acceptance Scenarios**:

1. **Given** a child is on the profile selection screen, **When** they select their avatar, **Then** they are logged straight in and only that child's home screen and data are shown — no PIN or other credential is requested.
2. **Given** a child is on their home screen with a daily exercise assigned, **When** they start the exercise, **Then** the app shows the rules (subject, question count, configured lives — a number or unlimited, time limit, possible reward) and begins the timer only after they press Start.
3. **Given** a child is answering a question, **When** they submit any answer, **Then** the app advances immediately to the next question (or the result screen if it was the last one) with no intermediate correct/incorrect panel; a correct answer silently earns the question's configured points, an incorrect answer removes exactly one life (visible only as one fewer heart in the header, unless the exercise's lives are unlimited), and the correct answer is never revealed before submission.
4. **Given** a child has answered all questions before time or lives run out, **When** the last answer is submitted, **Then** the attempt ends as Completed and a result screen shows score, accuracy, time, remaining lives (or an unlimited marker), any rewards earned, and a full per-question breakdown of every question's prompt, the child's selected answer, and the correct answer.
5. **Given** an exercise configured with a fixed life count, **When** that many incorrect answers are submitted, **Then** the attempt ends immediately as Try Again and all prior answers are preserved; **Given** an exercise configured with unlimited lives, **When** any number of incorrect answers are submitted, **Then** the attempt never ends for running out of lives and continues until every question is answered or the overall time limit is reached.
6. **Given** the exercise time limit is reached with questions unanswered, **When** the deadline passes, **Then** the attempt ends as Time Up and prior answers are preserved.
7. **Given** a child closes the app after answering question three of a longer exercise, **When** they reopen and log in again, **Then** they resume at question four with the original remaining lives and the original deadline (not a reset timer).
8. **Given** a child already has a finished attempt (Completed, Time Up, or Try Again) for a given exercise, **When** they return to their home screen, **Then** the app offers to view that attempt's past result instead of a Start button, and no new attempt can be started for that exercise.

---

### User Story 2 - Parent builds and assigns an exercise from the quiz bank (Priority: P2)

A parent adds questions to a reusable quiz bank organized by subject, grade, and parent-defined categories, then assembles an exercise from bank items (fixed and/or randomly selected), configures its rules, and assigns it to a child for a specific date — all without any code or developer help.

**Why this priority**: Without parent-authored content and scheduling, there is nothing for a child to practice. This is the second most critical loop after the child experience itself.

**Independent Test**: A parent can, starting from an empty or seeded bank, create a category, add several quiz items to it, build an exercise from those items, set a time limit, and assign it to a child for a future date — independently of whether any child has yet played.

**Acceptance Scenarios**:

1. **Given** the parent is in the quiz bank, **When** they add a new quiz item with a title, subject, grade, question type, prompt, and correct answer, **Then** the item is saved and appears in bank listings and filters.
2. **Given** the parent is authoring a quiz item, **When** they type a new category name that closely matches an existing one (ignoring case and spacing), **Then** the app warns them and offers the existing category instead of silently creating a duplicate.
3. **Given** the parent filters the bank to Grade 3 mathematics items, **When** they select several items, order them, set a ten-minute time limit, and save, **Then** a new exercise is created containing exactly those items in that order.
4. **Given** a saved exercise, **When** the parent assigns it to Child One for tomorrow's date, **Then** it becomes Child One's primary daily exercise for that date and does not affect any already-recorded attempt.
5. **Given** a quiz item is later edited or deleted, **When** the parent reviews a past attempt that used it, **Then** the attempt still shows the original question exactly as the child saw it.
6. **Given** the parent authors a shared reading passage (or a problem statement) with several linked sub-questions, **When** they add any one of those sub-questions to an exercise, **Then** every sub-question of that passage is added together, in order, and none can be added or removed individually from the exercise.
7. **Given** the parent has set an exercise's subject and grade, **When** they open the question browser to add items, **Then** it shows only quiz-bank items matching that grade (and that subject, unless the exercise is Mixed), organized by category, with a detail view of any selected item and a live list of everything already added — and an item already added cannot be selected again.
8. **Given** the parent is viewing an item's detail in the question browser, **When** they set a custom points value (and, in Custom timing mode, a custom per-question time) before adding it, **Then** that override applies only within this exercise and never changes the quiz item's own stored default.
9. **Given** the parent is creating or editing an exercise, **When** they choose a life count, **Then** they may pick any whole number from three to ten or select unlimited, and the exercise stores that choice for every future attempt of it.

---

### User Story 3 - Parent reviews a child's progress and learning needs (Priority: P3)

A parent opens a per-child dashboard to see recent activity, accuracy, completion, and streaks, drills into any individual attempt to see exactly what was answered, and identifies topics the child is struggling with.

**Why this priority**: Once content and play are working, visibility into progress is what makes the app useful to the parent on an ongoing basis, and it depends on data produced by User Story 1.

**Independent Test**: After at least one recorded child attempt exists, a parent can open that child's dashboard, see the attempt reflected in the summary, and open its full detail (every prompt, submitted answer, correctness, and outcome).

**Acceptance Scenarios**:

1. **Given** a child has completed exercises this week, **When** the parent opens that child's dashboard, **Then** they see assigned/completed/passed/unfinished counts, accuracy by subject and grade, current streak, and recent activity for the default seven-day period.
2. **Given** a completed attempt, **When** the parent opens its details, **Then** every question, the submitted answer, the correct answer, the outcome, and response time are shown, and the end condition (completed, time expired, lives lost, or abandoned) is clearly distinguished.
3. **Given** a quiz item has been answered incorrectly by a child at least twice, **When** the parent views learning needs, **Then** that item appears as an area needing practice, and the parent can build a new exercise directly from a selection of such items.

---

### User Story 4 - Parent imports an AI-generated quiz package (Priority: P4)

A parent downloads the quiz package template, provides it (and its format) to an AI tool of their own choosing, and imports the resulting JSON package straight into the quiz bank — with categories resolved and a grade/type breakdown of what's about to be added, but no separate approval step before the items become usable.

**Why this priority**: This significantly speeds up content creation once the manual quiz bank (User Story 2) already works, but the app is fully usable without it.

**Independent Test**: Given a sample JSON package with a mix of valid items, one duplicate, and one reference to a brand-new category, a parent can run the import, see accurate counts and a per-grade/type breakdown in the preview, and end up with the valid items immediately available in the bank and usable in exercises — no separate approval action required.

**Acceptance Scenarios**:

1. **Given** a JSON package with valid and invalid items, **When** the parent imports it, **Then** valid items are imported and invalid items are reported, without blocking the valid items from being saved.
2. **Given** a package item references a category that does not yet exist locally, **When** the parent reviews the import preview, **Then** the proposed new category is shown for approval, renaming, or mapping before any quiz items are saved.
3. **Given** a package has just been imported, **When** the import finishes, **Then** every imported item is immediately usable in exercises and random-group selection, with no pending-review status to clear first (supersedes the original "Needs Review" step — see FR-028's 2026-09-18 amendment).
4. **Given** a package contains a reading passage or problem statement with several linked sub-questions, **When** the parent imports it, **Then** the preview shows that passage as one unit with its title and sub-question count, and it imports only as a complete whole — never with some of its sub-questions missing.
5. **Given** the parent selects a package file, **When** the preview appears, **Then** it shows a summary count of questions per grade and per question type (not a listing of every individual question), alongside the total/valid/invalid/duplicate/new-category counts, using whichever grade and type each question's own file content specifies — the parent does not choose a grade or type for the import as a whole; any passage list in the preview starts collapsed, with every passage still included by default, and expands only when the parent asks to see it.
6. **Given** a parent has just selected a file or clicked to commit an import, **When** the file is being read or the import is being saved, **Then** the screen shows a clear loading indication; **When** the import finishes, **Then** the result (how many questions were imported) appears in a popup, and closing that popup returns the parent to a completely empty import screen — file selection cleared — ready to import another package immediately.

---

### User Story 5 - Motivation, rewards, and streaks (Priority: P5)

A child sees streaks, stars, badges, and small celebrations that make daily practice feel rewarding, based on genuine performance and effort rather than manipulative mechanics.

**Why this priority**: Motivation features increase engagement but are not required for the core practice loop to deliver value.

**Independent Test**: After a child completes their primary daily exercise with a passing score, the streak increases exactly once, stars are awarded per the scoring rules, and any newly earned badge is visible on the next home screen visit — independent of dashboard or import functionality.

**Acceptance Scenarios**:

1. **Given** a child completes their primary daily exercise for the first time today, **When** the result is recorded, **Then** the streak increases by exactly one; since an exercise can never be attempted a second time (FR-015), no later action can increase it again for that same exercise.
2. **Given** a child passes an exercise with at least ninety percent accuracy and at least one life remaining, **When** the result is recorded, **Then** three stars are awarded.
3. **Given** reward animations are shown, **When** they play, **Then** they are brief, optional, and never block the child from proceeding to the next question or screen.

---

### User Story 6 - Backup, restore, and offline reliability (Priority: P6)

A parent exports all local data to a single backup file and can later restore it onto a fresh installation, and the installed app continues to work fully (aside from optional sync) with no network connection at all.

**Why this priority**: This protects against data loss and validates the offline-first premise of the product, but it is a safety net rather than a daily-use feature.

**Independent Test**: With an existing populated installation, a parent can export a backup, wipe a separate test installation, import the backup, and confirm the same quiz bank, exercises, profiles, and progress appear — with the server and network turned off throughout the child and parent flows.

**Acceptance Scenarios**:

1. **Given** the app and its assets are installed and cached, **When** the server and network are turned off, **Then** both child and parent flows remain fully usable.
2. **Given** a parent exports a backup and later imports it into a reset installation, **When** the import completes, **Then** the restored quiz bank, exercises, profiles, and progress match the original.
3. **Given** a parent chooses to reset all local data, **When** they confirm the action, **Then** the app requires parent login, shows a warning, and requires a second explicit confirmation before proceeding.

---

### User Story 7 - Optional synchronization across devices via Google Sheets (Priority: P7)

A parent connects one Google account and spreadsheet so that the same profiles, quiz bank, exercises, and progress can be used from more than one installed device, with conflicts and concurrent updates handled safely and without ever losing local data.

**Why this priority**: Multi-device use is valuable but strictly optional — the product is fully functional as a single-device, local-only application without it.

**Independent Test**: With two installations connected to the same spreadsheet, a change made and synced from one device becomes visible on the other after its next sync, a simultaneous sync attempt from both devices results in exactly one commit and one safely-deferred attempt, and disconnecting Google on either device leaves its local data intact.

**Acceptance Scenarios**:

1. **Given** a record has changed locally but not on Google, **When** normal sync runs, **Then** the local change is uploaded and all version markers become equal.
2. **Given** a record has changed on Google but not locally, **When** normal sync runs, **Then** the Google change is downloaded and all version markers become equal.
3. **Given** the same record has changed both locally and on Google since the last sync, **When** automatic sync runs, **Then** neither copy is overwritten, automatic sync pauses, and the parent must resolve the conflict manually.
4. **Given** two devices attempt to synchronize at the same moment, **When** both requests reach the sync endpoint, **Then** exactly one commits and the other receives a busy result with its local changes left pending for retry.
5. **Given** a synchronization was already committed but its confirmation response was lost, **When** the same request is retried, **Then** the prior committed result is returned and no data is duplicated or double-applied.

---

### User Story 8 - Parent redeems a child's points for a real-world item (Priority: P8)

A parent records that a child traded some of their earned points for a real-world item or privilege — selecting the child, seeing their current point balance, entering how many points to deduct with an optional note of what was traded, and submitting — with every redemption kept as permanent history.

**Why this priority**: This turns earned points into a tangible reward loop outside the app, but it is an add-on to the core practice/scoring loop rather than something either the child's daily practice or the parent's other tooling depends on.

**Independent Test**: With a child who already has some earned points from completed attempts, a parent can open the redemption screen, see that child's current balance, redeem an amount at or below that balance (confirming the balance and the child's own home-screen total both drop by exactly that amount and the redemption appears in history), and confirm attempting to redeem more than the current balance is refused with a clear message and changes nothing.

**Acceptance Scenarios**:

1. **Given** a child has earned points from completed attempts and redeemed none yet, **When** the parent opens the redemption screen, **Then** the child's current balance shown equals their total earned points.
2. **Given** a parent enters a point amount at or below the child's current balance plus an optional note, **When** they submit, **Then** a new redemption record is saved, the child's balance drops by exactly that amount, and the record appears at the top of that child's redemption history with its amount, note, and date.
3. **Given** a parent enters a point amount greater than the child's current balance, **When** they submit, **Then** the app refuses the redemption, states the child's current balance, and no redemption record is created.
4. **Given** a redemption has already reduced a child's balance, **When** that child opens their own home screen, **Then** their displayed point total reflects the same reduced balance the parent sees.

---

### Edge Cases

- A child cannot start a second scored attempt while another exercise attempt for that child is already active.
- An active or historical attempt always reflects the quiz content as it was captured at attempt start (a snapshot), even if the bank item is later edited, archived, or deleted.
- If time runs out while a response is being entered but not yet submitted, that response is not scored.
- Repeatedly tapping or submitting the same wrong answer removes only one life, not one per tap.
- The app prevents double submission of an answer while evaluation or a screen transition is in progress.
- Daily streak calculation uses the device's local calendar date at the moment of completion; manipulating the device clock may affect scheduling or streaks, and guarding against deliberate clock manipulation is out of scope.
- If a question's required media (image or audio) is missing or fails to load, the child sees a clear fallback and the parent sees a content warning.
- Deleting a quiz item that is referenced by a category, exercise, or past attempt never breaks the exercise builder or historical attempt review.
- An exercise combining fixed and random quiz groups must still resolve without duplicate questions even when the bank has just enough matching items to satisfy the random group.
- If the bank cannot supply enough matching items for a configured random group, the parent is warned when saving the exercise rather than discovering it during play.

## Requirements *(mandatory)*

### Functional Requirements

#### Profiles and access

- **FR-001**: The login screen MUST present exactly three profiles — Child One, Child Two, and Parent — each identified by name/avatar.
- **FR-002**: A child MUST authenticate by avatar selection alone, with no PIN or other credential step; the parent MUST authenticate with a fixed password. *(Amended 2026-09-18 — originally required a child PIN alongside avatar selection; removed entirely, since only the parent profile holds anything worth protecting locally.)*
- **FR-003**: An incorrect parent password MUST show a friendly retry message and allow another attempt without revealing which part was wrong; this does not apply to child login, which has no credential to get wrong.
- **FR-004**: A successful login MUST open only the selected profile's own data; no profile can view another child's data through the login flow.
- **FR-005**: Logging out MUST return to profile selection.
- **FR-006**: The parent MUST be able to update display names, avatars, and local credentials for any profile from Settings.

#### Child daily exercise flow

- **FR-007**: The child home screen MUST surface the current day's primary exercise — the dated assignment if one exists, otherwise the rotation fallback selected per FR-069 — including subject, title, question count, estimated time, grade, and completion state.
- **FR-008**: The child home screen MUST show current streak, total stars, recent badges, and the last seven days of activity.
- **FR-009**: Starting an exercise MUST show its rules (lives, time limit, possible reward) before play begins, and the attempt timer MUST start only once the child presses Start.
- **FR-010**: The app MUST display exactly one quiz item per screen, showing question position, remaining lives, and remaining time.
- **FR-011**: The answer control MUST remain disabled until a valid response is provided, and an already-submitted answer MUST NOT be changeable during that scored attempt.
- **FR-012**: Each submitted answer MUST be evaluated immediately and the app MUST advance straight to the next question (or the result screen, if it was the last one) with no intermediate correct/incorrect panel shown; a correct answer silently awards its configured points, an incorrect answer removes exactly one life (visible only via the header's life count, FR-032), and the correct answer MUST NOT be revealed before submission. *(Amended 2026-09-18 — originally specified an in-the-moment feedback panel per question; replaced by the end-of-attempt breakdown, FR-079.)*
- **FR-013**: An attempt MUST end, with final status/score/duration/results saved, on the first of: all questions answered (Completed), time expiring (Time Up, prior answers preserved), or lives reaching zero (Try Again, prior answers preserved, and never reachable at all when the exercise's lives are unlimited per FR-032).
- **FR-014**: The app MUST persist attempt progress after every submitted answer so that an interrupted attempt resumes at the next unanswered question with its original remaining lives and original deadline intact.
- **FR-015**: An exercise MUST NOT be replayable once a child has any finished attempt for it (Completed, Time Up, or Try Again) — not later the same day, not ever, and not even as an unscored practice replay; a child returning to an exercise they've already finished MUST instead be offered that attempt's own past result (FR-081). *(Amended 2026-09-18 — originally allowed a same-day-only scored block plus an optional unscored practice replay; both are removed, exercises are now strictly one-attempt-per-child. Amended again the same day: a daily exercise, FR-091, is the one exception — it is one-attempt-per-child-per-local-calendar-day instead of forever.)*
- **FR-016**: The parent MUST be able to reset a child's unfinished attempt.
- **FR-079**: The result screen MUST show a full per-question breakdown, in play order: each question's prompt, the child's selected answer, the correct answer, and whether it was correct; a question left unanswered (e.g. a per-question timeout, FR-077) MUST be shown as unanswered with the correct answer still revealed.
- **FR-080**: A child's home screen MUST show their current spendable point total, computed as the sum of every one of their attempts' earned score (see FR-085–087 for how redemptions reduce this).
- **FR-081**: Once a child has any finished attempt for a given exercise, the app MUST refuse to start a new attempt for that exercise for that child (enforced independently of the UI, as a hard backstop); the child's home screen and the exercise-introduction screen MUST instead offer to view that finished attempt's own result again. *(Amended 2026-09-18 — for a daily exercise, FR-091, this check is scoped to "a finished attempt started today" rather than "any finished attempt ever"; a prior day's finished attempt never blocks a fresh one today.)*

#### Quiz bank and categories

- **FR-017**: The parent MUST be able to create a quiz item with required fields (title/identifier, subject, grade, question type, prompt, correct answer, category) and optional fields (explanation, image, audio, tags, points), plus a difficulty level, with the answer configuration validated before saving. Hints are not part of this release. *(Amended 2026-09-18 — difficulty is now a named 5-level scale (1=Dễ, 2=Trung bình, 3=Khó, 4=Rất khó, 5=Chuyên gia, was an unnamed 1–3 number) that defaults to 2/Trung bình wherever unset; every quiz item belongs to exactly one category, always. Amended again the same day: "wherever unset" now genuinely covers every read of this field, not only creation/import defaults — a legacy item with no difficulty stored at all is treated as 2/Trung bình when editing it, when matching it against a random group's difficulty range or a bulk-add pool's chosen difficulty, and when displaying its difficulty label anywhere.)*
- **FR-018**: The quiz bank MUST support single choice, short text, and number question types at minimum, and SHOULD support multiple choice, true/false, and match-pairs as the content set matures.
- **FR-019**: The parent MUST be able to view, edit, duplicate, preview, archive, and delete quiz items, and to filter/search the bank by subject, grade, type, difficulty, tag, prompt text, and identifier. *(Amended 2026-09-18 — the quiz bank screen presents items as a collapsible Subject → Grade → Category → Quiz tree rather than a flat table, was a flat searchable table; see FR-088.)*
- **FR-020**: Deleting or editing a quiz item — including changing its grade or category — MUST NOT alter any historical attempt record that already used it, nor any exercise that already references it: an exercise's fixed items resolve by id at attempt-start regardless of the item's current edit/delete state, and every played attempt's questions/answers are read from that attempt's own frozen content snapshot, never a live lookup, so a later edit or delete of the underlying quiz item is invisible to anything already played. *(Amended 2026-09-18 — explicitly calls out grade/category changes and deletion after an exercise/attempt already exists, per direct confirmation this must hold; the underlying behavior — snapshotting — was already in place, this only makes the guarantee explicit.)*
- **FR-021**: The parent MUST be able to preview any quiz item exactly as a child would experience it, including feedback, without that preview affecting real child progress.
- **FR-022**: Categories MUST be parent-managed records with names unique within a subject; the parent MUST be able to create, rename, describe, archive, restore, and merge categories, with renames preserving existing quiz references and merges updating all affected references together. Every quiz item belongs to exactly one category, always — there is no uncategorized state. *(Amended 2026-09-18.)*
- **FR-088**: The Quiz Bank management screen MUST present quiz items as a collapsible tree grouped by Subject, then Grade, then Category, with an edit/detail panel that loads the selected item and commits changes only when the parent presses its own Save button; changing a selected item's grade and saving MUST move it to its new grade branch of the tree, and changing its category and saving MUST likewise move it to its new category branch — both immediately, without a full page reload. The detail panel's toolbar MUST also offer deleting the selected item, per FR-019/FR-020. *(Added 2026-09-18; amended same day to explicitly cover grade changes and delete alongside category changes.)*
- **FR-089**: Each Category node in the Quiz Bank tree MUST offer two bulk actions scoped to exactly the quiz items grouped under that node (that category within that one grade): changing every one of those items' grade to a chosen value in a single action, and deleting every one of those items in a single action (behind an inline confirmation before it executes, given the larger blast radius than a single-item delete). Both actions follow the same rules as their single-item equivalents — grade/delete changes never alter any exercise or historical attempt that already used an affected item (FR-020), and any passage whose sub-questions are entirely contained in the affected set is moved/deleted as the same atomic whole it already was (FR-074), since a passage's sub-questions always share one category and grade. *(Added 2026-09-18.)*
- **FR-023**: A category still referenced by active quiz items MUST NOT be permanently deletable until those items are reassigned or archived; archived categories remain visible in existing exercises and attempt history but are hidden from new exercise filters by default.
- **FR-024**: While authoring a quiz item, the parent MUST be able to select an existing category or create a new one without leaving the form; the app MUST detect exact and normalized-name duplicates and warn on close matches rather than silently creating a duplicate.

#### Passage-based / multi-question items

- **FR-073**: The parent MUST be able to author a shared reading passage or problem statement together with two or more linked sub-questions (each an ordinary supported question type), authored and edited as one unit rather than as separate, unrelated quiz items.
- **FR-074**: A passage's sub-questions MUST always move together — added to an exercise together (never with only some sub-questions present), and never split across a random-selection group — and editing the shared passage text MUST update it identically for every one of its sub-questions.
- **FR-075**: When a child reaches a sub-question that belongs to a passage, the shared passage text MUST be shown alongside that sub-question together with the sub-question's own position within the passage (e.g. "question 2 of 3 for this passage"), in addition to the sub-question's overall position in the exercise.

#### AI quiz package import and export

- **FR-025**: The app MUST provide a downloadable package template and instructions describing supported question types, required fields, subjects, grades, answer rules, category references, and validation rules, with examples. *(Amended 2026-09-18 — the in-app AI-prompt generator described in an earlier revision of this requirement was removed; the import screen now offers only the template download and the file import itself, with no prompt-building step.)*
- **FR-026**: The app MUST validate an imported JSON package's format version, required fields, subject/grade/type validity, choice and correct-answer ID integrity, and category resolution (matching by external key first, then normalized name plus subject, else proposing a new category). *(Amended 2026-09-18 — an item or passage with no `category` in the file at all now resolves to a per-subject default category ("Khác") through this same matching-or-proposing path, rather than being left without a category and dropped at commit; was previously only resolved when the file specified one.)*
- **FR-027**: Before saving an import, the app MUST show total/valid/invalid/duplicate/proposed-category counts, plus a breakdown of question count per grade and per question type computed from each question's own grade/type in the file (the parent never selects a grade or type for the import as a whole); the parent MUST be able to skip or replace duplicates, skip an individual invalid passage, cancel, or download an error report, then commit the import directly. Any passage/multi-question group list MUST start collapsed (all groups still included by default), expandable on request rather than always shown open. The app MUST show a loading state while the selected file is being read/validated and while the import is being committed, and MUST show the final result (how many questions were imported) in a popup dialog whose Close action resets the whole screen — including the file input itself — back to its empty starting state. *(Amended 2026-09-18 — removed the per-item selection list and the separate approval action described in an earlier revision of this requirement; replaced with the grade/type breakdown and a direct import. Further amended the same day to add the collapsed-by-default passage list, the read/import loading states, and the popup-result-then-reset flow, all requested directly.)*
- **FR-028**: Valid items in a package MUST import successfully even when other items in the same package are invalid, and MUST be immediately usable in exercises and random-group selection — with no pending-review status or separate approval step. A passage/multi-question group (FR-073) is the one exception to this per-item independence: it MUST import as a single atomic unit — if any of its sub-questions is invalid, the whole passage is skipped rather than importing with sub-questions missing. *(Amended 2026-09-18 — items originally defaulted to a Needs Review status excluded from random selection until separately marked Approved; that status/step no longer exists. An app-start migration retroactively approves any item still carrying the old Needs Review status from before this change.)*
- **FR-029**: The parent MUST be able to export selected quiz items to the same versioned JSON format for backup, external editing, or transfer to another installation, reproducing any passage/multi-question grouping (FR-073) rather than flattening it into disconnected standalone items.
- **FR-030**: The parent MUST be able to undo the most recent import batch (from the import screen itself, right after it completes) as long as none of its items has been used in an attempt; editing an individual imported item's grade, category, difficulty, tags, points, or archive status remains available one item at a time through the ordinary quiz-bank item editor. *(Amended 2026-09-18 — a dedicated multi-item bulk-edit screen existed alongside undo in an earlier revision of this requirement, scoped to the now-removed Needs Review queue; it was removed together with that queue, and undo moved onto the import screen as a more direct place to reach it.)*

#### Exercise builder and scheduling

- **FR-031**: The parent MUST be able to build an exercise from quiz-bank items with a required title, subject, grade, at least one item, and a whole-minute time limit; items MUST be reorderable, and an exercise may mix both subjects only when explicitly set to Mixed.
- **FR-032**: Each exercise MUST support: a configurable life count from three to ten, or unlimited lives; a configurable time limit from one to sixty minutes; an optional toggle for question randomization and for correction review; and a configurable passing threshold percentage (default seventy percent). *(Amended 2026-09-18 — lives were originally fixed at five; the separate replay toggle described in the original revision of this requirement no longer applies at all, per FR-015. Amended again the same day: also supports a "daily exercise" toggle per FR-091.)*
- **FR-033**: The parent MUST be able to assign an exercise to one child, both children, or a grade profile for a specific date, with at most one primary daily exercise per child per date; future-dated assignments MUST be supported, and changing an assignment MUST NOT delete prior attempts. If no dated assignment exists for a child on a given day, the app MUST fall back to that child's automatic rotation per FR-069 rather than leaving the day unassigned. An exercise's grade is informational only and MUST NOT block assignment to a child whose profile grade differs — the parent may freely assign above- or below-grade exercises.
- **FR-034**: The parent MUST be able to manage a reusable exercise library — listing title, subject, grade, question count, time limit, and active/archived state — and duplicate, edit, preview, archive, or delete an unused exercise; editing an exercise MUST NOT change an already-active child attempt built from it.
- **FR-035**: The exercise builder MUST support random quiz groups (defined by question count, subject, grade, categories, optional tags, difficulty range, allowed question types, recent-use avoidance, and weak-area preference) combinable with fixed items in the same exercise. *(Amended 2026-09-18 — difficulty range now spans the 5-level named scale, was 1–3. Amended again the same day: a random group may also carry a per-question points override, applied to every item it draws, same as a fixed item's own override — see FR-091.)*
- **FR-036**: When an attempt starts, random groups MUST resolve from active, Approved items matching all configured filters, without repeating a quiz within the same attempt; the resolved quiz IDs, order, random seed, content snapshot, and answer order MUST be stored and preserved if the attempt is resumed, with a new attempt drawing a new random set unless "repeat same questions" is enabled; the parent MUST be warned at save time if the current bank cannot satisfy a configured random group.
- **FR-037**: Random group resolution MUST support Fully Random, Balanced (default), and Practice Weak Areas modes.
- **FR-038**: When shuffling is enabled on a choice-based question, the app MUST display choices in randomized order per attempt while evaluating by stable choice ID, store the displayed order in the attempt snapshot, preserve it across a resumed attempt, generate a new order for a new attempt, allow the parent to disable shuffling per question, and offer a "shuffle again" action in preview.
- **FR-076**: In addition to the exercise's own overall time limit (FR-032, always enforced as a hard backstop regardless of the setting below), the parent MUST be able to choose one per-question timing mode for an exercise: **No limit** (default; a question has no individual time cap — matches this app's original behavior), **Distribute** (the overall time limit is split evenly across every resolved question), or **Custom** (the parent sets an explicit per-question time, in seconds, on individual fixed items and/or random groups; any item left unset behaves like No limit for itself).
- **FR-077**: When a question has a per-question time cap and it is reached before the child submits an answer, that one question MUST end as unanswered — not counted toward accuracy (same "nothing was actually answered" treatment as the overall-deadline timeout, FR-040) but removing exactly one life, the same as answering wrong, since the child had a fair chance at that specific question and let it lapse — and the attempt MUST automatically continue to the next question (or end normally as Completed, or as Try Again if that was also the last life, if it was the last question), without ending the whole attempt as Time Up. *(Amended 2026-09-18 — originally specified no life lost for a per-question timeout; changed so a lapsed per-question timer always costs a life like a wrong answer.)*
- **FR-078**: The child's current per-question remaining time, when a cap applies to the question on screen, MUST be shown distinctly from the exercise's overall remaining time, so the two are never confused.
- **FR-082**: The exercise builder MUST let the parent add questions through a dedicated browser rather than a flat list: a category tree (grouped by subject) restricted to the exercise's own grade (and to its own subject, unless the exercise is Mixed), a list of matching quiz items in the selected category, a detail view of the currently-selected item (prompt, choices with the correct one marked, type, difficulty, default points) shown alongside — never replacing — that list, and a live, continuously-updating list of every item already added to the exercise so far; an item already added MUST be visibly marked and MUST NOT be selectable to add again. *(Amended 2026-09-18 — whenever no single item is selected, the detail view instead shows the bulk random-add form described in FR-090, rather than a blank placeholder.)*
- **FR-083**: While viewing an item's detail in the question browser, before adding it, the parent MUST be able to set a per-item points override and — only when the exercise's per-question timing mode is Custom (FR-076) — a per-item time override; either override MUST apply only within this exercise and MUST NOT change the quiz item's own stored default point value or any other exercise using the same item. *(Amended 2026-09-18 — when the added item belongs to a multi-question passage, which always pulls in every sibling question as one block, the override MUST apply identically to every one of those sibling questions, not only to the specific question that was clicked; previously it was silently applied to just the clicked one, leaving its siblings with no override at all — a bug, now fixed.)*
- **FR-084**: The question browser MUST show a running summary of the exercise being built so far: total question count, total points (using each item's override when set, otherwise its own default), and total explicitly-configured per-item time. *(Amended 2026-09-18 — this summary now also reflects items added in bulk via FR-090, with no distinction from items added one at a time.)*
- **FR-090**: Whenever the question browser has no single item selected, its detail panel MUST offer a bulk random-add form: a difficulty level (the same 5-level scale as FR-017, plus a leading "Tất cả độ khó" / All option that matches any difficulty instead of narrowing to one level), a question count, and — only when the exercise's per-question timing mode is Custom — a per-question time override, plus a per-question points override, both applying to every item added by that action the same way FR-083's single-item overrides do. Submitting the form MUST draw that many distinct quiz items at random from those currently listed (i.e. matching the browser's current category/search filter) at the chosen difficulty (or any difficulty, when All is selected), excluding any item already in the exercise and excluding any passage-group item entirely (a passage is never split across a partial random draw), and add all of them to the exercise in one action; if fewer matching items are available than requested, the app MUST add as many as it can and tell the parent exactly how many were added instead of failing silently or drawing duplicates. *(Added 2026-09-18; amended same day to add the All option — for a daily exercise's slot, All resolves to the full 1–5 difficulty range on the stored `RandomGroupConfig`, since it has no separate "any difficulty" marker of its own.)*
- **FR-091**: The parent MUST be able to mark an exercise as a daily exercise. A daily exercise's `items` MUST only ever contain random-group entries — the question browser, in this mode, MUST disable individual-quiz selection entirely and its "add" action MUST instead add a category/difficulty/count/time/points *slot* (a `RandomGroupConfig`, not a resolved list of quiz ids) rather than resolving any concrete quiz right away; the parent MUST be able to add more than one such slot to the same daily exercise. A daily exercise is exempt from FR-015/FR-081's normal one-attempt-per-child-forever rule: a child MAY start one fresh attempt per local calendar day, and each day's attempt MUST independently draw its own random question set at the moment it starts (never reusing a prior day's resolved set), with no duplicate quiz item ever appearing twice within that same attempt across all of its slots. *(Added 2026-09-18.)*

#### Scoring, lives, and rewards

- **FR-039**: Each correct answer MUST earn its configured point value (default ten); accuracy MUST be computed as correct answers divided by submitted answers, shown as a percentage.
- **FR-040**: An incorrect submitted answer MUST remove exactly one life regardless of repeated submissions of the same question; an unanswered question at time expiry MUST NOT remove a life.
- **FR-041**: An attempt MUST be marked passed only when all questions are completed and accuracy meets or exceeds the exercise's passing threshold.
- **FR-042**: The app MUST award one star for completion, two for passing, and three for at least ninety percent accuracy with at least one life remaining.
- **FR-043**: The visible daily streak MUST increase at most once per local calendar day, only when the primary daily exercise is completed (not on replays).
- **FR-044**: The app MUST detect and surface a personal best when a child improves score, accuracy, or completion time on a repeated attempt of the same exercise.
- **FR-045**: The app MUST award badges for defined milestones (first completion, five-day streak, perfect score, persistence, subject milestones) and MAY offer avatar reactions, a treasure-path progress view, unlockable cosmetic themes, a deterministic daily bonus, and read-aloud audio; all such features MUST use brief, optional, non-blocking animations and MUST NOT include advertising, purchases, public leaderboards, or manipulative countdowns.

#### Point redemption

- **FR-085**: The parent MUST be able to select a child, view that child's current spendable point balance, and record a point redemption — a positive point amount with an optional note describing what was traded — that reduces the child's displayed point balance by that amount.
- **FR-086**: The app MUST refuse a point redemption that would take a child's balance below zero, stating the child's current balance in the refusal, and MUST NOT create any record for a refused redemption.
- **FR-087**: Every point redemption MUST be kept as a permanent, append-only history entry (amount, note, date) visible to the parent for that child, and a child's spendable point balance MUST always be computed as total points earned minus total points redeemed — never stored as a directly-edited running total.

#### Parent progress dashboard

- **FR-046**: The parent MUST see a separate overview per child showing exercises assigned/completed/passed/unfinished, accuracy by subject and grade, current streak, total practice time, lives lost, and recent activity, filterable by the last seven days (default), last thirty days, or all time.
- **FR-047**: The parent MUST be able to inspect an individual attempt in full detail — every prompt, submitted answer, correct answer, outcome, and response time — with the specific end condition (completed, time expired, lives lost, or abandoned) clearly distinguished, and this detail MUST remain readable even if the source quiz item is later changed.
- **FR-048**: The dashboard MUST list quiz items answered incorrectly at least twice, MUST summarize weak tags or skills once at least three responses exist for them, and MUST let the parent create a new practice exercise from a selection of such items.

#### Local data, offline behavior, and backup

- **FR-049**: All scoring, timing, scheduling, filtering, and reporting MUST run entirely on-device without requiring a network call.
- **FR-050**: The app MUST persist attempt state after the attempt starts and after every submitted answer, such that no submitted answer is ever lost to an unexpected app close.
- **FR-051**: Once required assets are cached after installation, the app MUST function fully offline for all child and parent activities except optional synchronization, and MUST show an offline-ready indicator once caching completes.
- **FR-052**: The parent MUST be able to export all local data plus references to supported media into one versioned backup file, and import a backup after the app validates its format and version, replacing current data only after explicit parent confirmation.
- **FR-053**: Resetting all local data MUST require parent login, an explicit warning, and a second confirmation step.

#### Optional Google Sheets synchronization

- **FR-054**: The parent MUST be able to connect exactly one Google account, create or select a compatible spreadsheet, and enable or disable synchronization from Parent Settings; children MUST NOT see or need Google authorization controls.
- **FR-055**: The parent MUST be able to choose Local Only, Manual Sync, or Automatic Sync; Automatic Sync MAY run at app start and after a completed exercise but MUST NOT block child login or exercise play.
- **FR-056**: The parent MUST have manual sync controls — Sync Normally, Review Conflicts, Retry, Replace Google With Local, Replace Local With Google, Pause Automatic Sync, and Disconnect Google — where replace operations require explicit confirmation and recommend a prior backup, and disconnecting Google MUST NOT delete local data.
- **FR-057**: Each synchronized record MUST carry version metadata (local version, last-known-Google version, current Google version at sync time) so the system can, by version comparison only, determine: no change, upload needed, download needed, or conflicting; an invalid version relationship MUST halt automatic sync and require repair or resolution rather than being merged automatically.
- **FR-058**: Only one device MUST be able to commit a synchronization at a time; a concurrent attempt MUST receive a busy result and keep its local changes pending for later retry.
- **FR-059**: Retrying an already-committed synchronization batch (identified by the same sync ID) MUST be a no-op that returns the prior committed result rather than reapplying changes.
- **FR-060**: A group of related changes (for example, an exercise together with its items and random-group rules) MUST commit or reject together as a single unit.
- **FR-061**: On a detected conflict, automatic sync MUST preserve local data, halt further automatic sync until every conflict is resolved, and continue to allow local child activity to save; the parent MUST be able to resolve each conflict with Use Local, Use Google, Keep Both, or Decide Later, with the resolved version set to one greater than the higher of the two conflicting versions.
- **FR-062**: Completed attempts, submitted answers, and earned rewards MUST be treated as immutable or append-only once recorded, and independent attempts from different children or devices MUST NOT be treated as conflicting with one another.
- **FR-063**: An active exercise attempt MUST remain owned by and resumable only on the device where it started; other devices may see that it exists but MUST NOT resume it, and the parent MUST be able to abandon a stale active attempt.
- **FR-064**: Synchronized deletions MUST create versioned tombstones retained for at least ninety days rather than immediate removal, and attempt snapshots MUST remain readable even if their source category, quiz, or exercise is later archived or deleted.
- **FR-065**: The app MUST refuse automatic synchronization when the Google-side schema version is newer than the version the installed app supports.
- **FR-066**: The parent password, Google authorization tokens, and cached or temporary interface state MUST NOT be written to the synchronized spreadsheet (a child profile has no credential to exclude, per FR-002); custom media MUST be cached locally and only optionally mirrored to a parent-designated cloud folder, referenced by identifier and checksum rather than embedded as spreadsheet content.

#### Platform and content scope

- **FR-067**: The application MUST be installable and fully usable on Windows desktop browsers and on Android mobile browsers; iOS/iPhone support is out of scope for this release.
- **FR-068**: The application's interface MUST be delivered in Vietnamese, and the language subject MUST teach and practice Vietnamese (the children's native language) — for example vocabulary, spelling, and reading comprehension.
- **FR-069**: The parent MUST be able to define an enabled rotation of exercises for each child; on any date with no explicit dated assignment, the app MUST automatically select that child's next exercise from this rotation as the daily exercise, ensuring a child always has something to play without a manual assignment for every day.

#### Navigation, iconography, and interface polish

- **FR-070**: Every parent-facing screen MUST be reachable through persistent in-app navigation — a docked sidebar on wide viewports and a collapsible drawer (opened via a menu control) on narrow viewports — so no parent screen depends on the browser's own back button to return to another area of the app.
- **FR-071**: The app MUST use a consistent icon set across child and parent screens to reinforce meaning (subjects, actions, status), and that icon set MUST be fully available offline (bundled with the app, not loaded from an external font/CDN service) so iconography never depends on network access.
- **FR-072**: Decorative motion (background animation, a depleting time-remaining indicator during a timed question, entrance/transition effects) MAY be used for visual richness but MUST NOT delay or block any interaction, MUST respect the operating system's reduced-motion preference, and MUST NOT be the only way information (e.g., time remaining) is conveyed — a text or numeric equivalent MUST always be present alongside it.

### Key Entities

- **Profile**: One of the three fixed users (Child One, Child Two, Parent) — role, display name, avatar, grade level, and preferences. Only the `parent` role carries a credential (a password); a `child` profile has none — logging in is avatar selection alone (FR-002).
- **Category**: A parent-defined grouping for quiz items, unique by name within a subject, with an active/archived status and version metadata for sync.
- **Quiz Item**: One reusable question — subject, grade, type, prompt, choices/answer rule, explanation, tags, a named 5-level difficulty (Dễ/Trung bình/Khó/Rất khó/Chuyên gia, default Trung bình — amended 2026-09-18, was an unnamed 1–3 number), points, optional media, and review/archive status. Belongs to exactly one category, always — an item imported without one is assigned a per-subject default category rather than left uncategorized. May optionally belong to a shared passage/problem group (FR-073): a shared title/text plus this item's position and the group's total sub-question count.
- **Exercise**: An ordered (or partly randomized) set of quiz items with a life count (a number from three to ten, or unlimited — FR-032), a time limit, passing threshold, and play-rule settings, assembled from fixed items and/or random groups; each fixed item may also carry a per-exercise points override (FR-083), and each random group may carry a per-item points override of its own (FR-091, amended 2026-09-18). Also carries a per-question timing mode (FR-076): none, distribute, or custom (with an optional per-second time on individual fixed items and random groups). An exercise's `replayAllowed`/`repeatSameQuestions` toggles are retained on old records but no longer read anywhere — every exercise is one-attempt-per-child regardless (FR-015), except a daily exercise (`isDaily`, FR-091, added 2026-09-18), which is one-attempt-per-child-per-local-day instead and whose `items` may only ever contain random groups, never a fixed item.
- **Assignment**: A link between a profile, an exercise, and a calendar date, marking whether it is that child's primary daily exercise; each child also has an enabled rotation (an ordered list of exercises) used to auto-select a daily exercise on dates without an explicit assignment.
- **Attempt**: One child's playthrough of an exercise — a content snapshot at start time, timing, status (in progress/completed/time up/try again/abandoned), lives remaining (a number, or unlimited — mirrors the exercise's own life count), score, and accuracy. When the exercise's per-question timing mode is active, also carries the per-question seconds resolved for this specific attempt and the current question's own deadline (FR-076–078); the overall exercise deadline is unaffected and always still applies. A per-question timeout now also removes one life, the same as answering wrong (amends FR-077's original "no life lost" wording).
- **Answer Result**: One submitted answer within an attempt — the snapshot of the question asked, what was submitted, correctness, points earned, and response time. The result screen's per-question breakdown (FR-079) is built entirely from these plus the attempt's own frozen item snapshots — never a live QuizItem lookup.
- **Reward**: A star, badge, or streak entry earned by a child, linked to the attempt that produced it.
- **Point Redemption**: An append-only record of the parent trading a child's earned points for a real-world item or privilege — the profile, a positive point amount, an optional note, and a timestamp (FR-085–087). A child's spendable balance is always computed (sum of Attempt scores minus sum of PointRedemption amounts for that profile), never stored as a running total.
- **App Settings**: Device-level preferences such as audio, reduced motion, feedback delay, and backup metadata.
- **Sync Transaction**: A record of one synchronization attempt — its status, device, record count, and outcome, used for idempotent retries and conflict tracking.
- **Deleted Record**: A tombstone marking that a previously synchronized record was removed, retained for a minimum period so all devices can reconcile the deletion.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A child can reach the start of today's exercise in three or fewer actions after a successful login.
- **SC-002**: No submitted answer is ever lost across an unexpected app close and reopen, verified through repeated interruption testing at multiple points in an attempt.
- **SC-003**: After initial installation and asset caching, every child and parent function except optional synchronization remains fully usable with the network and any installation server turned off.
- **SC-004**: A parent can create a new quiz item, assemble it into an exercise, and assign it to a child for a future date without any developer or engineering assistance.
- **SC-005**: Screen transitions and answer evaluations complete within 300 milliseconds on the agreed target devices.
- **SC-006**: The app remains responsive, with no noticeable slowdown in list or search views, at a bank of at least 2,000 quiz items and 10,000 stored answer results.
- **SC-007**: Each child's progress, rewards, assignments, and credentials remain fully independent of the other child's at all times.
- **SC-008**: When two devices attempt synchronization at the same moment, exactly one commits and the other is safely deferred with no data loss or corruption.
- **SC-009**: A detected version conflict during synchronization never overwrites either the local or the Google copy of a record, and automatic synchronization does not resume until the parent has resolved it.
- **SC-010**: Retrying an already-committed synchronization never produces duplicate records or double-applied changes.
- **SC-011**: A backup exported from one installation and restored onto a reset installation reproduces the same quiz bank, exercises, profiles, and progress.
- **SC-012**: An AI-generated quiz package can go from import through category resolution, review, and approval to use inside a random exercise without any manual re-entry of question data.
- **SC-013**: Daily practice completion, streaks, and rewards reflect the same calendar day the attempt was actually finished on, with the streak increasing at most once per day.
- **SC-014**: Every parent screen remains reachable and fully usable, with no horizontal scrolling, at both a common desktop width and a common phone width (390px), without ever requiring the browser's own back button to reach another area of the app.
- **SC-015**: A passage/multi-question group's sub-questions are never partially present — not when added to an exercise, not when imported from an AI-generated package, and not when a child plays them — every check confirms all-or-nothing grouping end to end.
- **SC-016**: A per-question time cap (Distribute or Custom mode) never ends the whole attempt by itself — only running out of lives or the overall exercise deadline can do that — verified by letting a per-question timer expire unanswered and confirming the attempt loses exactly one life and simply continues to the next question, never jumping straight to Time Up. *(Amended 2026-09-18 — originally required no life lost on a per-question timeout; see FR-077.)*
- **SC-017**: A child reaches their home screen the moment they tap their own avatar, with no credential-entry step in between.
- **SC-018**: Every question in an exercise is shown to the child exactly once per attempt — never skipped, never repeated — even when the child answers as fast as the UI allows.
- **SC-019**: An exercise configured with unlimited lives never ends early regardless of how many incorrect answers are submitted; it only ends on completion or the overall time limit.
- **SC-020**: Once a child has any finished attempt for an exercise, no further attempt of it can be started for that child, on any screen, and the past result remains viewable on demand.
- **SC-021**: A parent can redeem a valid point amount for a child and see both the parent-facing balance and the child's own home-screen total drop by exactly that amount, with an over-balance redemption attempt changing neither.
- **SC-022**: A quiz package's questions are always categorized by the grade and type each question specifies in the file itself — never a parent-chosen value for the import as a whole — and are usable in an exercise immediately after import completes, with no separate approval step in between.
- **SC-023**: Selecting an import file and committing an import each show a visible loading state for their duration; a completed import's result appears in a popup; and closing that popup leaves the import screen completely empty (no stale preview, no stale file selection) — re-selecting the very same file immediately after produces a fresh preview, proving the reset is real and not merely visual.
- **SC-024**: A quiz package item or passage with no `category` field at all still imports successfully — categorized under a default category rather than skipped — verified by importing a file with an item missing `category` and confirming it appears in the bank afterward.
- **SC-025**: In the Quiz Bank tree, changing a quiz item's category in the detail panel and pressing Save moves that item to its new category's branch of the tree with no page reload, verified by selecting an item, changing its category, saving, and finding it listed only under the new category.
- **SC-026**: Changing a quiz item's grade, or deleting a quiz item, after it has already been used in a built exercise and a completed attempt, changes neither the exercise's own item list nor that attempt's historical question/answer breakdown — verified by playing an exercise to completion, then editing one used item's grade and deleting a second used item from the bank, and confirming the exercise library still lists the exercise with its original 3 questions and the completed attempt's detail view still shows all 3 original prompts/answers unchanged, including the one whose underlying item was deleted.
- **SC-027**: Using a category node's bulk grade-change moves every item shown under that node — and no others — to the chosen grade in one action, with the tree reflecting the move immediately; using its bulk delete removes every item shown under that node — and no others — in one action, verified by bulk-acting on one (subject, grade, category) node containing N items while a sibling node under a different grade/category is left completely untouched.
- **SC-028**: The exercise builder's bulk random-add never adds a duplicate quiz item into the same exercise and never adds more items than are actually available, verified by bulk-adding from a category twice in a row with the same settings — the second draw only ever adds items the first draw didn't (shrinking the pool each time), and requesting more than remain adds exactly the remaining count with a message stating how many were actually added.
- **SC-029**: A daily exercise renews correctly and never contains a specific pre-chosen quiz: building one only ever offers category/difficulty/count/time/points slots (individual-item selection is unavailable), a completed attempt blocks a new one only until the next local calendar day (verified by backdating the completed attempt's timestamp and confirming the Start button reappears rather than "Xem kết quả"), and playing it never shows the same quiz item twice within one attempt even when built from multiple slots.
- **SC-030**: A legacy quiz item with no `difficulty` stored at all is treated as 2/Trung bình consistently everywhere — its label in the Quiz Bank tree, its match against a specific chosen difficulty in the bulk-add pool, and its match against "Trung bình" specifically — verified by injecting such an item directly into storage and confirming it appears under a "Trung bình" filter/pool but not under "Dễ" or any other level, while "Tất cả độ khó" (All) always includes it regardless.
- **SC-031**: Adding one question of a multi-question passage in the exercise builder, with a per-question time/points override configured, applies that exact override to every question of that passage once added — not only to the one specifically clicked — verified by adding just one sub-question of a 2-question passage with an override set and confirming both resulting exercise items show the identical override.

## Assumptions

- "Five grades" refers to Grade Levels 1 through 5, used consistently for both mathematics and language content.
- Questions within an exercise are answered in their configured order unless the parent explicitly enables random order for that exercise.
- There are exactly two child profiles and one parent profile for the current release; no registration, password recovery, or additional profiles are in scope.
- The parent password is defined in local application configuration and is not validated against any external identity system; a child profile has no credential at all (FR-002). Guarding against a technically skilled user tampering with the local app or device is out of scope.
- The parent is the only user who authors content, builds exercises, schedules assignments, and reviews progress; there is no collaborative or multi-parent authoring workflow.
- IndexedDB is the single operational database on each device; Google Sheets, when connected, holds a synchronized shared copy and is never required for the app to function.
- No built-in AI question-generation service is included; AI-assisted content creation happens outside the app, with the app only providing the template/instructions and the import pipeline.
- Standard modern-browser assumptions apply for installability, caching, and storage (a browser capable of PWA installation and IndexedDB), consistent with the target platforms once confirmed.
- The target platforms are Windows desktop browsers and Android mobile browsers; iOS/iPhone support is deferred to a future release.
- The application interface language is Vietnamese, and the language subject teaches Vietnamese as the children's native language (vocabulary, spelling, reading comprehension), rather than a foreign language.
- Hints are excluded from this release; no hint field, hint toggle, or hint-use tracking is part of the quiz item, exercise, or attempt data.
- Grade is informational metadata on quiz items and exercises; it is never enforced as a restriction against a child's own profile grade.
- Formal accessibility compliance (e.g., WCAG) and assistive-technology support are out of scope for this release; only a touch-friendly interface appropriate for the two known children is expected.
- The deployed installation's two child profiles are configured with the family's real display names (rather than the generic "Child One"/"Child Two" placeholders used throughout this spec for readability) plus the parent's real local password; those actual values live only in local app configuration/seed data per FR-002/FR-006/FR-066, never in project documentation. *(Amended 2026-09-18 — a child profile no longer has a credential of its own, per FR-002.)*
- Passage/multi-question authoring (FR-073) offers single-choice, multiple-choice, true/false, short-text, and number sub-questions — match-pairs is excluded there since it has no child-play rendering yet regardless of passage grouping (a pre-existing gap, not introduced by this feature).
- Duplicate detection against the existing bank (FR-026) runs for standalone package items; it does not yet run against a passage's sub-questions, since passage content is new enough per release that duplicate reading-passage imports are expected to be rare and parent-reviewable via the import preview either way.
- The separately-deployed `apps-script/` Google Sheets sync backend was not updated for the new PointRedemption entity (FR-085–087) — it cannot be tested or redeployed from within this development environment. Point redemptions save, back up, and restore correctly on-device regardless (FR-052, FR-085–087); only cross-device Google Sheets sync of redemption history specifically needs a future backend update (adding a matching sheet tab, per `apps-script/src/sheets/entity-tabs.ts`'s existing generic-row pattern) before it will propagate between devices.
