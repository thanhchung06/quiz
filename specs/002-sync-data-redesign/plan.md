# Sync data redesign — plan

Status: **agreed design, not implemented yet.** Every decision below was confirmed with the product owner
entity by entity; items marked *(proposal)* are additions of the implementer that still need a yes.

Replaces the current generic sync (one tab per entity, version compare, ChangeLog, SyncTransactions,
conflicts) with a layout per entity, built around who writes what.

---

## 1. Principles

- **Local first, Google as the shared copy.** All data lives on the device (IndexedDB). With
  "Tự động đồng bộ" on, every write also goes to Google right away.
- **No offline while sync is on.** If a write to Google fails, the app shows the error and a
  **Thử lại** (retry) button; the child/parent cannot go on until it succeeds. With sync off, everything
  stays on the device only.
- **Pull only at app start** (only when "Tự động đồng bộ" is on). Login is disabled behind a loading
  screen until the pull is done. On failure: error + **Thử lại**, login stays blocked — no way to continue.
- **No conflicts, no version comparison, no change log.** Each record has one writer, or is changed by
  small operations the script applies (add/remove an item, set one field), never by overwriting a JSON
  another writer also changes.
- **Schema version.** The sheet's Metadata and the app each have a schema version. Mismatch → no sync
  (error shown). The local database also has a version: on mismatch **all local data is dropped** — so
  installing this redesign starts from empty (export to JSON first, then import, see 6).
- **UUID everywhere.** Every record gets a UUID generated on the device when it is created, before it is
  sent. The script never stores two records with the same UUID in a sheet — a repeated request updates or
  skips instead of duplicating. This is what makes retries safe, so SyncTransactions is not needed.
- **Google never computes.** Sums (total points) are computed on the device and pushed as a value.

## 2. Settings (device)

| Setting | Effect |
|---|---|
| Tự động đồng bộ | Pull at app start + push every write. Off = local only. |
| Nhận câu hỏi khi mở ứng dụng | Include Question + Category in the app-start pull. |
| Chỉ nhận câu hỏi mới thêm | With the above: skip questions/categories already on the device. |
| Nhận bài tập khi mở ứng dụng | Include Exercise in the app-start pull. |

When a child plays and a question is missing locally (question pull off), the app pulls **just those
questions** by UUID before starting.

## 3. Sheets

| Sheet | Row = | Writers | Pull at app start |
|---|---|---|---|
| Metadata | singleton | script | schema version, counters |
| Profile | one profile | parent (all fields), child + parent (`totalPoints` only) | all rows |
| Assignment | one child | parent (add/remove), child (remove, set try) | all rows |
| Session | one child (≤ 1 ongoing exercise) | child | all rows |
| Result | circle of 1000 rows, shared by all children | child (insert) | id > local max |
| HistoryResult | one finished try, append-only | child (insert) | rows after the last one read |
| PointUsage | one point spend, append-only | parent (insert) | rows after the last one read |
| Exercise | one exercise | parent | updateSequence > local max (if setting on) |
| Question | one question | parent | updateSequence > local max (if setting on) |
| Category | one category | parent | updateSequence > local max (if setting on) |

Removed sheets: **ChangeLog**, **SyncTransactions**, **Rotation**, **Attempt**, **AnswerResult**,
**Reward**, **PointRedemption** (replaced by PointUsage). Big JSON cells keep the current chunking
(45,000 characters per cell, split across columns).

### 3.1 Profile

- Fields: uuid, role, name, avatar, grade, preferences, **password (plain, as the owner chose)**,
  totalPoints.
- The parent edits everything except `totalPoints` — write = overwrite the row.
- `totalPoints` is its own operation **SET_TOTAL_POINTS(profileUuid, value)** so it never overwrites a
  profile edit. Sent by the child's device after earning, by the parent's device after a point use.
- Children cannot be deleted.

### 3.2 Assignment (one row per child)

Row: `childUuid` → JSON `{ assignments: [...] }`.

Each assignment:
- `uuid`
- `exerciseSnapshot` — the whole exercise as it was when assigned (settings, pass rate, point settings,
  items). Questions and random-group rules stay **references by id** into the question bank; random
  groups are picked at play time. Editing/deleting the exercise later doesn't affect the assignment.
- `availableFrom` — now, or a date + time.
- `deadline` (optional) — finishing after it still records the result and score, flagged late.
- `tries` — number of tries started.

Operations (applied by the script to that child's row):
- **ADD_ASSIGNMENT(childUuid, assignment)** — parent. Same uuid already there → nothing.
- **REMOVE_ASSIGNMENT(childUuid, uuid)** — parent (take back) or child (done). Not there → nothing.
- **SET_TRY(childUuid, uuid, n)** — child, when starting a try. Script keeps `max(current, n)` so a repeat
  is harmless.

The child removes an assignment when it **passed** (points counted) **or has no tries left** (exercise
repeat limit / replay setting). Unlimited tries → only the parent removes it.

Rotation (ordered exercise list) and the daily primary slot are **removed**. Existing assignment and
rotation data is **not migrated** (start fresh).

### 3.3 Session (one row per child)

What the child is doing now, so opening the app (on any device) goes straight back into the exercise.

- Created when the child starts an exercise (assigned or practice): `uuid`, `assignmentUuid?`,
  `exerciseSnapshot`, try number, **question snapshot** (all questions of this play, random groups
  picked, choice order fixed) — uploaded **once**, never rewritten.
- Progress, updated on every submitted answer: answer status per question, current question, lives left,
  **time left** (overall + per question), score so far.
- The clock keeps running while the app is hidden (switched away) and **stops only when the app is
  closed**. Time left is stored (not a deadline): saved locally as it runs, resumed from there when the
  app is opened again, and uploaded with the next answer.
- Operations:
  - **START_SESSION(childUuid, session)** — replaces whatever was there.
  - **UPDATE_PROGRESS(childUuid, sessionUuid, progress)** — ignored if `sessionUuid` isn't the current
    session (a late update can't revive a finished one). Last update wins across devices.
- Starting another exercise while one is ongoing: the child is asked to give up the current one; it is
  finished as abandoned (counts as a try).

### 3.4 Result (circle of 1000) and HistoryResult (forever)

**Result** — full detail for review: `uuid`, `id` (increasing number handed out by the script under its
lock; row = `(id − 1) mod 1000 + 1`), child, assignment, exercise, try number, answers, question snapshot,
score, stars, bonus, points earned, counted flag, late flag, times.
- The circle is shared by all children. The device keeps the same circle locally: storing id N drops
  id N − 1000.
- Pull: ids > local max. A device more than 1000 behind gets only the last 1000 (older detail is gone;
  history still has everything).

**HistoryResult** — short, append-only, never edited: `uuid`, child, exercise, assignment, try number,
exercise title, attemptedAt, correct count, wrong count, points earned, stars, **counted** (passed),
late. Used to compute total points and to reconcile.
- Pull: rows after the last one read.

Insert both only through the finish request (3.9). Duplicate uuid → skipped (script checks the uuid column;
for Result, the 1000 rows before handing out an id). After the insert, the device stores what the script
returned (id / row) locally.

### 3.5 Scoring

Stars (hard-coded):
- **3 stars**: 100% correct.
- **2 stars**: ≥ halfway between pass rate and 100%, rounded down (pass 60% → 80%, pass 75% → 87%).
  No pass rate → 80%.
- **1 star**: ≥ pass rate. No pass rate → any score below 80%.
- **0 stars**: below the pass rate → not passed, points not counted, child may retry if tries are left.

Bonus: 3 stars +50% of the score, 2 stars +25%, 1 star +0, rounded down. Earned = score + bonus.
Example: score 45, 2 stars → bonus 11 → 56.

No pass rate: the first try passes. Practice (no assignment) also earns points, from the exercise's own
settings.

Badges, streaks, personal bests and the daily bonus are **dropped**.

### 3.6 PointUsage

Append-only: `uuid`, child, points, note, time. Written by the parent (**INSERT_POINT_USAGE**). Duplicate
uuid → skipped. Pull: rows after the last one read.

### 3.7 Total points

After a finish (child) or a point use (parent):
1. push the HistoryResult / PointUsage row;
2. pull HistoryResult and PointUsage up to the latest row;
3. total = Σ counted points − Σ points used (on the device);
4. **SET_TOTAL_POINTS** on the child's profile.

### 3.8 Exercise, Question, Category

- One row per record, the whole JSON; only the parent writes; write = overwrite the row.
- **updateSequence**: every record of these sheets has this field; a counter per sheet in Metadata.
  - Insert / update (including "delete", which only sets a deleted mark): the client does **not** send
    the value. The script sets it to the next number, stores the record and returns the number; the
    client then sets it on its local record.
  - Pull: `max(updateSequence)` of the local records → get from Google the records with a larger one.
  - Known trade-off (accepted): if another device wrote in between and this device hadn't pulled yet,
    its own newer number raises the local max past those writes, and they are picked up only by a full
    re-pull ("Đồng bộ ngay").
- "Chỉ nhận câu hỏi mới thêm": pulled records whose uuid is already on the device are skipped.
- Missing questions at play time: **FETCH_BY_UUID(sheet, uuids)**.

### 3.9 Finish request (one request, all or nothing)

When an exercise ends (completed, time up, out of lives, abandoned):
- insert Result + HistoryResult,
- remove the Session,
- REMOVE_ASSIGNMENT if passed or no tries left.

Then the total points flow (3.7).

## 4. Script operations

Reads (no lock): `PULL_ROWS(sheet)` (whole sheet: Profile, Assignment, Session),
`PULL_AFTER_ROW(sheet, row)` (HistoryResult, PointUsage), `PULL_RESULTS_AFTER(id)`,
`PULL_SEQUENCE_AFTER(sheet, seq)` (Exercise, Question, Category), `FETCH_BY_UUID(sheet, uuids)`.

Writes (script lock, all idempotent by uuid): `WRITE_RECORD(sheet, record, localMax)` (Exercise, Question,
Category, Profile), `SET_TOTAL_POINTS`, `ADD_ASSIGNMENT`, `REMOVE_ASSIGNMENT`, `SET_TRY`, `START_SESSION`,
`UPDATE_PROGRESS`, `FINISH` (3.9), `INSERT_POINT_USAGE`.

Kept: shared secret, `spreadsheets.currentonly` scope, cell chunking, schema version check.

## 5. App flows

- **App start** (sync on): loading screen, login disabled → send what the outbox still holds → PING:
  if Google's `syncId` equals the device's `lastSyncId`, nothing changed — no pull; otherwise pull Profile,
  Assignment, Session, HistoryResult, PointUsage, Result, and Exercise / Question / Category per settings,
  then store the `syncId` read before pulling → login enabled. Error → message + Thử lại.
- **syncId**: Metadata holds a UUID replaced on every write that changes something; PING and WRITE return
  it (WRITE also returns the one before). After its own write the device stores the new one only if the one
  before was its own `lastSyncId` (nobody else wrote in between). Cleared when the pull settings, the
  connection, a reset or an import change what the device holds.
- **Child login** with a Session → straight into that exercise.
- **Every write** → its operation is sent immediately; failure → error + Thử lại.
- **"Đồng bộ ngay"** (manual) keeps today's behavior and dialog, on the new sheets: one direction per run,
  "Không đồng bộ câu hỏi", "Chỉ đồng bộ câu hỏi mới thêm", progress + summary.
  - Máy này → Google: send every local record the logged-in person may write (idempotent by uuid;
    Exercise/Question/Category get new updateSequence values).
  - Google → máy này: re-pull everything, ignoring local maxima / row pointers, overwriting local.

## 6. Moving existing data

- The owner exports all data to JSON **before** installing the new code; the new version starts empty
  (local and sheet — new schema version).
- **Import must accept the old export file** and convert it to the new layout:
  - Profiles, Categories, Questions, Exercises → as is (new fields filled: uuid = old id,
    updateSequence assigned when uploaded).
  - Attempts + AnswerResults → Result (newest 1000) and HistoryResult (all), with stars/points computed
    by the new rules (3.5).
  - PointRedemptions → PointUsage.
  - Assignments, Rotations, Rewards → dropped (start fresh).
  - Then total points are recomputed (3.7). With sync on, the imported data is uploaded.
- The new export/backup format follows the new entities (contracts/backup-format.md to update).
- Reports and history screens read **Result** only (the last 1000).

## 7. Implementation order (proposal)

1. Script: Metadata counters, UUID-idempotent helpers, new sheets and operations, remove ChangeLog /
   SyncTransactions. Tests on the fake sheet.
2. Local model + Dexie migration (new tables, drop Rotation/Reward/…), scoring (3.5).
3. Exercise / Question / Category with updateSequence.
4. Profile + total points; PointUsage.
5. Assignment (snapshot, availableFrom, deadline, tries) + UI changes (remove rotation).
6. Session + resume on login.
7. Finish request, Result circle, HistoryResult; reports switched over.
8. App-start pull with blocked login; error/retry for writes; settings screen.
9. Import of old export files (6), new export format, end-to-end tests, then remove the old sync code.
