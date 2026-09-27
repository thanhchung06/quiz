import { db } from '../data/db';

/** Who is logged in on this device — only their own data goes up to Google. */
export type Uploader = { role: 'parent'; profileId: string } | { role: 'child'; profileId: string };

/** Records a child creates while playing — only that child's login uploads them. */
export const CHILD_TYPES = ['Attempt', 'AnswerResult', 'Reward'];

/**
 * Records the parent manages. A parent's "Máy này → Google" makes Google match
 * the device exactly for these types (whatever the device lacks is deleted on
 * Google); child types and Profiles are never removed that way.
 */
export const PARENT_TYPES = ['Category', 'QuizItem', 'Exercise', 'Assignment', 'Rotation', 'PointRedemption'];

/** The bits of a record the upload decision needs (a SyncChange has them all). */
export interface UploadCandidate {
  entityType: string;
  entityId: string;
  lastGoogleVersion: number;
  payload: Record<string, unknown>;
}

/**
 * Which local records the logged-in person may upload:
 *
 * - A child: their own profile, attempts, answers (of their attempts),
 *   rewards, and their assignments/rotation (which play updates). Never
 *   questions, exercises or another child's data.
 * - The parent: questions, categories, exercises, assignments, rotations,
 *   point redemptions, parent profiles, and a child profile only when it is
 *   new (never on Google yet — otherwise no other device could ever see it).
 *   Never a child's results or rewards, nor edits to an existing child profile.
 * - Nobody logged in: nothing.
 */
export async function uploadPolicy(uploader: Uploader | undefined): Promise<(record: UploadCandidate) => boolean> {
  if (!uploader) return () => false;

  if (uploader.role === 'parent') {
    return (record) => {
      if (record.entityType === 'Profile') return record.payload['role'] !== 'child' || record.lastGoogleVersion === 0;
      return PARENT_TYPES.includes(record.entityType);
    };
  }

  const child = uploader.profileId;
  const attemptIds = new Set(await db.attempts.where('profileId').equals(child).primaryKeys());
  return (record) => {
    switch (record.entityType) {
      case 'Profile':
        return record.entityId === child;
      case 'Attempt':
      case 'Reward':
      case 'Assignment':
      case 'Rotation':
        return record.payload['profileId'] === child;
      case 'AnswerResult':
        return attemptIds.has(record.payload['attemptId'] as string);
      default:
        return false;
    }
  };
}
