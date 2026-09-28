import { Injectable } from '@angular/core';
import { PlaySession, SessionProgress } from '../../shared/models/domain.model';
import { RemoteStore, SERVER_TIME } from '../../remote/remote-store';
import { decode, encode, StoredNode } from '../../remote/record-codec';

interface StoredSession extends StoredNode {
  /** JSON of { sessionId, progress } — kept apart so each answer only sends the progress. */
  progress?: string;
}

/**
 * The exercise a child is doing now (sessions/{childId}, one per child). The
 * questions go up once, at start; after that only the progress. A progress
 * write that arrives late for a session that already ended (or was replaced)
 * carries the old session id and is ignored when read.
 */
@Injectable({ providedIn: 'root' })
export class PlaySessionRepository {
  constructor(private readonly remote: RemoteStore) {}

  async forChild(childId: string): Promise<PlaySession | undefined> {
    const node = await this.remote.get<StoredSession>(`sessions/${childId}`);
    const session = decode<PlaySession & { updatedAt?: string; progress?: unknown }>(node ? { json: node.json, updatedAt: node.updatedAt } : undefined);
    if (!session) return undefined;
    const { updatedAt: _u, ...rest } = session;
    const stored = node?.progress ? (JSON.parse(node.progress) as { sessionId: string; progress: SessionProgress }) : undefined;
    return { ...rest, progress: stored && stored.sessionId === session.id ? stored.progress : session.progress };
  }

  async start(session: PlaySession): Promise<void> {
    await this.remote.update({
      [`sessions/${session.childId}`]: encode(session, 'updatedAt', { progress: JSON.stringify({ sessionId: session.id, progress: session.progress }) }),
    });
  }

  /** On each answer, and every few seconds for the running clock. */
  async saveProgress(session: PlaySession, progress: SessionProgress): Promise<void> {
    await this.remote.update({
      [`sessions/${session.childId}/progress`]: JSON.stringify({ sessionId: session.id, progress }),
      [`sessions/${session.childId}/updatedAt`]: SERVER_TIME,
    });
  }
}
