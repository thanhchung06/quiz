# Phase 0 Research: Child Learning Exercise Application

All items below were determinable from the feature spec, its Assumptions, and established practice for offline-first Angular PWAs — none required user clarification beyond what `/speckit-clarify` already resolved (recorded in spec.md's Clarifications section).

## 1. IndexedDB access layer

- **Decision**: Use Dexie.js as the IndexedDB wrapper for all local persistence.
- **Rationale**: Dexie provides declarative schema versioning/migrations (needed as `AppSettings.schemaVersion` evolves across phases), a promise-based query API well suited to the repository pattern in `src/app/data/repositories/`, and compound-index support for the filters required by FR-019 (subject/grade/type/difficulty/tag) and FR-046 (per-child, per-period dashboard queries) without hand-rolled cursor code.
- **Alternatives considered**: Raw `idb` (lower-level, more boilerplate for versioned migrations and compound queries); `@ngrx/data` with an IndexedDB adapter (adds a large state-management dependency the single-user, offline-first scope doesn't need); localForage (key-value only, insufficient for the relational-ish queries FR-019/FR-046/FR-048 require).

## 2. Client-side state management

- **Decision**: Angular signals + injectable services per feature area; no global store library.
- **Rationale**: The app is single-user-at-a-time per device (one profile logged in) with no complex cross-feature shared mutable state beyond what Dexie already owns as the source of truth. Signals give fine-grained reactivity for the 300ms transition budget (SC-005) with far less boilerplate than NgRx, and avoid duplicating state Dexie already persists.
- **Alternatives considered**: NgRx (justified for large multi-team apps with complex cross-cutting state; unjustified complexity here per the spec's small, fixed-profile scope); plain RxJS `BehaviorSubject` services (viable, but signals are the more current Angular-idiomatic choice with equivalent capability for this scope).

## 3. Offline installability and caching

- **Decision**: `@angular/service-worker` with the default `ngsw-config.json` app-shell + asset-group caching strategy; an explicit "offline ready" flag is set only after the service worker reports `SwUpdate`/registration success and all `dataGroups` for required media have completed their first fetch.
- **Rationale**: This is the standard, well-supported Angular mechanism for PWA installability and satisfies FR-051 and SC-003 directly. It requires no custom service-worker code for the base app-shell caching.
- **Alternatives considered**: Hand-written service worker (more control, unnecessary risk/maintenance for a well-covered standard case); Workbox directly (more power than needed since the app has no complex runtime-caching strategies beyond app-shell + a media cache group).

## 4. Deterministic random selection and answer shuffling

- **Decision**: A seeded PRNG (mulberry32 or equivalent small deterministic generator) seeded once per attempt at start time; the seed itself is stored in the attempt snapshot (FR-036) so the exact random-group resolution and shuffle order (FR-038) can be recomputed or simply replayed from the stored snapshot on resume.
- **Rationale**: `Math.random()` cannot be replayed deterministically, which would break "preserve the same selection when an interrupted attempt resumes" (FR-036) and the stored-seed requirement explicitly listed in the spec. A small seeded PRNG is dependency-free and trivially unit-testable.
- **Alternatives considered**: Storing only the *resolved* item list/order without a seed (simpler, but the spec explicitly calls out storing the random seed itself, implying the design should support recomputation/audit, not just the outcome).

## 5. Quiz-package and backup JSON validation

- **Decision**: `ajv` (JSON Schema validator) compiled against a hand-authored JSON Schema for the quiz-package format (FR-025–028) and for the full local backup format (FR-052), run entirely client-side.
- **Rationale**: `ajv` is small, fast, dependency-light, and gives structured, field-level error output that maps directly to the "download an error report" requirement (FR-027) without hand-writing a validator for every nested rule (choice IDs, correct-answer-ID references, category resolution shape).
- **Alternatives considered**: Hand-written validation functions (harder to keep in sync with the documented template from FR-025, more error-prone for nested array/ID-reference rules); Zod (good DX, but adds a second validation paradigm alongside the sync/versioning code which is plain TypeScript — `ajv` keeps validation declarative and schema-first, matching the "downloadable JSON template" deliverable itself).

## 6. Google Sheets sync endpoint

- **Decision**: A single Google Apps Script project deployed as a Web App (`doPost` only), using `LockService.getScriptLock()` for SYNC 04's exclusivity, `PropertiesService` (or a dedicated `SyncTransactions` sheet) to persist committed `syncId`s for SYNC 05's idempotent retry, and one spreadsheet tab per entity as enumerated in the spec's implied schema (Profiles, Categories, QuizItems, QuizChoices, Exercises, ExerciseItems, Assignments, Attempts, AnswerResults, Rewards, ChangeLog, DeletedRecords, SyncTransactions, Metadata).
- **Rationale**: This is the only architecture consistent with "no custom application server" while still providing an exclusive, atomic, idempotent commit boundary — Apps Script's `LockService` and its single-threaded-per-lock execution model directly implement FR-058/FR-059/FR-060 without any server infrastructure to operate.
- **Alternatives considered**: A lightweight external serverless function (e.g., Cloud Functions) fronting the Sheet (rejected — the spec explicitly excludes a custom application server, and Apps Script alone is sufficient and zero-infrastructure); direct Sheets API calls from the Angular client without Apps Script (rejected — cannot provide a single exclusive lock across devices, since two clients could both pass a read-then-write race with no server-side arbitration).

## 7. Authentication to Google

- **Decision**: Google Identity Services (GIS) OAuth token flow, initiated only from Parent Settings (FR-054), requesting the minimal scope needed for Sheets + optional Drive folder access; the obtained token stays in memory/local device storage only (never synchronized, per FR-066).
- **Rationale**: GIS is Google's current supported client-side OAuth mechanism for web apps and integrates cleanly with a static Angular PWA with no backend to hold a client secret.
- **Alternatives considered**: A backend-mediated OAuth flow (rejected — requires a server, which is explicitly out of scope).

## 8. Testing strategy

- **Decision**: Jest for unit/component tests (via Angular's supported Jest builder); Playwright for end-to-end flows, run against a Chromium context with network conditions toggled (via Playwright's `context.setOffline(true)`) to validate SC-003's offline launch scenario, and against two parallel browser contexts to validate the concurrent-sync race (FR-058, SC-008).
- **Rationale**: Playwright's built-in offline/network emulation and multi-context support map directly onto the spec's most distinctive acceptance scenarios (offline launch, concurrent sync) without external test infrastructure. Jest is faster than Karma/Jasmine for the large number of pure-logic unit tests this domain requires (scoring, versioning, PRNG, validators).
- **Alternatives considered**: Karma/Jasmine (Angular's historical default; still viable, but slower and with weaker built-in parallelism for a test suite this large); Cypress (strong DX, but Playwright's native multi-context/offline APIs are a better fit for this feature's specific concurrency and offline scenarios).

## 9. Vietnamese-only interface

- **Decision**: A single centralized string table (`src/app/shared/i18n/vi.ts`) consumed directly by components, rather than Angular's full `$localize`/XLIFF i18n build pipeline.
- **Rationale**: FR-068 requires exactly one interface language for this release with no runtime language switching in scope; a full multi-locale build pipeline (separate compiled bundles per locale) would add build complexity with no corresponding requirement. A centralized string table still keeps all user-facing text out of component templates for future localization if ever needed.
- **Alternatives considered**: Angular's built-in `i18n` attribute + XLIFF extraction (the standard choice when multiple shipped locales are required; unjustified overhead for a single confirmed interface language).

## 10. Read-aloud audio (FR-045)

- **Decision**: Prefer parent-recorded audio (already a supported media type on quiz items) when present; fall back to the Web Speech API's `SpeechSynthesis` with a Vietnamese voice when the device/browser supports it, and silently omit read-aloud when neither is available.
- **Rationale**: Matches the spec's own phrasing ("play parent recorded audio or device speech when supported") and keeps the feature purely additive — its absence never blocks a question from being answered.
- **Alternatives considered**: A bundled third-party TTS engine (rejected — adds bundle size and an offline-model-download problem for a "Medium priority" feature the spec explicitly allows to degrade gracefully).
