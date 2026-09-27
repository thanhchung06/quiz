/** Mirrors apps-script's request/response shapes exactly (contracts/sync-api.md). */

export type EntityTypeName =
  | 'Profile'
  | 'Category'
  | 'QuizItem'
  | 'Exercise'
  | 'Assignment'
  | 'Rotation'
  | 'Attempt'
  | 'AnswerResult'
  | 'Reward'
  | 'PointRedemption'
  | 'DeletedRecord';

export interface SyncChange {
  changeGroupId: string;
  entityType: EntityTypeName;
  entityId: string;
  localVersion: number;
  lastGoogleVersion: number;
  operation: 'upsert' | 'delete';
  payload: Record<string, unknown>;
}

export interface ConflictResolutionInput {
  entityType: EntityTypeName;
  entityId: string;
  resolution: 'useLocal' | 'useGoogle' | 'keepBoth';
  payload?: Record<string, unknown>;
}

export interface SyncRequestBody {
  syncId: string;
  deviceId: string;
  sharedSecret: string;
  startedAt: string;
  lastKnownDataRevision: number;
  action: 'SYNC_NORMAL' | 'REPLACE_GOOGLE_WITH_LOCAL' | 'REPLACE_PRUNE' | 'INDEX' | 'FETCH' | 'ROWS_AFTER' | 'REPLACE_LOCAL_WITH_GOOGLE' | 'RESOLVE_CONFLICT';
  changes: SyncChange[];
  conflictResolutions?: ConflictResolutionInput[];
  /** Ask for other devices' changes committed after this revision (paged, see SyncResponseBody.hasMore). */
  pullSince?: number;
  /** With pullSince: only these entity types. */
  pullTypes?: string[];
  /** REPLACE_PRUNE: every id this device has, per entity type; Google marks the rest of those types deleted. */
  keepIds?: Record<string, string[]>;
  /** INDEX: the entity types to list (id + version of every record). */
  indexTypes?: string[];
  /** FETCH: the records to send, by entity type. */
  fetchIds?: Record<string, string[]>;
  /** ROWS_AFTER: per entity type, the last sheet row this device has already read. */
  rowsAfter?: Record<string, number>;
}

export interface SyncConflict {
  entityType: EntityTypeName;
  entityId: string;
  localVersion: number;
  googleVersion: number;
  lastGoogleVersion: number;
}

export interface SyncDownload {
  entityType: EntityTypeName;
  entityId: string;
  version: number;
  payload: Record<string, unknown>;
}

export interface SyncResponseBody {
  syncId: string;
  result: 'SYNC_SUCCESS' | 'SYNC_BUSY' | 'SYNC_REJECTED';
  commitSequence?: number;
  committedChangeGroupIds?: string[];
  conflicts?: SyncConflict[];
  downloads?: SyncDownload[];
  schemaCompatible?: boolean;
  /** With pullSince: the revision this device has now pulled up to. Absent from scripts without pull support. */
  dataRevision?: number;
  /** With pullSince: more changes remain; ask again from dataRevision. */
  hasMore?: boolean;
  /** REPLACE_GOOGLE_WITH_LOCAL: the version each sent record now has on Google, by entity id. */
  versions?: Record<string, number>;
  /** REPLACE_PRUNE: how many Google records were marked deleted. */
  removed?: number;
  /** INDEX: [id, version] of every Google record, by entity type. */
  index?: Record<string, Array<[string, number]>>;
  /** FETCH / ROWS_AFTER: the answer stopped early; ask again for the rest. */
  truncated?: boolean;
  /** INDEX / ROWS_AFTER: per entity type, the last sheet row covered — where the next ROWS_AFTER starts. */
  lastRows?: Record<string, number>;
}
