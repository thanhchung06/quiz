import { Injectable } from '@angular/core';
import { QuizItemRepository } from '../../../data/repositories/quiz-item.repository';
import { CategoryRepository } from '../../../data/repositories/category.repository';
import { QuizPackage, QuizPackageItem, QuizPackagePassage, choicesToPackage } from '../import/quiz-package.model';
import { QuizItem } from '../../../shared/models/domain.model';
import { quizPackageToXlsx, XLSX_MIME } from '../excel/quiz-excel';
import { numberAnswerText } from '../../child-play/services/answer-evaluator';

export type QuizExportFormat = 'json' | 'xlsx';

export interface QuizExportFile {
  data: BlobPart;
  mimeType: string;
  extension: QuizExportFormat;
}

/**
 * Export selected quiz items to the same versioned JSON format for backup,
 * external editing, AI-assisted revision, or transfer (FR-029). categoryId
 * is mapped back to an externalKey/name pair rather than an internal UUID.
 * Items sharing a `passage.passageId` are grouped back into one
 * `passages[]` entry rather than exported as flat, disconnected quizzes
 * (FR-073–075), so a re-import reproduces the same reading/problem groups.
 */
@Injectable({ providedIn: 'root' })
export class QuizExportService {
  constructor(
    private readonly quizItems: QuizItemRepository,
    private readonly categories: CategoryRepository,
  ) {}

  /**
   * Quiz items only (no profiles/attempts/settings — that's the full backup
   * in features/backup) as a re-importable file: the JSON package, or the
   * human-editable Excel workbook described in excel/quiz-excel.ts.
   */
  async exportFile(itemIds: string[], format: QuizExportFormat): Promise<QuizExportFile> {
    const pkg = await this.exportItems(itemIds);
    if (format === 'xlsx') {
      return { data: await quizPackageToXlsx(pkg), mimeType: XLSX_MIME, extension: 'xlsx' };
    }
    return { data: JSON.stringify(pkg, null, 2), mimeType: 'application/json', extension: 'json' };
  }

  async exportItems(itemIds: string[]): Promise<QuizPackage> {
    const standalone: QuizItem[] = [];
    const passageGroups = new Map<string, QuizItem[]>();

    for (const id of itemIds) {
      const item = await this.quizItems.getById(id);
      if (!item) continue;
      if (item.passage) {
        const group = passageGroups.get(item.passage.passageId) ?? [];
        group.push(item);
        passageGroups.set(item.passage.passageId, group);
      } else {
        standalone.push(item);
      }
    }

    const quizzes: QuizPackageItem[] = [];
    for (const item of standalone) {
      quizzes.push(await this.toPackageItem(item));
    }

    const passages: QuizPackagePassage[] = [];
    for (const [passageId, items] of passageGroups) {
      const ordered = [...items].sort((a, b) => (a.passage?.order ?? 0) - (b.passage?.order ?? 0));
      const first = ordered[0];
      const category = await this.categories.getById(first.categoryId);
      const questions: QuizPackageItem[] = [];
      for (const item of ordered) {
        questions.push(await this.toPackageItem(item));
      }
      passages.push({
        externalKey: passageId,
        subject: first.subject,
        grade: first.grade,
        category: category ? { externalKey: category.id, name: category.name, subject: category.subject as 'math' | 'language' } : undefined,
        title: first.passage!.title,
        text: first.passage!.text,
        imageUrl: first.passage!.imageUrl,
        questions,
      });
    }

    return {
      formatVersion: '1.1',
      packageTitle: 'Xuất dữ liệu',
      language: 'vi',
      quizzes,
      passages: passages.length > 0 ? passages : undefined,
    };
  }

  private async toPackageItem(item: QuizItem): Promise<QuizPackageItem> {
    const category = await this.categories.getById(item.categoryId);

    let correctAnswerIds: string[] | undefined;
    let acceptedAnswer: string | undefined;
    let acceptedRange: { min: number; max: number } | undefined;
    if (item.answerRule.kind === 'choice') correctAnswerIds = item.answerRule.correctChoiceIds;
    if (item.answerRule.kind === 'text') acceptedAnswer = item.answerRule.acceptedAnswer;
    if (item.answerRule.kind === 'number') {
      acceptedAnswer = item.answerRule.acceptedValue !== undefined ? numberAnswerText(item.answerRule) : undefined;
      if (item.answerRule.min !== undefined && item.answerRule.max !== undefined) {
        acceptedRange = { min: item.answerRule.min, max: item.answerRule.max };
      }
    }

    return {
      externalId: item.externalId ?? item.id,
      subject: item.subject,
      grade: item.grade,
      category: category ? { externalKey: category.id, name: category.name, subject: category.subject as 'math' | 'language' } : undefined,
      tags: item.tags,
      difficulty: item.difficulty,
      type: item.type,
      prompt: item.prompt,
      imageUrl: item.media?.imageRef,
      choices: choicesToPackage(item.choices),
      correctAnswerIds,
      acceptedAnswer,
      acceptedRange,
      shuffleChoices: item.shuffleChoices,
      explanation: item.explanation,
      points: item.points,
    };
  }
}
