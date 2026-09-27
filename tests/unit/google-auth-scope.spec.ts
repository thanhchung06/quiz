import { GOOGLE_OAUTH_SCOPE, GoogleAuthService } from '../../src/app/features/sync/services/google-auth.service';

describe('Google authorization scope', () => {
  it('asks only for per-file access (drive.file), never all Sheets or all Drive', async () => {
    let requested = '';
    (window as unknown as { google: unknown }).google = {
      accounts: {
        oauth2: {
          initTokenClient: (config: { scope: string; callback: (r: { access_token: string }) => void }) => {
            requested = config.scope;
            return { requestAccessToken: () => config.callback({ access_token: 't' }) };
          },
        },
      },
    };
    await new GoogleAuthService().connect('client-id');

    expect(requested).toBe(GOOGLE_OAUTH_SCOPE);
    expect(requested.split(' ')).toEqual(['https://www.googleapis.com/auth/drive.file']);
    expect(requested).not.toMatch(/auth\/spreadsheets(\s|$)|auth\/drive(\s|$)|drive\.readonly/);
  });
});
