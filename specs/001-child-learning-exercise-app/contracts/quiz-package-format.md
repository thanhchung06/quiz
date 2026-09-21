# Contract: AI Quiz Package Format (Import/Export)

Implements FR-025–030, FR-073–075. This is the versioned JSON format the app both documents (as a downloadable template for AI-assisted authoring) and consumes/produces via import/export.

## Authoring workflow (FR-025)

The Import screen offers only a downloadable template (this contract's worked examples) and a file picker — there is no in-app prompt generator (removed 2026-09-18; an earlier revision of this contract described one). The parent is expected to hand the downloaded template, or this contract itself, to an external AI tool (ChatGPT, Claude, Gemini, etc.) of their own choosing, save that tool's JSON output to a file, and import it through the same Import Preview flow described below.

When authoring a prompt for that external tool by hand, the same rules as the template apply, notably: `true-false` choices must be exactly `{"id":"true","text":"Đúng"}` / `{"id":"false","text":"Sai"}` — not because grading requires those exact ids (true-false is graded like any other choice item, by id membership in `correctAnswerIds`), but as a stable, unambiguous convention for AI-authored content.

## Envelope

```json
{
  "formatVersion": "1.1",
  "packageTitle": "string",
  "language": "vi",
  "quizzes": [ /* QuizPackageItem, see below */ ],
  "passages": [ /* QuizPackagePassage, see "Passages" below — optional */ ]
}
```

- `formatVersion` MUST be checked against the highest version this app build supports before any item is processed; an unsupported version fails the whole import with a clear message (no partial processing). Both `"1.0"` (no `passages`) and `"1.1"` (adds `passages`) are supported; a `"1.0"` package is valid input, just without any passage groups.
- `language` documents the content language for the package; the app itself only ships a Vietnamese interface (FR-068), but package content language is recorded for future-proofing.

## QuizPackageItem

```json
{
  "externalId": "string, optional — used for duplicate detection across re-imports",
  "subject": "math | language — required for a top-level quizzes[] entry; optional inside passages[].questions[], where it defaults to the passage's own subject",
  "grade": "1-5 — same optionality rule as subject",
  "category": {
    "externalKey": "string, optional",
    "name": "string",
    "subject": "math | language, optional — defaults to the item's own subject"
  },
  "tags": ["string"],
  "difficulty": 1,
  "type": "single-choice | short-text | number | multiple-choice | true-false | match-pairs",
  "prompt": "string",
  "choices": [ { "id": "string", "text": "string" } ],
  "correctAnswerIds": ["string"],
  "acceptedAnswer": "string, optional — for short-text/number types",
  "acceptedRange": { "min": 0, "max": 0, "optional": true },
  "shuffleChoices": true,
  "explanation": "string, optional",
  "points": 10
}
```

Field applicability by `type`:

| Type | Required fields beyond the common set |
|---|---|
| `single-choice` | `choices` (≥2), `correctAnswerIds` (exactly 1) |
| `multiple-choice` | `choices` (≥2), `correctAnswerIds` (≥1) |
| `true-false` | `choices` fixed to two boolean-labeled entries, `correctAnswerIds` (exactly 1) |
| `short-text` | `acceptedAnswer` (plus optional case/punctuation sensitivity flags) |
| `number` | `acceptedAnswer` or `acceptedRange` |
| `match-pairs` | `choices` represent pair members; `correctAnswerIds` encodes the pairing |

`correctAnswerIds` (and any pairing reference) always resolve by `choices[].id` — never by array position or a displayed letter, since choices may be shuffled at play time (FR-038, spec note under QB 04).

## Passages (FR-073–075)

A shared reading passage or problem statement with two or more linked sub-questions:

```json
{
  "externalKey": "string, optional",
  "subject": "math | language",
  "grade": 1,
  "category": { "externalKey": "string, optional", "name": "string", "subject": "math | language, optional" },
  "title": "string",
  "text": "string — the reading passage, or the full problem statement",
  "questions": [ /* QuizPackageItem[], ≥2 entries — subject/grade/category inherited from this passage if omitted */ ]
}
```

- Every field on a nested `questions[]` entry follows the same per-`type` rules as a top-level `QuizPackageItem` (see table above).
- A passage imports as **one atomic unit**: if any of its `questions` fails validation, the entire passage is reported invalid and skipped — never partially imported with some sub-questions missing (FR-074, SC-015). This is the one exception to FR-028's per-item independence.
- On commit, each sub-question becomes its own `QuizItem` sharing a freshly-generated `passageId`, with the passage's `title`/`text` copied onto every one of them (`order`/`total` set from position within `questions[]`) — see data-model.md §3.
- A passage's sub-questions are excluded from AI-import duplicate detection in this release (spec Assumptions) — only top-level `quizzes[]` entries are checked against the existing bank.

## Category resolution (FR-026)

1. Match by `category.externalKey` if present.
2. Else match by `(normalizedName, subject)` against existing categories.
3. Else propose a new category for parent approval in the import preview; a mismatched `category.subject` vs. the item's own `subject` is flagged, not silently coerced.

## Import preview output (FR-027)

The importer produces, before any write:

```json
{
  "totalItems": 0,
  "validItems": 0,
  "invalidItems": [ { "index": 0, "errors": ["string"] } ],
  "likelyDuplicates": [ { "index": 0, "matchesExistingId": "uuid", "reason": "externalId | normalizedPrompt" } ],
  "proposedCategories": [ { "externalKey": "string", "name": "string", "subject": "math", "possibleDuplicateOf": "uuid, optional" } ],
  "skipped": [],
  "passages": [
    { "index": 0, "title": "string", "questionCount": 0, "valid": true, "errors": [], "proposedCategory": { "name": "string", "subject": "math" } }
  ],
  "gradeTypeBreakdown": [ { "grade": 1, "type": "single-choice", "count": 0 } ]
}
```

`totalItems` counts every top-level `quizzes[]` entry plus every question across every `passages[]` entry. `passages` is reported separately from the flat item lists above — a passage is never partially represented in `invalidItems`/`validItems` (see "Passages" above). `gradeTypeBreakdown` (added 2026-09-18) groups every standalone quiz and every passage question by its own `grade`/`type` from the file — this is shown in place of listing every individual question; an item missing a grade is skipped here (it's already reflected in `invalidItems`).

The parent acts on this preview (map/approve categories, skip/replace duplicates, skip an invalid passage, cancel, or download the `invalidItems`/`passages` error report) before committing directly — there is no per-item selection list and no separate approval action (amended 2026-09-18; an earlier revision of this contract described a "select items" step here). Valid items save even when other items in the same package are invalid (FR-028); every saved item receives a shared `importBatchId` and `reviewStatus = "approved"` — always, immediately (amended 2026-09-18; an earlier revision defaulted this to `"needsReview"`).

## Export (FR-029)

Exporting selected `QuizItem` records re-serializes them into this same envelope/item shape (round-trippable), substituting each item's live `categoryId` back into a `category.externalKey`/`name` pair so the exported package can be re-imported into a different installation without carrying internal UUIDs as the only category reference. Selected items sharing a `passage.passageId` are grouped back into one `passages[]` entry (using that shared id as the entry's own `externalKey`) rather than exported as disconnected standalone `quizzes[]` items, so a passage group round-trips intact.
