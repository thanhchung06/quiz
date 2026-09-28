import { Injectable } from '@angular/core';
import { db } from '../db';
import { QuizDifficulty, QuizItem, QuizItemType, Subject } from '../../shared/models/domain.model';
import { BaseRepository } from './base-repository';

export interface QuizItemFilter {
  subject?: Subject;
  grade?: number;
  type?: QuizItemType;
  difficulty?: QuizDifficulty;
  tag?: string;
  categoryId?: string;
  reviewStatus?: QuizItem['reviewStatus'];
  status?: QuizItem['status'];
  searchText?: string;
}

/**
 * Plain CRUD for QuizItem (data-model.md §3). Filtering/search (FR-019),
 * duplicate/answer-config validation, and authoring UI live in US2/US4;
 * this repository only guarantees the data shape and simple queries every
 * story needs (including US1's read-only attempt resolution).
 */
@Injectable({ providedIn: 'root' })
export class QuizItemRepository extends BaseRepository<QuizItem> {
  constructor() {
    super(db.quizItems, 'QuizItem');
  }

  async search(filter: QuizItemFilter): Promise<QuizItem[]> {
    const all = await this.list();
    return all.filter((item) => {
      if (filter.subject && item.subject !== filter.subject) return false;
      if (filter.grade && item.grade !== filter.grade) return false;
      if (filter.type && item.type !== filter.type) return false;
      if (filter.difficulty && (item.difficulty ?? 2) !== filter.difficulty) return false; // legacy items predating this field default to Trung bình
      if (filter.tag && !item.tags.includes(filter.tag)) return false;
      if (filter.categoryId && item.categoryId !== filter.categoryId) return false;
      if (filter.reviewStatus && item.reviewStatus !== filter.reviewStatus) return false;
      if (filter.status && item.status !== filter.status) return false;
      if (filter.searchText) {
        const needle = filter.searchText.toLowerCase();
        const haystack = `${item.prompt} ${item.id} ${item.tags.join(' ')}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }

  async byCategory(categoryId: string): Promise<QuizItem[]> {
    return db.quizItems.where('categoryId').equals(categoryId).toArray();
  }

  /** All non-deleted sub-questions of one passage/problem group, in authoring order (FR-073). */
  async byPassage(passageId: string): Promise<QuizItem[]> {
    const all = await this.list();
    return all
      .filter((item) => item.passage?.passageId === passageId)
      .sort((a, b) => (a.passage?.order ?? 0) - (b.passage?.order ?? 0));
  }

  /** Updates the shared title/text copy on every sub-question of a passage at once, keeping them from drifting apart. */
  async retextPassage(passageId: string, title: string, text: string): Promise<void> {
    const siblings = await this.byPassage(passageId);
    for (const item of siblings) {
      if (!item.passage) continue;
      await this.update(item.id, { passage: { ...item.passage, title, text } });
    }
  }
}
