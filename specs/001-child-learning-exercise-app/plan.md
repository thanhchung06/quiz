# Implementation Plan: Child Learning Exercise Application

**Branch**: `001-child-learning-exercise-app` | **Date**: 2026-09-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-child-learning-exercise-app/spec.md`

## Summary

An offline-first Angular Progressive Web App for two fixed child profiles and one parent profile to practice daily mathematics and Vietnamese-language exercises. IndexedDB is the sole operational database on every device; a parent-managed quiz bank and exercise builder produce daily assignments (with an automatic rotation fallback), scored attempts run entirely client-side with lives/timer/streak/reward mechanics, and a parent dashboard surfaces progress and weak areas. Optional, strictly-additive two-way synchronization to a parent-owned Google Sheet is driven by a Google Apps Script Web App that enforces an exclusive per-sync lock, version-only conflict detection, idempotent retries, and atomic change groups — with no custom application server anywhere in the system.

## Technical Context

**Language/Version**: TypeScript 5.x on Angular 19 (latest stable Angular major at plan time); Google Apps Script (V8 runtime, TypeScript source transpiled via `clasp`) for the optional sync endpoint.

**Primary Dependencies**: Angular (standalone components + Angular Router), `@angular/service-worker` for PWA installability/caching, Dexie.js as the IndexedDB access/versioning layer, RxJS + Angular signals for reactive state, Angular CDK (drag-and-drop for exercise item reordering, virtual scrolling for large quiz-bank/attempt lists), `ajv` for JSON Schema validation of quiz-package imports and backup files, Google Identity Services (OAuth) for the parent-only Google account connection, `SpreadsheetApp`/`LockService`/`PropertiesService` within Google Apps Script for the sync endpoint, `@material-symbols/svg-400` as a build-time-only source for the self-hosted icon set (FR-071) — SVGs are copied into `public/icons/` and served from the app's own origin, never loaded from a font/CDN service, so iconography stays available offline.

**Storage**: IndexedDB (via Dexie.js) as the sole operational, always-written-first store on each device. A parent-owned Google Sheet (accessed only through the Apps Script Web App, never directly) is the optional synchronized shared copy. Custom media (images/audio) is cached in browser storage and optionally mirrored to a parent-designated Google Drive folder, referenced by ID/checksum only.

**Testing**: Jest (Angular's native Jest builder) for unit and component tests; Playwright for end-to-end child/parent flow tests, including simulated offline/network-off runs and multi-context concurrent-sync tests; a small Apps Script test harness (clasp + a scripted test spreadsheet) for exclusive-lock and idempotent-retry verification.

**Target Platform**: Installable PWA on Windows desktop browsers (Chrome/Edge) and Android mobile browsers (Chrome); iOS/iPhone is explicitly out of scope for this release (FR-067).

**Project Type**: Web — single Angular frontend application with no custom backend server, plus an independent, minimal Google Apps Script project that serves only as the optional sync endpoint.

**Performance Goals**: Screen transitions and answer evaluation complete within 300ms on target devices (SC-005); child-facing interactions (question render, submit, feedback) must feel instantaneous with no visible loading spinners in the common path.

**Constraints**: Fully offline-capable for every function except optional synchronization (SC-003); no submitted answer may ever be lost across an unexpected close (SC-002, FR-050); only one device may commit a Google sync at a time (FR-058); no custom application server of any kind: results.

**Scale/Scope**: 3 fixed profiles (2 children + 1 parent); ~10 primary screens; 2 subjects (mathematics, Vietnamese language) across 5 grade levels; a quiz bank sized to at least 2,000 items and 10,000 stored answer results without noticeable slowdown (SC-006); single-household usage (no multi-tenant, no concurrent-user scaling concerns beyond the two-device sync race the spec already covers).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unpopulated template (placeholder principles only) — this project has not yet ratified a constitution. There are no governance principles to gate against, so this check is **not applicable** rather than passing or failing. No violations are possible, and no entries are recorded in Complexity Tracking as a result.

Recommendation (non-blocking): if the project later adopts a constitution (e.g., via `/speckit-constitution`), re-run this check against the concrete plan below — the areas most likely to interact with governance are the "no custom application server" constraint, the offline-first data model, and the test strategy (Jest/Playwright choice).

**Post-Phase-1 re-check**: research.md, data-model.md, contracts/, and quickstart.md introduced no new external services, no custom backend beyond the already-declared optional Apps Script sync endpoint, and no dependency the Technical Context didn't already name. Still not applicable — unchanged from the pre-Phase-0 assessment above.

## Project Structure

### Documentation (this feature)

```text
specs/001-child-learning-exercise-app/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── sync-api.md
│   ├── quiz-package-format.md
│   └── backup-format.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── core/                    # session/auth (avatar-only for a child, password for parent), route guards, app-wide services
│   │   ├── auth/
│   │   └── settings/
│   ├── data/                    # Dexie database definition, per-entity repositories, migrations
│   │   ├── db.ts                # Dexie schema (Profile, Category, QuizItem, Exercise, Assignment, Rotation,
│   │   │                        # Attempt, AnswerResult, Reward, PointRedemption, SyncTransaction, DeletedRecord, AppSettings)
│   │   └── repositories/
│   ├── features/
│   │   ├── child-play/          # US1: profile select, child home, exercise intro, question runner, results
│   │   ├── quiz-bank/           # US2/US4: categories, quiz item CRUD, AI package import/export
│   │   ├── exercise-builder/    # US2: builder (fixed + random groups, question-browser picker), schedule/rotation editor
│   │   ├── dashboard/           # US3: per-child overview, attempt detail, weak-area review
│   │   ├── rewards/             # US5/US8: streaks, stars, badges, avatar reactions, unlockables, point redemption
│   │   ├── backup/              # US6: export/import, reset-all-data flow
│   │   └── sync/                # US7: Google connect, storage-mode picker, manual sync controls, conflict review
│   ├── shared/                  # presentational UI components (incl. the parent-shell responsive navigation —
│   │                            # docked sidebar ≥900px, off-canvas drawer below it — and the self-hosted
│   │                            # IconComponent, FR-070/071), pipes, directives, i18n string table (Vietnamese)
│   └── sync-engine/             # client-side version comparison, batch builder, retry/backoff, conflict application
├── assets/
└── environments/

apps-script/                     # independent Google Apps Script project (deployed as a Web App)
├── src/
│   ├── main.ts                  # doPost entry point, request routing
│   ├── lock.ts                  # exclusive ScriptLock acquisition/release (SYNC 04)
│   ├── versioning.ts            # per-record version comparison, conflict batch rejection
│   ├── transactions.ts          # SyncTransaction commit/idempotent-retry handling (SYNC 05)
│   └── sheets/                  # per-tab read/write helpers (Profiles, Categories, QuizItems, ...)
├── appsscript.json
└── .clasp.json

tests/
├── unit/                        # Jest specs mirroring src/app (scoring, sync-engine version logic, validators)
├── integration/                 # Dexie-backed repository tests, import/export round-trip, attempt resume
└── e2e/                         # Playwright: child daily-exercise flow, parent builder flow, offline launch,
                                  # two-context concurrent-sync race, backup restore
```

**Structure Decision**: Single Angular PWA project (`src/app`) with no custom backend server, matching the spec's explicit "no custom application server" constraint. The only server-side code is the small, independently-deployed `apps-script/` project, which exists solely to implement the optional Google Sheets sync endpoint (exclusive lock, version check, idempotent commit) — it is not a general-purpose backend and has no routes beyond the sync contract in `contracts/sync-api.md`. This is a variant of the standard single-project layout rather than the frontend+backend web-application split, since there is intentionally no owned backend service beyond that thin, optional script.

## Complexity Tracking

> No constitution is ratified yet (see Constitution Check), so no violations are being justified here. This section is intentionally empty.
