
// Apps Script triggers require a literal top-level function, not a module export.
function doPost(e) { return QuizAppSync.doPost(e); }

/**
 * Click "Run" on THIS function (not doPost) to sanity-check your setup from
 * inside the editor. doPost can't be run directly — the editor calls it with
 * no arguments, since there's no real HTTP request behind a manual "Run".
 * This builds a minimal, valid request using your own Script Properties and
 * logs the result (View > Logs, or Ctrl+Enter) so you can confirm
 * SHARED_SECRET is set correctly, and that this script is properly bound to
 * its spreadsheet (getActiveSpreadsheet resolves), before deploying.
 */
function testDoPost() {
  var secret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!secret) {
    Logger.log('Missing Script Property — set SHARED_SECRET first (Project Settings > Script Properties).');
    return;
  }

  var request = {
    syncId: 'test-' + new Date().getTime(),
    deviceId: 'apps-script-test-helper',
    sharedSecret: secret,
    startedAt: new Date().toISOString(),
    lastKnownDataRevision: 0,
    action: 'SYNC_NORMAL',
    changes: []
  };

  var fakeEvent = { postData: { contents: JSON.stringify(request) } };
  var result = doPost(fakeEvent);
  Logger.log(result.getContent());
}
