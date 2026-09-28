import { Injectable } from '@angular/core';
import { db } from '../db';
import { Category, CategorySubject } from '../../shared/models/domain.model';
import { newSyncEnvelope } from '../../shared/models/sync.model';
import { QuizBankRepository, currentDeviceId } from './base-repository';
import { RemoteStore } from '../../remote/remote-store';
import { QuizItemRepository } from './quiz-item.repository';

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Plain CRUD for Category (data-model.md §2). `(normalizedName, subject)`
 * must be unique among non-deleted records (FR-022); business rules like
 * merge/rename-with-reference-update live in US2's quiz-bank feature layer.
 */
@Injectable({ providedIn: 'root' })
export class CategoryRepository extends QuizBankRepository<Category> {
  constructor(
    remote: RemoteStore,
    private readonly quizItems: QuizItemRepository,
  ) {
    super(db.categories, remote, 'categories');
  }

  async findDuplicate(name: string, subject: CategorySubject): Promise<Category | undefined> {
    const normalized = normalizeName(name);
    const all = await this.list();
    return all.find(
      (c) => c.normalizedName === normalized && (c.subject === subject || c.subject === 'both' || subject === 'both'),
    );
  }

  /** `id` is normally random; callers pass a fixed one only for records every device must share (default categories). */
  /** `asDefault`: a seeded default category (see QuizBankRepository.createDefault). */
  async createCategory(name: string, subject: CategorySubject, description?: string, id: string = crypto.randomUUID(), asDefault = false): Promise<Category> {
    const existing = await this.findDuplicate(name, subject);
    if (existing) {
      throw new Error(`Category "${name}" already exists for subject ${subject}`);
    }
    const category: Category = {
      ...newSyncEnvelope(id, currentDeviceId()),
      name,
      normalizedName: normalizeName(name),
      subject,
      description,
      status: 'active',
    };
    if (asDefault) await this.createDefault(category);
    else await this.create(category);
    return category;
  }

  /** Renaming never touches QuizItem.categoryId references (FR-022). */
  async rename(id: string, name: string): Promise<void> {
    await this.update(id, { name, normalizedName: normalizeName(name) });
  }

  async describe(id: string, description: string): Promise<void> {
    await this.update(id, { description });
  }

  async archive(id: string): Promise<void> {
    await this.update(id, { status: 'archived' });
  }

  async restore(id: string): Promise<void> {
    await this.update(id, { status: 'active' });
  }

  async itemCount(categoryId: string): Promise<number> {
    return (await this.quizItems.byCategory(categoryId)).length;
  }

  /**
   * Merges `losingId` into `winningId`: reassigns every referencing QuizItem
   * as one change group, then soft-deletes the losing category (FR-022).
   */
  async merge(winningId: string, losingId: string): Promise<void> {
    const items = await this.quizItems.byCategory(losingId);
    await this.quizItems.updateMany(items.map((item) => ({ id: item.id, patch: { categoryId: winningId } })));
    await this.softDelete(losingId);
  }

  /** A category referenced by any active item cannot be permanently removed (FR-023). */
  async canHardDelete(id: string): Promise<boolean> {
    return (await this.itemCount(id)) === 0;
  }
}
