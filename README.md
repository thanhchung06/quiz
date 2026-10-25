# Luyện Tập Mỗi Ngày — Child Learning Exercise App

Offline-first Angular PWA for two children and one parent to practice daily
mathematics, Vietnamese-language and English exercises. See `specs/001-child-learning-exercise-app/`
for the full spec, plan, data model, contracts, and task list this codebase implements.

## Local development

```bash
npm install
npm start          # ng serve, http://localhost:4200
```

On first launch the app seeds three fixed profiles (Nam / Vũ / Parent) and a
small set of dev/test quiz content (`src/app/data/seed-dev-data.ts`) so every
user story can be exercised immediately. Names and credentials are hard
coded in `src/app/data/seed.ts` (real family values, not placeholders):

- **Nam's PIN**: `19062016` (has a dated assignment for today)
- **Vũ's PIN**: `02042018` (has no dated assignment — exercises the rotation fallback, FR-069)
- **Parent password**: `chungmo200287`

These can still be changed from Settings after logging in (FR-006), but
`seed.ts` is the source of truth for a fresh install.

## Testing

```bash
npm test             # Sanity suite: fast Jest unit/component/integration tests (the default)
npm run test:firebase # Firebase data-layer flow tests (slow, ~1 min) — see below
npm run test:perf    # Quiz-bank list load performance test (very slow, ~3 min) — see below
npm run test:all     # sanity + firebase + perf
npm run e2e          # Playwright end-to-end tests (starts the dev server automatically)
```

### Which tests to run

| Situation | Run |
|---|---|
| Normal fix or feature | `npm test` only (sanity suite) |
| Change touching the Firebase integration — remote store, record codec, sync services (`src/app/remote/`), repositories' remote reads/writes, results/points/backup flows | `npm test` **and** `npm run test:firebase` |
| Investigating a performance problem (e.g. slow quiz bank list with a large bank) | `npm run test:perf` on demand |

- `tests/unit`, `tests/integration` and `src/**/*.spec.ts` are the sanity suite.
- `tests/firebase/firebase-flow.spec.ts` exercises the online-first data layer against an in-memory
  Firebase layout. It is excluded from `npm test` because it takes about a minute, so it must be run
  explicitly whenever the Firebase integration is changed.
- `tests/perf/quiz-bank-list-load.spec.ts` seeds 30,000 questions / 1,500 categories into fake-indexeddb
  and times the quiz bank screen. It takes minutes and is never part of the normal run; run it only
  when you need to investigate or compare performance. Its time ceilings are loose by design — read the
  printed timings rather than relying on pass/fail.

## Production build

```bash
npm run build        # outputs to dist/quiz-app, includes the service worker (ngsw-config.json)
```

Serve the `dist/quiz-app/browser` output with any static file server to test
the installed/offline experience (SC-003) — the app must keep working with
that server turned off after the first successful load.

## Optional Google Sheets sync

Sync is entirely optional and additive (User Story 7). To enable it:

1. Deploy the Apps Script project in `apps-script/` as a Web App — see `apps-script/README.md`.
2. From the app's Parent Dashboard → Đồng bộ screen, enter the deployed Web App URL and the shared secret you set in Script Properties, then "Lưu cài đặt". (The Google Client ID / "Connect Google Account" button is optional — only needed for a future spreadsheet-picker convenience, not for syncing itself.)
3. Choose a storage mode (Local Only / Manual Sync / Automatic Sync).

Every other feature works fully without ever touching this section.

## Project layout

See `specs/001-child-learning-exercise-app/plan.md` ("Project Structure") for
the full source layout and the rationale for each directory.
