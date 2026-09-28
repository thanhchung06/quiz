
// Apps Script triggers require a literal top-level function, not a module export.
function doPost(e) { return QuizAppSync.doPost(e); }

/**
 * Click "Run" on THIS function (not doPost) to sanity-check your setup from
 * inside the editor: it sends a PING with your own SHARED_SECRET and logs the
 * answer (View > Logs). Expect {"ok":true}. {"ok":false,"error":"SCHEMA_MISMATCH"}
 * means the sheet still holds the old layout — see resetSheetForNewLayout.
 */
function testDoPost() {
  var secret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!secret) {
    Logger.log('Missing Script Property — set SHARED_SECRET first (Project Settings > Script Properties).');
    return;
  }
  var request = { action: 'PING', deviceId: 'apps-script-test-helper', sharedSecret: secret };
  var result = doPost({ postData: { contents: JSON.stringify(request) } });
  Logger.log(result.getContent());
}

/**
 * ONE-TIME, DESTRUCTIVE: deletes every tab of this spreadsheet so the new
 * layout (schema version 2) starts empty, and clears the sync metadata kept
 * in Script Properties. Run it from the editor only after exporting your data
 * from the app (Sao lưu → Xuất). A sheet needs at least one tab, so an empty
 * "Metadata" tab is kept. Always wipe the sheet with this, never by hand: the
 * metadata would otherwise survive the wipe.
 */
function resetSheetForNewLayout() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var keep = spreadsheet.getSheetByName('Metadata') || spreadsheet.insertSheet('Metadata');
  spreadsheet.getSheets().forEach(function (sheet) {
    if (sheet.getSheetId() !== keep.getSheetId()) spreadsheet.deleteSheet(sheet);
  });
  keep.clear();
  // The sync metadata (counters, sync hash) lives in Script Properties: reset it with the sheet.
  PropertiesService.getScriptProperties().deleteProperty('SYNC_METADATA');
  Logger.log('Done: the sheet is empty and ready for the new layout.');
}
