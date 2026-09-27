import { Injectable, signal } from '@angular/core';

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string }) => void;
          }): { requestAccessToken(): void };
        };
      };
    };
  }
}

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
/**
 * The only Google permission the app ever asks for: `drive.file` — access to
 * files this app itself creates, or that the parent explicitly opens with it
 * (e.g. the quiz's sync spreadsheet), and nothing else in their Drive/Sheets.
 * Deliberately NOT `spreadsheets` (read/edit/delete *every* Google Sheet the
 * account owns) or any `drive` scope. The sync itself goes through the Apps
 * Script bound to one spreadsheet (`spreadsheets.currentonly`, see
 * apps-script/README.md), which needs no token from here at all.
 */
export const GOOGLE_OAUTH_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/**
 * Google account connection (FR-054): parent-initiated only, from Parent
 * Settings; children never see or need this. Uses Google Identity Services
 * since there is no backend to hold an OAuth client secret (research.md #7).
 * The access token is kept in memory only — never persisted, exported, or
 * synced (FR-066).
 */
@Injectable({ providedIn: 'root' })
export class GoogleAuthService {
  private readonly _connected = signal(false);
  private readonly _spreadsheetId = signal<string | undefined>(
    localStorage.getItem('quiz-app.spreadsheetId') ?? undefined,
  );
  private readonly _sharedSecret = signal<string | undefined>(
    localStorage.getItem('quiz-app.sharedSecret') ?? undefined,
  );
  private accessToken?: string;

  readonly connected = this._connected.asReadonly();
  readonly spreadsheetId = this._spreadsheetId.asReadonly();
  readonly sharedSecret = this._sharedSecret.asReadonly();

  private scriptLoadPromise?: Promise<void>;

  private loadGisScript(): Promise<void> {
    if (this.scriptLoadPromise) return this.scriptLoadPromise;
    this.scriptLoadPromise = new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = GIS_SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Google Identity Services script.'));
      document.head.appendChild(script);
    });
    return this.scriptLoadPromise;
  }

  async connect(clientId: string): Promise<void> {
    await this.loadGisScript();
    return new Promise((resolve, reject) => {
      const client = window.google!.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_OAUTH_SCOPE,
        callback: (response) => {
          if (response.error || !response.access_token) {
            reject(new Error(response.error ?? 'Google authorization failed.'));
            return;
          }
          this.accessToken = response.access_token;
          this._connected.set(true);
          resolve();
        },
      });
      client.requestAccessToken();
    });
  }

  setSpreadsheetId(id: string): void {
    this._spreadsheetId.set(id);
    localStorage.setItem('quiz-app.spreadsheetId', id);
  }

  /**
   * The Web App's own auth mechanism (main.ts, contracts/sync-api.md):
   * Apps Script can't cleanly verify an arbitrary OAuth bearer token, so a
   * shared secret set in the script's Script Properties is compared instead.
   * Never synced/exported, same as any other credential (FR-066).
   */
  setSharedSecret(secret: string): void {
    this._sharedSecret.set(secret);
    localStorage.setItem('quiz-app.sharedSecret', secret);
  }

  getAccessToken(): string | undefined {
    return this.accessToken;
  }

  disconnect(): void {
    // Disconnecting never deletes local data (FR-056); it only forgets the
    // in-memory token and stops treating the account as connected.
    this.accessToken = undefined;
    this._connected.set(false);
  }
}
