# Quickstart: Validating the Child Learning Exercise Application

This guide proves the feature works end-to-end, mapped to the spec's Acceptance Scenarios and Success Criteria. It assumes the Angular app and (optionally) the `apps-script/` sync project described in plan.md have been implemented per data-model.md and contracts/.

## Prerequisites

- Node.js + Angular CLI installed; project dependencies installed (`npm install`).
- A Chromium-based browser (for Playwright e2e runs and for manually testing PWA install/offline behavior).
- (Only for sync scenarios) A test Google account and a spreadsheet created from the app's "create compatible spreadsheet" flow, with the `apps-script/` project deployed as a Web App under that account.
- Seed data: at least one Category per subject, a handful of QuizItems (single-choice, short-text, number), one Exercise built from them, and a Rotation entry for each child profile (so P1/US1 has something to play with no explicit dated Assignment).

## 1. Build and install the PWA

```bash
npm run build
npm run serve:dist   # or any static file server pointed at dist/
```

- Open the served URL, confirm the app installs (browser install prompt / "Add to Home Screen" on Android).
- Wait for the offline-ready indicator (FR-051) before proceeding.

**Validates**: FR-051, part of SC-003.

## 2. Offline launch (SC-003, User Story 6 scenario 1)

1. With the app already installed and cached, actually stop the static file server process (not just a devtools "Offline" toggle, which only simulates the network and can mask a service-worker misconfiguration) and confirm no process is listening on its port.
2. Relaunch the installed app — ideally from its installed desktop/home-screen shortcut rather than a browser tab, to also confirm PWA installability (manifest + icons + registered service worker) held up.
3. Complete a full child login → daily exercise → result flow, and separately open the parent quiz bank and dashboard.
4. Only then restart the server and confirm Google Sheets sync (if configured) still succeeds from that same already-open installed app — proving the sync path re-establishes independently once connectivity returns, rather than requiring a fresh app load.

**Expected**: every screen loads and functions with zero network requests succeeding while the server is down; nothing blocks on a failed fetch; sync succeeds again once the server is back without needing to relaunch the app.

## 3. Child daily exercise, including the rotation fallback (User Story 1, FR-069)

1. As a profile with no dated Assignment for today but a non-empty Rotation, log in as that child by tapping their avatar only — confirm the home screen is reached directly, with no PIN or other credential prompt (FR-002, amended 2026-09-18).
2. Confirm the home screen shows a daily exercise anyway (the next Rotation entry), per the FR-069 clarification.
3. Start the exercise, tap through every question (submitting each answer advances immediately to the next one — no in-play correct/incorrect panel, FR-012), and confirm the result screen shows score/accuracy/time/lives/rewards plus a full per-question breakdown of every prompt, the selected answer, and the correct answer (FR-079).
4. Repeat for a wrong-answer-driven `tryAgain` ending (as many incorrect answers as the exercise's configured life count, e.g. 3) and a `timeUp` ending (let the deadline pass with questions remaining).

**Expected**: attempt status matches the ending condition; all prior answers are preserved in both non-completion cases (FR-013); the result breakdown correctly marks any question left unanswered by a `timeUp`/`tryAgain` ending as "Chưa trả lời" with the correct answer still shown.

## 4. Interrupted attempt resume (User Story 1 scenario 7)

1. Start an exercise, answer 2–3 questions, then force-close the app (not just navigate away).
2. Reopen and log in as the same child.

**Expected**: resumes at the next unanswered question, with the original `deadlineAt` and `livesRemaining` intact — not reset (FR-014).

## 5. Parent builds and assigns an exercise (User Story 2)

1. As the parent, create a category, add 5+ QuizItems to it (mixing single-choice, short-text, number).
2. Build an Exercise: set its subject/grade first, then open the question browser (FR-082) — confirm the category tree, item list, and detail view are all visible together (selecting an item never hides the list), and that only items matching the exercise's own grade/subject appear; add several items, confirm one already added shows as marked and cannot be re-added, and confirm the running total (count/points/time) updates live (FR-084).
3. While adding one item, set a per-item points override (and, if Custom timing mode is on, a per-item time) and confirm it's reflected in the main item list after closing the picker, without changing that QuizItem's own default points anywhere else it's used (FR-083).
4. Set a life count (any value 3–10, or Unlimited) and a 10-minute time limit, then save (FR-032).
5. Assign it to a child for tomorrow's date.
6. Edit or delete one of the QuizItems used, then open a past Attempt that used it (if one already exists) and confirm the historical view is unchanged (FR-020).

**Expected**: exercise appears in the library with correct metadata; the child's home screen for tomorrow shows this exercise as primary; history is untouched by the later edit.

## 6. AI-generated quiz package import (User Story 4, FR-025, FR-027–028, FR-030, SC-022–023)

1. Download the package template (FR-025) — note the Import screen now shows only this download button and the file picker; there is no in-app AI-prompt generator (removed 2026-09-18).
2. Prepare (or hand-craft) a sample package per `contracts/quiz-package-format.md` mixing at least two different grades and two different question types (include at least one `true-false` item, to exercise the same choice-id grading path as `single-choice`/`multiple-choice` per the note in `contracts/quiz-package-format.md`, and at least one passage/multi-question group), plus: one item with an invalid `correctAnswerIds` reference, one duplicate `externalId`, and one item referencing a brand-new category.
3. Select the file — briefly note the "Đang đọc tệp…" loading row while it's being read/validated — then inspect the preview: total/valid/invalid/duplicate/proposed-category counts, plus a grade/type breakdown (e.g. "Lớp 1 · single-choice: 2") computed from each question's own grade/type in the file — confirm there is no grade/type picker anywhere on this screen and no listing of every individual question.
4. Confirm the passage section starts collapsed, showing only its title and count with a "tất cả đã chọn" summary — expand it, confirm every passage's checkbox is checked by default, then collapse it again.
5. Skip the duplicate, then click "Nhập câu hỏi" — note the button's "Đang nhập…" loading state while it commits.
6. Confirm the result appears in a popup ("Đã nhập N câu hỏi.") rather than inline text.
7. Click "Hoàn tác lần nhập này" inside that popup — confirm the batch is fully undone (FR-030) and the popup's undo button disappears/updates accordingly.
8. Re-import the same file (to leave data in place for later steps), then click the popup's "Đóng" — confirm the whole screen resets: no summary, no breakdown, and the file input itself is cleared (re-selecting the exact same file immediately produces a fresh preview rather than doing nothing).
9. Confirm every imported item is immediately visible in the Quiz Bank and immediately eligible for random-group selection — no pending/needs-review state, no separate approval action anywhere (FR-028). Play the imported `true-false` item as a child and confirm both a correct and an incorrect answer grade as expected.
10. Confirm "Duyệt câu hỏi" no longer appears in the parent navigation at all.

**Expected**: preview counts and the grade/type breakdown match the crafted package exactly; valid items save despite the invalid one; error report is downloadable for the invalid item; imported items are usable with zero extra steps; the loading states, collapsed-by-default passage list, and popup-then-full-reset flow all behave as described.

### 6a. Legacy needs-review cleanup migration (FR-028)

1. With the app already installed once (so its IndexedDB exists), inject a quiz item with `reviewStatus: 'needsReview'` directly into the `quizItems` store (standing in for an item imported before 2026-09-18, when this status still existed).
2. Reload the app.
3. Confirm that item's `reviewStatus` is now `'approved'` — the app-start migration (`approveAllPendingQuizItems()`) swept it automatically, with no parent action required.

## 6b. Passage / multi-question groups (FR-073–075)

1. From the Quiz Bank, use "Thêm đoạn văn/bài toán nhiều câu hỏi" to author a short reading passage with 2–3 sub-questions (mix question types, e.g. single-choice + true-false).
2. In the Exercise Builder, pick any one of that passage's questions from the item picker — confirm every sibling sub-question is added automatically, in order, and that removing one from the item list removes the whole group.
3. Assign the exercise and play it as a child — confirm the shared passage text is shown above every sub-question, with its own "Câu N/M của đoạn này" position alongside the exercise's overall question count, and that each sub-question grades independently (a wrong sub-answer costs a life same as any other question; a right one doesn't).
4. Separately, download the package template (now formatVersion `1.1`, includes a worked passage example), re-import it unchanged, and confirm the import preview lists the passage as one unit (title + question count) that imports (or is skipped) as a whole rather than partially.
5. Export the newly-authored passage's questions from the Quiz Bank and confirm the exported file groups them back into a `passages[]` entry rather than flattening them into disconnected `quizzes[]` items.

**Expected**: a passage's sub-questions are never partially present in an exercise, a random group, an import, or an export (SC-015).

## 7. Random exercise resolution and shuffling (FR-036–038)

1. Build an Exercise combining 2 fixed items and one random group (e.g., 5 items, Balanced mode) from a bank with just enough matching Approved items.
2. Start an attempt; note the resolved question set/order and any shuffled choice order.
3. Force-close mid-attempt and resume; confirm the identical resolved set/order/shuffle reappears (same stored seed).
4. Start a fresh attempt of the same exercise (with `repeatSameQuestions` off); confirm a different resolved set is drawn.

**Expected**: no duplicate questions within an attempt; resume preserves the exact snapshot; a new attempt reshuffles unless configured not to.

## 7b. Per-question timing modes (FR-076–078)

1. Build an exercise with 3 fixed items, set **Custom** timing mode, and give only the *first* item an explicit per-question time (e.g. 2 seconds) — leave the other two blank.
2. Play it as a child: confirm the first question shows a distinct per-question countdown badge (separate from the overall exercise timer) and the other two do not.
3. Let the first question's timer run out without answering — confirm it advances to the next question automatically, exactly one life is removed (same as a wrong answer, FR-077 amended 2026-09-18), and the overall exercise deadline is untouched.
4. Answer the remaining questions normally and confirm the attempt still completes correctly, and that the result screen's breakdown (FR-079) shows the timed-out question as "Chưa trả lời" with the correct answer revealed.
5. Separately, build another exercise with **Distribute** mode and a known overall time limit; confirm the builder's live "~N giây/câu" preview matches `timeLimitMinutes×60 ÷ question count`, and that the same value appears as the live per-question countdown during play.
6. Confirm an exercise left at the default **No limit** mode behaves exactly as before this feature — no per-question badge, only the overall timer.

**Expected**: a per-question timeout only ever ends that one question, never the whole attempt by itself (SC-016); the overall deadline remains the sole *other* thing that can end the whole attempt as Time Up; running out of lives (including a per-question-timeout-caused loss) ends it as Try Again instead.

## 7c. One-time exercises and configurable lives (FR-015, FR-032, FR-080–081)

1. Build an exercise with lives set to 3, assign it, and play it as a child, deliberately answering wrong 3 times in a row.
2. Confirm the attempt ends as Try Again with exactly 3 hearts shown depleted (not a hardcoded 5), and confirm the result breakdown (FR-079) is present.
3. Return to the child's home screen — confirm the Start button is replaced by an "Đã hoàn thành — Xem kết quả" state showing that same score/accuracy, and confirm clicking it reopens the identical past result rather than starting a new attempt.
4. Separately, build a second exercise with lives set to Unlimited, assign it, and answer most questions wrong on purpose — confirm the attempt never ends early no matter how many wrong answers are given, only completing once every question is answered (or the overall time limit passes), and confirm the header shows an "∞" marker instead of a heart count.
5. On the child's home screen, note the "Tổng điểm" stat before and after playing an exercise with at least one correct answer — confirm it increases by exactly the points earned (FR-080).

**Expected**: a finished exercise can never be started again for that child, on any screen (FR-081); a configured life count other than 5 is respected end-to-end, including unlimited (FR-032).

## 8. Parent dashboard and learning needs (User Story 3)

1. After several attempts (including some incorrect answers repeated on the same QuizItem ≥2 times), open that child's dashboard.
2. Confirm summary metrics, an attempt detail view (every prompt/submitted/correct/outcome/response time), and a "weak areas" list containing the repeatedly-missed item.
3. Build a new practice exercise directly from the weak-area selection.

**Expected**: matches FR-046–048 exactly; end-condition labels (completed/time expired/lives lost/abandoned) are visually distinguished.

## 9. Backup export/import and reset (User Story 6)

1. Export a backup from a populated installation.
2. On a separate/reset installation, import it and confirm quiz bank, exercises, profiles, and progress match (SC-011), per `contracts/backup-format.md`.
3. On the original installation, run "reset all data": confirm it requires parent login, a warning, and a second confirmation (FR-053) before anything is cleared.

## 10. Google Sheets sync scenarios (User Story 7 — optional, only if sync is implemented in this pass)

1. Connect a Google account from Parent Settings on Device A; create the spreadsheet; enable Automatic Sync.
2. Make a local-only change (e.g., add a QuizItem) — trigger sync — confirm it uploads and versions equalize (spec scenario "Local-only update sync").
3. On Device B (same spreadsheet, previously synced), trigger sync with no local changes — confirm the Device-A change downloads (scenario "Google-only update sync").
4. Change the same record independently on both devices before either syncs, then sync both — confirm neither copy is overwritten, automatic sync pauses on both, and the conflict appears in Review Conflicts (scenario "Version conflict"). Resolve it (Use Local / Use Google / Keep Both) and confirm `resolvedVersion = max(local, google) + 1`.
5. Trigger sync from both devices at effectively the same moment (e.g., two Playwright browser contexts posting concurrently in a test) — confirm exactly one receives `SYNC_SUCCESS` and the other `SYNC_BUSY` with its changes still pending (FR-058, SC-008).
6. Retry a request with a `syncId` that already committed — confirm the identical committed result is returned with no duplicate application (FR-059, SC-010).

**Expected**: all six sub-scenarios match `contracts/sync-api.md`'s documented server algorithm exactly.

## 11. Point redemption (User Story 8, FR-085–087)

1. With a child who has earned points from at least one completed attempt, as the parent open "Đổi điểm thưởng" from the sidebar nav.
2. Without touching the child selector, confirm it already shows a specific child's real current balance (default-selects the first child — this is the same empty-`<select>`-signal class of bug fixed in step 5/T133, applied here too).
3. Enter a points amount greater than that child's current balance and submit — confirm it's refused with a message stating the current balance, and that nothing changes.
4. Enter a valid amount (at or below the balance) plus a note describing what was traded, and submit — confirm a success message, the balance drops by exactly that amount, and a new entry (amount, note, date) appears at the top of the redemption history below.
5. Log in as that same child — confirm their home screen's "Tổng điểm" reflects the same reduced balance the parent just saw.

**Expected**: the balance shown is always `sum(earned) − sum(redeemed)`, computed fresh, never a directly-edited number (FR-087); an over-balance redemption is refused client-side with no record created (FR-086).

## 12. Named difficulty, default-category import fallback, and the Quiz Bank tree (FR-017, FR-019, FR-022, FR-026, FR-088, SC-024–025)

1. Open the Quiz Bank from the parent nav — confirm it now shows a collapsible tree (Subject → Grade → Category → quiz items) rather than a flat table, with an empty detail panel on the right until something is selected.
2. Click any leaf quiz item — confirm the detail panel loads it (prompt, choices/answer, etc.) and that its difficulty `<select>` shows exactly 5 named options (Dễ/Trung bình/Khó/Rất khó/Chuyên gia) with the item's actual level pre-selected.
3. Click "Thêm câu hỏi" and save a brand-new item without touching the difficulty field — confirm it defaults to "Trung bình" and appears correctly nested in the tree under its subject/grade/category immediately, with no page reload.
4. From the Categories screen, create a new category; back in the Quiz Bank, select an existing item, change its category to the new one in the detail panel, and press the panel's own Save button — confirm the item now appears only under the new category's branch of the tree (SC-025), and that a sibling item left in the old category stays there.
5. Prepare a small package per `contracts/quiz-package-format.md` where at least one item omits `category` entirely — import it and confirm the preview's "Danh mục mới" count shows it proposing a default category ("Khác") rather than erroring, and that after committing, the item is visible in the tree under Khác rather than missing (SC-024). Import a second such item in the same file and confirm the proposed-category list still shows one "Khác" row with a count of 2, not two separate rows.

**Expected**: difficulty is always one of the 5 named levels end-to-end, defaulting to Trung bình; no package item is ever silently dropped for lacking a category; editing a quiz's category through the tree's detail panel is reflected in the tree the moment Save is pressed.

## 13. Quiz Bank tree bulk actions (FR-089, SC-027)

1. In the Quiz Bank tree, pick a category node that has at least 2 quiz items and note its exact item list.
2. Click that node's bulk grade-change button, pick a different grade, and confirm — confirm every item that was under that node now appears under the new grade branch instead, immediately, with no page reload, and that a sibling category node elsewhere in the tree is completely unaffected.
3. Click that same (now-moved) node's bulk-delete button — confirm an inline "Xóa toàn bộ N câu hỏi…?" confirmation appears first (nothing happens yet) — then confirm it, and confirm every item that was under that node is now gone from the tree, while every other node is unaffected.

**Expected**: both bulk actions apply to exactly the items visibly grouped under the clicked node (that category within that one grade) and nothing else; the bulk-delete action requires an explicit second confirmation before it takes effect.

## 14. Exercise builder bulk random-add by category (FR-082, FR-090, SC-028)

1. Build a new exercise (or open an existing one) and open the question browser ("+ Thêm câu hỏi").
2. Without clicking any individual question, confirm the detail panel already shows the bulk random-add form (difficulty select, question count, points, and — only if the exercise's timing mode is Custom — a per-question time field) rather than an empty placeholder.
3. Pick a category with several matching items at one difficulty level, choose that difficulty, set a count smaller than how many are available, and click "Thêm ngẫu nhiên" — confirm that many distinct items appear in the "Đã thêm" list on the right, the running totals update, and the message states how many were added.
4. Click "Thêm ngẫu nhiên" again with the same settings — confirm the live pool count shown under the fields has already shrunk to reflect the first draw, and that this second draw only adds items the first one didn't (no duplicates ever appear in "Đã thêm").
5. Set the count higher than the number of items still remaining and submit — confirm exactly the remaining items are added (not more, not zero) and the message explicitly says fewer were added than requested.
6. Submit once more with the pool now empty — confirm the button is disabled rather than doing nothing silently.

**Expected**: the pool count shown in the form always reflects items not yet in the exercise (this requires the pool to be recomputed as a plain method, not a `computed()` signal, since it depends on the plain `existingItems` input — see Phase 22's checkpoint for the reactivity bug this step is designed to catch); a bulk draw never introduces a duplicate quiz item into the exercise; requesting more than are available never fails outright, it just adds what it can and says so.

## 15. Daily exercises (FR-091, SC-029)

1. Build a new exercise and check "Bài tập hàng ngày" — confirm the raw "+ Thêm nhóm ngẫu nhiên" button disappears and, opening the question browser, every individual quiz row is disabled/unclickable (clicking one leaves the slot-add form showing, never opens a specific item's detail).
2. Pick a category, set a difficulty/count/points (and time, if Custom timing mode), and click "Thêm mục ngẫu nhiên" — confirm a new entry appears in the "added" list showing the category, difficulty, points/question, and time, not a specific question prompt. Add a second slot with different settings — confirm both are listed, and the builder's own item list below shows the same enriched summary for each.
3. Save, assign the exercise to a child, and play it as that child — confirm every question shown across both slots is distinct (no repeats), even though they came from separately-added random slots.
4. Back on the child's home screen, confirm it now shows "Đã hoàn thành … quay lại vào ngày mai" and a "Hàng ngày" badge, with the Start button replaced by "Xem kết quả" — same as a normal one-time exercise's completed state.
5. Directly in IndexedDB (browser devtools, or the same technique used in this feature's own Playwright verification), set that attempt's `startedAt` back a few days and reload — confirm the child's home screen now shows the Start button again instead of "Xem kết quả", proving the block is scoped to "today" and not "ever."

**Expected**: a daily exercise's content is never a specific pre-chosen quiz, only category/difficulty/count/time/points slots; a child can play it again once a new calendar day begins, each time with an independently freshly-randomized, duplicate-free question set.

## 16. Difficulty "All" option, legacy-difficulty default, and the passage per-question override fix (FR-017, FR-083, FR-090, SC-030–031)

1. In the exercise builder's question browser (either the normal bulk-add form or a daily exercise's slot form), open the difficulty `<select>` — confirm "Tất cả độ khó" appears as the first option, above the 5 named levels, and that leaving it selected draws from any difficulty rather than narrowing the pool.
2. Using your browser's devtools, add a quiz item directly to the `quizItems` IndexedDB store with no `difficulty` field at all (simulating data from before this field existed). Reload the Quiz Bank — confirm it displays with a "Trung bình" badge, same as any item explicitly set to that level.
3. Back in the exercise builder's picker, select that item's category — confirm it's included in the pool when "Tất cả độ khó" or "Trung bình" is selected, and excluded when any other specific level is selected.
4. Author a passage/multi-question item with 2+ sub-questions. In the exercise builder (with Custom per-question timing mode on, so the time field is visible), add only the *first* sub-question through the picker's single-item flow, setting a specific time and points override before confirming — confirm every sub-question that got pulled in alongside it (not just the one clicked) shows that identical override in the "added" panel.

**Expected**: "Tất cả độ khó" behaves as a true wildcard, matching every difficulty at once; a legacy item with no stored difficulty is indistinguishable from one explicitly set to Trung bình, in both display and matching; a passage's per-question override from one click always covers every question that add pulled in, never just the one clicked.

## Success criteria checklist

Run through SC-001 through SC-031 in spec.md against the above scenarios; every one should have been exercised by at least one step here except purely load/scale criteria (SC-006), which requires a separate seeded-large-dataset performance pass rather than manual quickstart validation. SC-014 (responsive, dead-end-free parent navigation) is exercised by resizing the viewport to a common desktop width and to 390px while repeating step 5's parent flows and confirming no horizontal scrolling and no reliance on the browser back button. SC-015 (passage/multi-question all-or-nothing grouping) is exercised by step 6b. SC-016 (a per-question timeout never ends the whole attempt by itself) and SC-018 (every question shown exactly once, never skipped) are both exercised by step 7b together with the double-advance regression check called out in Phase 14's checkpoint. SC-017 (no-PIN child login) is exercised by step 3.1. SC-019 (unlimited lives never end early) and SC-020 (one-attempt-per-exercise) are exercised by step 7c. SC-021 (point redemption balance math) is exercised by step 11. SC-022 (file-driven grade/type, immediate usability) and SC-023 (loading states, collapsed passages, popup-then-reset) are exercised by step 6, with the legacy-data migration covered separately by step 6a. SC-024 (default-category import fallback) and SC-025 (live category-move in the Quiz Bank tree) are exercised by step 12. SC-026 (grade/delete edits never impact existing exercises/attempts) is exercised by the Phase 20/21 checkpoints' end-to-end Playwright pass, not a numbered quickstart step here. SC-027 (category-node bulk actions scoped correctly) is exercised by step 13. SC-028 (exercise builder bulk random-add never duplicates or over-adds) is exercised by step 14. SC-029 (daily exercises renew correctly and never contain a pre-chosen quiz) is exercised by step 15. SC-030 (legacy-difficulty default is consistent everywhere) and SC-031 (passage per-question override applies to every sibling) are exercised by step 16.
