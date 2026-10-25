import { Injectable } from '@angular/core';
import { db } from '../db';
import { QuizDifficulty, QuizItem, QuizItemType, Subject } from '../../shared/models/domain.model';
import { QuizBankRepository } from './base-repository';
import { RemoteStore } from '../../remote/remote-store';

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

/** How many questions one tree node (subject → grade → category) holds. */
export interface CategoryCount {
  subject: Subject;
  grade: number;
  categoryId: string;
  count: number;
}

/** Whether one question passes a quiz-bank filter (the same test `search` uses). */
export function matchesFilter(item: QuizItem, filter: QuizItemFilter): boolean {
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
}

/**
 * Plain CRUD for QuizItem (data-model.md §3). Filtering/search (FR-019),
 * duplicate/answer-config validation, and authoring UI live in US2/US4;
 * this repository only guarantees the data shape and simple queries every
 * story needs (including US1's read-only attempt resolution).
 */
@Injectable({ providedIn: 'root' })
export class QuizItemRepository extends QuizBankRepository<QuizItem> {
  constructor(remote: RemoteStore) {
    super(db.quizItems, remote, 'questions');
  }

  /**
   * Question counts per subject/grade/category, read from the compound index keys
   * only — no question is loaded, so it stays fast with tens of thousands of them.
   */
  async categoryCounts(): Promise<CategoryCount[]> {
    const keys = (await db.quizItems.orderBy('[subject+grade+categoryId]').keys()) as unknown as Array<[Subject, number, string]>;
    const counts = new Map<string, CategoryCount>();
    const add = (subject: Subject, grade: number, categoryId: string, by: number): void => {
      const key = `${subject}|${grade}|${categoryId}`;
      const entry = counts.get(key) ?? { subject, grade, categoryId, count: 0 };
      entry.count += by;
      counts.set(key, entry);
    };
    for (const [subject, grade, categoryId] of keys) add(subject, grade, categoryId, 1);
    // Soft-deleted questions stay in the table (and its index) until the next pull; take them back out.
    for (const gone of await db.quizItems.where('deletedAt').above('').toArray()) add(gone.subject, gone.grade, gone.categoryId, -1);
    return [...counts.values()].filter((c) => c.count > 0);
  }

  /** The questions of one tree node. */
  async byNode(subject: Subject, grade: number, categoryId: string): Promise<QuizItem[]> {
    return db.quizItems
      .where('categoryId')
      .equals(categoryId)
      .filter((i) => !i.deletedAt && i.subject === subject && i.grade === grade)
      .toArray();
  }

  /** The questions of one subject, or of one grade of it. */
  async bySubjectGrade(subject: Subject, grade?: number): Promise<QuizItem[]> {
    return db.quizItems
      .where('subject')
      .equals(subject)
      .filter((i) => !i.deletedAt && (!grade || i.grade === grade))
      .toArray();
  }

  async search(filter: QuizItemFilter): Promise<QuizItem[]> {
    return (await this.list()).filter((item) => matchesFilter(item, filter));
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
    const siblings = (await this.byPassage(passageId)).filter((item) => item.passage);
    await this.updateMany(siblings.map((item) => ({ id: item.id, patch: { passage: { ...item.passage!, title, text } } })));
  }
}
