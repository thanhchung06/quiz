import { Injectable } from '@angular/core';
import { db } from '../db';
import { PointRedemption } from '../../shared/models/domain.model';
import { currentDeviceId } from './base-repository';
import { newSyncEnvelope } from '../../shared/models/sync.model';

/** Append-only PointRedemption repository: one immutable row per parent-recorded point spend, never edited after write (same rule as AnswerResult/Reward). */
@Injectable({ providedIn: 'root' })
export class PointRedemptionRepository {
  async redeem(profileId: string, points: number, note?: string): Promise<PointRedemption> {
    const redemption: PointRedemption = {
      ...newSyncEnvelope(crypto.randomUUID(), currentDeviceId()),
      profileId,
      points,
      note,
      redeemedAt: new Date().toISOString(),
    };
    await db.pointRedemptions.add(redemption);
    return redemption;
  }

  async listForProfile(profileId: string): Promise<PointRedemption[]> {
    const all = await db.pointRedemptions.where('profileId').equals(profileId).toArray();
    return all.sort((a, b) => new Date(b.redeemedAt).getTime() - new Date(a.redeemedAt).getTime());
  }

  async totalRedeemed(profileId: string): Promise<number> {
    const all = await this.listForProfile(profileId);
    return all.reduce((sum, r) => sum + r.points, 0);
  }
}
