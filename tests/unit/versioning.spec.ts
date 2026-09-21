import { decideVersion } from '../../apps-script/src/versioning';

describe('decideVersion (FR-057)', () => {
  it('is a no-op when neither side changed', () => {
    expect(decideVersion({ localVersion: 3, lastGoogleVersion: 3, googleVersion: 3 })).toBe('noop');
  });

  it('uploads when only local changed', () => {
    expect(decideVersion({ localVersion: 4, lastGoogleVersion: 3, googleVersion: 3 })).toBe('upload');
  });

  it('downloads when only Google changed', () => {
    expect(decideVersion({ localVersion: 3, lastGoogleVersion: 3, googleVersion: 5 })).toBe('download');
  });

  it('conflicts when both sides changed', () => {
    expect(decideVersion({ localVersion: 4, lastGoogleVersion: 3, googleVersion: 5 })).toBe('conflict');
  });

  it('is invalid when local is behind its last-known baseline', () => {
    expect(decideVersion({ localVersion: 2, lastGoogleVersion: 3, googleVersion: 3 })).toBe('invalid');
  });

  it('is invalid when Google has rolled back below the last-known baseline', () => {
    expect(decideVersion({ localVersion: 3, lastGoogleVersion: 3, googleVersion: 2 })).toBe('invalid');
  });
});
