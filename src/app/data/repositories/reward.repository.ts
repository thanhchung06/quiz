import { Injectable } from '@angular/core';
import { db } from '../db';
import { Reward, RewardType } from '../../shared/models/domain.model';
import { currentDeviceId } from './base-repository';
import { newSyncEnvelope } from '../../shared/models/sync.model';

/** Append-only Reward repository (data-model.md §8): star/badge/streak/personalBest/unlock entries. */
@Injectable({ providedIn: 'root' })
export class RewardRepository {
  async award(profileId: string, type: RewardType, key: string, sourceAttemptId?: string): Promise<Reward> {
    const reward: Reward = {
      ...newSyncEnvelope(crypto.randomUUID(), currentDeviceId()),
      profileId,
      type,
      key,
      earnedAt: new Date().toISOString(),
      sourceAttemptId,
    };
    await db.rewards.add(reward);
    return reward;
  }

  async listForProfile(profileId: string): Promise<Reward[]> {
    return db.rewards.where('profileId').equals(profileId).toArray();
  }

  async hasBadge(profileId: string, key: string): Promise<boolean> {
    const all = await this.listForProfile(profileId);
    return all.some((r) => r.type === 'badge' && r.key === key);
  }

  async hasKey(profileId: string, key: string): Promise<boolean> {
    const all = await this.listForProfile(profileId);
    return all.some((r) => r.key === key);
  }

  async countByType(profileId: string, type: RewardType): Promise<number> {
    const all = await this.listForProfile(profileId);
    return all.filter((r) => r.type === type).length;
  }
}
