# Specification Quality Checklist: Child Learning Exercise Application

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-13
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- FR-067 (mobile platform scope) and FR-068 (interface/content language) were resolved with the user: Android-only mobile support (no iOS this release), and a Vietnamese interface with the language subject teaching Vietnamese as the children's native language.
- `/speckit-clarify` session (2026-09-13) resolved four further ambiguities: daily-exercise rotation fallback, exclusion of hints from this release, unrestricted grade assignment, and no formal accessibility requirement for v1. See spec.md's Clarifications section.
- All checklist items pass. Spec is ready for `/speckit-plan`.
- **2026-09-14 addendum**: FR-025 was extended and FR-070–072 plus SC-014 were added to document Phase 11's post-launch work (persistent parent navigation, offline-safe iconography, motion-with-a-non-motion-fallback, and the AI prompt generator) — see tasks.md Phase 11. Re-checked against all checklist items above; all still pass without edits.
- **2026-09-14 addendum 2**: FR-073–075 plus SC-015 were added for passage-based/multi-question items (a shared reading passage or problem statement with several linked sub-questions); FR-028/FR-029 were amended to carve out the passage-group exception to per-item import independence; US2/US4 each gained one acceptance scenario; Key Entities' Quiz Item entry was extended — see tasks.md Phase 12. Re-checked against all checklist items above; all still pass without edits.
- **2026-09-16 addendum**: FR-076–078 plus SC-016 were added for per-question timing modes (none/distribute/custom, always subordinate to the exercise's own overall time limit); Key Entities' Exercise and Attempt entries were extended — see tasks.md Phase 13. Re-checked against all checklist items above; all still pass without edits.
- **2026-09-18 addendum**: A large batch of post-launch changes, driven directly by the user across several sessions, was folded in — see spec.md's new "Session 2026-09-18" Clarifications entry, tasks.md Phases 14–17, and data-model.md §1/§4/§4a/§6/§7/§12:
  - **Amended** (previously-correct text that a behavior change made stale): FR-002/FR-003 (child login is avatar-only, no PIN), FR-012 (no in-play feedback panel, immediate advance), FR-015 (exercises are strictly one-attempt-per-child, replay removed entirely), FR-032 (lives configurable 3–10 or unlimited, was fixed at 5), FR-066 (no child PINs left to exclude from sync), FR-077/SC-016 (a per-question timeout now costs one life, was previously life-free).
  - **Added**: FR-079–081 (result breakdown, child point total, one-attempt enforcement), FR-082–084 (exercise builder's question-browser picker), FR-085–087 (point redemption), SC-017–021, and User Story 8 (P8, point redemption) with its own acceptance scenarios.
  - Two real bugs were found and fixed while building/testing this batch, not part of the original ask but documented in tasks.md Phase 14/15 since they affect FR-012/FR-077/FR-082 correctness: a double-question-advance race (Phase 14, T126) and a numeric `<select>` string-coercion bug that silently broke grade/difficulty filtering app-wide (Phase 15, T133).
  - Re-checked against all checklist items above; all still pass without edits. One known gap, not a checklist failure: the separately-deployed `apps-script/` sync backend was not updated for the new PointRedemption entity (cannot be tested/redeployed from this environment) — noted in tasks.md T140 and Assumptions is the right place for a future pass to pick this up if cross-device sync of redemption history is needed.
- **2026-09-18 addendum 2 (same day, separate change)**: Import was simplified further — see spec.md's "Session 2026-09-18" Clarifications (extended) and tasks.md Phase 18:
  - **Amended**: FR-025 (in-app AI-prompt generator removed entirely), FR-027 (per-item selection list and approval action replaced by a grade/type breakdown computed from each question's own file content), FR-028 (no Needs Review status/approval step at all — items are immediately usable; a start-up migration approves any item still carrying the old status), FR-030 (multi-item bulk-edit screen removed; undo-last-import moved onto the import screen itself, one-item editing remains via the ordinary quiz-bank editor).
  - **Added**: SC-022; User Story 4 gained one acceptance scenario (grade/type from file content, breakdown not a full list).
  - The "Duyệt câu hỏi" bulk-review screen, its route, and its nav entry were deleted outright (no longer reachable, nothing will ever populate it again).
  - Re-checked against all checklist items above; all still pass without edits.
- **2026-09-18 addendum 3 (same day, follow-on polish)**: Requested immediately after addendum 2 shipped — see spec.md's "Session 2026-09-18" Clarifications (extended further) and tasks.md Phase 19:
  - **Amended**: FR-027 further extended (passage list collapsed by default, loading states for file-read and commit, result popup with a full-screen-reset Close action).
  - **Added**: SC-023; User Story 4 gained one more acceptance scenario (loading/popup/reset behavior).
  - Re-checked against all checklist items above; all still pass without edits.
- **2026-09-18 addendum 4 (same day, quiz model + Quiz Bank tree redesign)**: Requested directly — see spec.md's "Session 2026-09-18" Clarifications (extended further) and tasks.md Phase 20:
  - **Amended**: FR-017 (difficulty becomes a named 5-level scale — Dễ/Trung bình/Khó/Rất khó/Chuyên gia — defaulting to Trung bình, was an unnamed 1–3 number), FR-019 (Quiz Bank screen redesigned into a Subject → Grade → Category tree with an edit detail panel, was a flat table), FR-022 (explicitly states every quiz item belongs to exactly one category, always), FR-026 (an item/passage with no `category` in its file now resolves to a default per-subject category ("Khác") through the normal lookup-or-propose path, instead of being left uncategorized and dropped at commit), FR-035 (random-group difficulty range spans the new 1–5 scale).
  - **Added**: FR-088 (Quiz Bank tree + detail-panel behavior, including that changing a category and saving moves the item in the tree immediately); SC-024–025.
  - A real bug was found and fixed while implementing this batch, not part of the original ask but documented in tasks.md Phase 20 (T152) since it affects FR-026 correctness: `PackageValidatorService` was only resolving a category for an item when the file actually specified one, so an item with no `category` field at all silently ended up with no `CategoryResolution`, which `ImportCommitService.commit()`'s `if (!categoryId) continue` then used to skip importing that item entirely, with no error shown to the parent — exactly the "if not have category, use default" case the user called out. Fixed by always resolving against a `DEFAULT_CATEGORY_NAME` fallback, reusing the existing lookup-or-propose logic unchanged. A second, self-identified (not user-reported) issue was fixed alongside it: since that fix means many uncategorized items now all propose the identical default category, `ImportPreviewService`'s `proposedCategories` list was deduped by `(subject, normalizedName)` with a count, instead of showing one repeated row per item.
  - Re-checked against all checklist items above; all still pass without edits.
- **2026-09-18 addendum 5 (same day, grade-change/delete confirmation)**: The parent asked directly whether the Quiz Bank tree also allows changing a quiz's grade and deleting a quiz, and asked for confirmation that neither impacts an already-built exercise since exercise content is snapshotted — see spec.md's amended FR-020/FR-088 and new SC-026:
  - No code changes were needed: both capabilities were already present from Phase 20's tree+detail-panel rebuild (the grade `<select>` in the embedded form, and the "Xóa" button in the detail toolbar calling the same `softDelete` path the old flat table used), and the snapshot-isolation guarantee was already true architecturally (fixed exercise items resolve a quiz item by id via `getById` — which is not filtered by `deletedAt` — at attempt-start, and every played attempt's question/answer breakdown reads only its own frozen `itemSnapshots`/`quizItemSnapshot`, never a live lookup).
  - **Amended**: FR-020 (now explicitly names grade/category changes and deletion as covered, not just "editing" in general) and FR-088 (now explicitly names grade-change-moves-the-tree-branch and delete as part of the detail panel, alongside the category-change behavior already documented).
  - **Added**: SC-026.
  - This addendum exists to make an already-true guarantee explicit and directly verified, not to record a new feature — re-verified end-to-end via Playwright against the real built app: played the seeded exercise to a completed attempt, then changed one of its used quiz items' grade (1→2, confirmed the tree moved it) and deleted a second used quiz item (confirmed it vanished from the tree), then confirmed both the exercise library's listing (still 3 questions) and the completed attempt's detail view (still showing all 3 original prompts, submitted answers, and correct answers, including the deleted item's) were completely unaffected.
  - Re-checked against all checklist items above; all still pass without edits.
- **2026-09-18 addendum 6 (same day, category-node bulk actions)**: Requested directly right after addendum 5 — see spec.md's "Session 2026-09-18" Clarifications (extended further), new FR-089, new SC-027, and tasks.md Phase 21:
  - **Added**: FR-089 (bulk grade-change and bulk delete, scoped to exactly the items grouped under one Subject/Grade/Category tree node); SC-027.
  - Implementation reuses the same per-item `QuizItemRepository.update()`/`softDelete()` calls the single-item paths already used (just applied to every item in the target node's `CategoryGroup`, in parallel via `Promise.all`), so FR-020's snapshot-safety guarantee and FR-074's passage-atomicity both carry over automatically with no new code — a passage's sub-questions can never be split by a bulk action because they always share one category and grade, so they're always either entirely inside or entirely outside the node being acted on.
  - Re-checked against all checklist items above; all still pass without edits.
- **2026-09-18 addendum 7 (same day, exercise builder bulk random-add)**: Requested directly right after addendum 6 — see spec.md's "Session 2026-09-18" Clarifications (extended further), new FR-090, amended FR-082/FR-084, new SC-028, and tasks.md Phase 22:
  - **Added**: FR-090 (bulk random-add by category/difficulty in the question browser's detail panel, with count/points/time overrides, excluding duplicates and passages); SC-028.
  - **Amended**: FR-082 (detail panel now shows the bulk form whenever no single item is selected, rather than a blank placeholder), FR-084 (running summary now also reflects bulk-added items).
  - A real bug was found and fixed while implementing this batch, not part of the original ask but documented in tasks.md Phase 22 since it directly affects FR-090/SC-028 correctness (the "never add a duplicate" requirement the user explicitly called out): the candidate pool (`bulkPool`) was first written as an Angular `computed()` signal, but it read `isAdded()`, which reads the component's plain (non-signal) `@Input() existingItems` — `computed()` only invalidates on tracked *signal* reads, so it never noticed when the exercise gained new items via a previous bulk-add and kept showing/offering already-added items as still available. Caught immediately by a Playwright test (the pool count didn't shrink from 8 to 4 after adding 4), before it could have produced a duplicate. Fixed by making `bulkPool` a plain method instead, matching the pattern already used by `isAdded()`/`totalPoints()`/`totalSeconds()` in the same component for exactly this reason.
  - Re-checked against all checklist items above; all still pass without edits.
- **2026-09-18 addendum 8 (same day, daily exercises)**: Requested directly right after addendum 7 — see spec.md's "Session 2026-09-18" Clarifications (extended further), new FR-091, amended FR-015/FR-032/FR-035/FR-081, new SC-029, and tasks.md Phase 23:
  - **Added**: FR-091 (`Exercise.isDaily`: content restricted to category/difficulty/count/time/points random-group slots, exempt from the one-attempt-forever rule in favor of one-attempt-per-local-calendar-day, multiple slots per exercise); SC-029.
  - **Amended**: FR-015/FR-081 (daily exercise is the one exception to "one-attempt-per-child-forever" — it's per-local-day instead), FR-032 (mentions the new daily toggle), FR-035 (a random group may now carry its own `pointsOverride`, mirroring the fixed-item points override, needed to express "3 điểm/câu" for a slot with no concrete items chosen yet).
  - This feature deliberately reuses the existing `randomGroup`/`RandomGroupConfig`/`AttemptResolverService` machinery end-to-end rather than introducing a parallel concept — a daily exercise's "slot" *is* an ordinary random group (with `difficultyMin === difficultyMax` for the single-level picker UX and the new `pointsOverride` field), and its fresh-per-day randomization and no-duplicate-across-slots-within-one-attempt guarantee were already provided for free by `resolveNew()`'s per-`start()` reseeding and shared `usedIds` tracking across every item/group in one resolve pass — the only genuinely new logic was `findCompletedAttemptToday()`'s local-date-scoped variant of the existing one-attempt check.
  - Re-checked against all checklist items above; all still pass without edits.
- **2026-09-18 addendum 9 (same day, difficulty "All" + legacy default + passage override bug)**: Requested directly right after addendum 8 — see spec.md's "Session 2026-09-18" Clarifications (extended further), amended FR-017/FR-083/FR-090, new SC-030–031, and tasks.md Phase 24:
  - **Amended**: FR-017 (the existing "defaults to 2/Trung bình wherever unset" language now genuinely covers every read site, not just creation/import — this addendum is the fix that makes that pre-existing FR text actually true), FR-090 (bulk-add/daily-slot difficulty picker gains an All option), FR-083 (a passage's per-question override now explicitly required to apply to every sibling question, not just the one clicked).
  - **Added**: SC-030 (legacy-difficulty default consistency), SC-031 (passage override applies to every sibling).
  - A real bug was found and fixed, not part of the literal ask but exactly what "apply time/point per question, not per quiz" was pointing at: `ExerciseBuilderComponent.onQuizPicked()` applied the picker's configured time/points override only to the one quiz item id in the click payload — when that item belonged to a multi-question passage (which always pulls in every sibling question as a block), the siblings silently got no override at all. Fixed by having `addFixedItem()` return every id it newly added (already computed internally, just not previously exposed) and looping the override application over all of them.
  - The "legacy item defaults to Trung bình" fix touches more call sites than any single FR number: `shared/difficulty.ts`'s `difficultyLabel()` (now accepts `undefined`), `QuizPickerComponent.bulkPool()`, `AttemptResolverService.resolveRandomGroup()`, `RandomGroupCheckService.checkSatisfiable()`, `QuizItemRepository.search()`'s difficulty filter, `QuizItemFormComponent.loadItem()`, and `PassageEditorComponent.rowFromItem()` — all now default a missing `difficulty` to 2 consistently, closing every remaining gap left over from difficulty only being defaulted at import time (Phase 20).
  - Re-checked against all checklist items above; all still pass without edits.
