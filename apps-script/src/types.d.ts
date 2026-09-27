/**
 * Minimal ambient declarations for the Google Apps Script globals used in
 * this project, so this folder type-checks standalone without pulling in
 * the full @types/google-apps-script package. Not a complete API surface —
 * only what lock.ts/transactions.ts/sheets/*.ts/main.ts actually call.
 */
declare const LockService: {
  getScriptLock(): {
    tryLock(timeoutMs: number): boolean;
    releaseLock(): void;
  };
};

declare const SpreadsheetApp: {
  getActiveSpreadsheet(): GoogleSpreadsheet;
  openById(id: string): GoogleSpreadsheet;
};

interface GoogleSpreadsheet {
  getSheetByName(name: string): GoogleSheet | null;
  insertSheet(name: string): GoogleSheet;
}

interface GoogleSheet {
  getDataRange(): GoogleRange;
  getLastRow(): number;
  getLastColumn(): number;
  getRange(row: number, col: number, numRows?: number, numCols?: number): GoogleRange;
  appendRow(values: unknown[]): void;
}

interface GoogleRange {
  getValues(): unknown[][];
  setValues(values: unknown[][]): void;
}

declare const PropertiesService: {
  getScriptProperties(): {
    getProperty(key: string): string | null;
    setProperty(key: string, value: string): void;
  };
};

declare const ContentService: {
  createTextOutput(content: string): { setMimeType(type: unknown): unknown };
  MimeType: { JSON: unknown };
};

interface GoogleAppsScriptDoPostEvent {
  postData: { contents: string };
}
