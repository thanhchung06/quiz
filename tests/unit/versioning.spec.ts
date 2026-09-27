import { decideVersion, adoptIdenticalVersion } from '../../apps-script/src/versioning';

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

describe('adoptIdenticalVersion', () => {
  it('adopts a Google copy identical to the upload (leftover of a failed sync)', () => {
    const body = JSON.stringify({ prompt: '2 + 3 = ?' });
    expect(adoptIdenticalVersion(1, 1, body, body)).toBe(1);
    expect(adoptIdenticalVersion(3, 1, body, body)).toBe(3);
    expect(adoptIdenticalVersion(1, 2, body, body)).toBe(2);
  });

  it('keeps a real conflict when the contents differ or Google has no copy', () => {
    expect(adoptIdenticalVersion(2, 2, JSON.stringify({ prompt: 'A' }), JSON.stringify({ prompt: 'B' }))).toBeUndefined();
    expect(adoptIdenticalVersion(1, 0, undefined, '{}')).toBeUndefined();
  });
});
