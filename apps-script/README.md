# Apps Script sync endpoint

Implements `contracts/sync-api.md`. This script must be **container-bound**
to exactly one spreadsheet (created from inside that Sheet's own menu, not
as a standalone script at script.google.com) and uses
`SpreadsheetApp.getActiveSpreadsheet()` rather than `openById(someId)`.

This matters for the OAuth consent prompt you'll see when authorizing it:
`openById` can open *any* spreadsheet the account can reach, so Google would
require the broad "see, edit, create, and delete all your Google Sheets
spreadsheets" scope. A bound script that never calls `openById` can instead
request the much narrower `spreadsheets.currentonly` scope — Google's own
consent screen will read "only this spreadsheet," and the script is
structurally unable to touch any other sheet, no matter what a request
claims. On top of that, every request must also carry a shared secret
(Apps Script has no clean way to verify an arbitrary OAuth bearer token, so
this is the caller-auth layer instead).

## Deploy (no local tools needed)

1. Rebuild the paste-able bundle whenever `src/` changes: `./apps-script/build.sh` (from the repo root). This writes `apps-script/dist/Code.gs.js`.
2. Create (or open) the Google Sheet you want to sync to.
3. From **inside that Sheet**: **Extensions → Apps Script**. This creates a script *bound* to this specific spreadsheet — do not create a standalone project at script.google.com instead.
4. Delete the default `Code.gs` content and paste in the entire contents of `apps-script/dist/Code.gs.js`.
5. Narrow the OAuth scope explicitly (don't rely on auto-detection): **Project Settings** (gear icon) → check **"Show `appsscript.json` manifest file in editor"**. Open `appsscript.json` from the file list and set:
   ```json
   {
     "timeZone": "Asia/Ho_Chi_Minh",
     "dependencies": {},
     "exceptionLogging": "STACKDRIVER",
     "runtimeVersion": "V8",
     "oauthScopes": ["https://www.googleapis.com/auth/spreadsheets.currentonly"],
     "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE" }
   }
   ```
6. **Project Settings** → **Script Properties** → add `SHARED_SECRET` with a long random value (e.g. generate one with `openssl rand -hex 24`). Every sync request must send this exact value.
7. Select **`testDoPost`** in the function dropdown (top toolbar) and click **Run**. Approve the authorization prompt — it should now say it only wants access to *this* spreadsheet, not all of them. Check **View → Logs** for `{"ok":true}`. `"SCHEMA_MISMATCH"` means the sheet still holds the old layout: export your data from the app first, then run **`resetSheetForNewLayout`** once (it deletes every tab).
8. **Deploy → New deployment** → type **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone** — this only controls who can *reach* the URL at all; every request is still rejected immediately unless it carries the matching `SHARED_SECRET`, and even then the script can only ever touch the one sheet it's bound to.
9. Copy the deployment URL (ends in `/exec`) — this is the "Web App URL" the app's Sync screen needs.

## Layout

- `main.ts` — `doPost`: shared-secret and schema-version check, then WRITE (operations applied under the script lock, all idempotent by record UUID) or READ (no lock). Contract: `specs/002-sync-data-redesign/plan.md` §4 and `src/app/sync/protocol.ts` (shared with the app).
- `lock.ts` — exclusive `LockService` wrapper.
- `sheets/generic-table.ts` — row storage shared by every tab: [key, number, JSON body split over cells].
- `sheets/metadata.ts` — schema version, updateSequence counters, next Result id.
- `test-helper.gs.js` — `testDoPost` (PING) and `resetSheetForNewLayout` (one-time wipe) for the editor.
- `dist/Code.gs.js` — generated; the single file you paste into the Apps Script editor. Do not hand-edit; re-run `build.sh`.
