# Luyện Tập Mỗi Ngày — Child Learning Exercise App

Offline-first Angular PWA for two children and one parent to practice daily
mathematics and Vietnamese-language exercises. See `specs/001-child-learning-exercise-app/`
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
npm test            # Jest unit/component tests
npm run e2e          # Playwright end-to-end tests (starts the dev server automatically)
```

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
