/**
 * @jest-environment node
 */
import 'fake-indexeddb/auto';
import { db } from '../../src/app/data/db';
import { DownloadApplierService } from '../../src/app/sync-engine/download-applier.service';
import { Category, Exercise, Profile, QuizItem } from '../../src/app/shared/models/domain.model';

const envelope = (id: string, extra: object = {}) => ({ id, localVersion: 1, lastGoogleVersion: 0, syncStatus: 'pendingUpload', updatedAt: '', updatedByDeviceId: 'phone', ...extra });

describe('DownloadApplierService', () => {
  const applier = new DownloadApplierService();
  beforeEach(async () => {
    await Promise.all([db.categories.clear(), db.quizItems.clear(), db.exercises.clear(), db.profiles.clear()]);
  });

  it("stores another device's record as synced, and skips one edited here but not uploaded yet", async () => {
    await db.quizItems.add(envelope('mine', { prompt: 'local edit', categoryId: 'c' }) as unknown as QuizItem);
    const n = await applier.apply([
      { entityType: 'QuizItem', entityId: 'new', version: 3, payload: { prompt: 'from PC', categoryId: 'c' } },
      { entityType: 'QuizItem', entityId: 'mine', version: 2, payload: { prompt: 'older PC copy', categoryId: 'c' } },
    ]);
    expect(n).toBe(1);
    expect(await db.quizItems.get('new')).toMatchObject({ prompt: 'from PC', syncStatus: 'synced', localVersion: 3, lastGoogleVersion: 3 });
    expect((await db.quizItems.get('mine'))?.prompt).toBe('local edit');
  });

  it("keeps this device's login code when a Profile comes down", async () => {
    await db.profiles.add(envelope('profile-parent', { role: 'parent', displayName: 'Phụ huynh', credentialHash: 'HASH', syncStatus: 'synced' }) as unknown as Profile);
    await applier.apply([{ entityType: 'Profile', entityId: 'profile-parent', version: 4, payload: { role: 'parent', displayName: 'Bố mẹ' } }]);
    expect(await db.profiles.get('profile-parent')).toMatchObject({ displayName: 'Bố mẹ', credentialHash: 'HASH' });
  });

  it('replaces a locally seeded duplicate category and moves its questions and exercise groups', async () => {
    await db.categories.add(envelope('default-math-phan-so', { name: 'Phân số', normalizedName: 'phân số', subject: 'math', status: 'active' }) as unknown as Category);
    await db.quizItems.add(envelope('q1', { prompt: '1/2 + 1/2', categoryId: 'default-math-phan-so', syncStatus: 'synced', lastGoogleVersion: 1 }) as unknown as QuizItem);
    await db.exercises.add(
      envelope('ex1', { items: [{ id: 'i', position: 0, kind: 'randomGroup', randomGroup: { categoryIds: ['default-math-phan-so'] } }] }) as unknown as Exercise,
    );

    await applier.apply([
      { entityType: 'Category', entityId: 'pc-uuid-phan-so', version: 1, payload: { name: 'Phân số', normalizedName: 'phân số', subject: 'math', status: 'active' } },
    ]);

    expect(await db.categories.get('default-math-phan-so')).toBeUndefined(); // never synced -> simply removed
    expect(await db.categories.get('pc-uuid-phan-so')).toMatchObject({ name: 'Phân số', syncStatus: 'synced' });
    expect(await db.quizItems.get('q1')).toMatchObject({ categoryId: 'pc-uuid-phan-so', syncStatus: 'pendingUpload', localVersion: 2 });
    const ex = (await db.exercises.get('ex1'))!;
    expect(ex.items[0].kind === 'randomGroup' && ex.items[0].randomGroup.categoryIds).toEqual(['pc-uuid-phan-so']);
  });
});
