import { Injectable } from '@angular/core';
import { db } from '../db';
import { enqueue } from '../outbox';
import { PlaySession, SessionProgress } from '../../shared/models/domain.model';
import { JsonRecord } from '../../sync/protocol';

/**
 * The exercise a child is doing now (plan §3.3), one per child. The question
 * snapshot goes to Google once, at start; after that only progress.
 */
@Injectable({ providedIn: 'root' })
export class PlaySessionRepository {
  async forChild(childId: string): Promise<PlaySession | undefined> {
    return db.sessions.get(childId);
  }

  async start(session: PlaySession): Promise<void> {
    await db.sessions.put(session);
    await enqueue({ op: 'START_SESSION', childId: session.childId, session: session as unknown as JsonRecord });
  }

  /** Saves progress locally; `upload` also sends it (on each answer — the running clock is only saved locally). */
  async saveProgress(session: PlaySession, progress: SessionProgress, upload: boolean): Promise<void> {
    await db.sessions.update(session.childId, { progress });
    if (upload) await enqueue({ op: 'UPDATE_PROGRESS', childId: session.childId, sessionId: session.id, progress: progress as unknown as Record<string, unknown> });
  }

  /** Local removal only — on Google the finish request ends it (see ResultRepository.recordFinish). */
  async clearLocal(childId: string): Promise<void> {
    await db.sessions.delete(childId);
  }
}
