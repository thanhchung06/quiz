import { isDevMode } from '@angular/core';
import { db } from './db';
import { seedFixedProfiles } from './seed';
import { newSyncEnvelope } from '../shared/models/sync.model';
import { currentDeviceId } from './repositories/base-repository';
import { normalizeName } from './repositories/category.repository';
import { Category, QuizItem, Exercise } from '../shared/models/domain.model';


/**
 * The fixed profiles, plus — in a development build only — sample data: a
 * math category with a handful of single-choice/short-text/number quiz items
 * and one exercise built from them (stored locally only, never sent to
 * Google). Idempotent — skips if already seeded.
 */
export async function seedDevData(sampleData = isDevMode()): Promise<void> {
  await seedFixedProfiles();
  if (!sampleData) return;

  const alreadySeeded = await db.categories.count();
  if (alreadySeeded > 0) return;

  const deviceId = currentDeviceId();

  const arithmetic: Category = {
    ...newSyncEnvelope('cat-math-arithmetic', deviceId),
    name: 'Số học',
    normalizedName: normalizeName('Số học'),
    subject: 'math',
    status: 'active',
  };
  await db.categories.add(arithmetic);

  const quizItems: QuizItem[] = [
    {
      ...newSyncEnvelope('quiz-add-1', deviceId),
      subject: 'math',
      grade: 1,
      type: 'single-choice',
      prompt: '2 + 3 = ?',
      choices: [
        { id: 'a', text: '4' },
        { id: 'b', text: '5' },
        { id: 'c', text: '6' },
      ],
      answerRule: { kind: 'choice', correctChoiceIds: ['b'] },
      tags: ['cong'],
      difficulty: 1,
      points: 10,
      categoryId: arithmetic.id,
      shuffleChoices: true,
      reviewStatus: 'approved',
      status: 'active',
    },
    {
      ...newSyncEnvelope('quiz-add-2', deviceId),
      subject: 'math',
      grade: 1,
      type: 'number',
      prompt: '5 + 4 = ?',
      answerRule: { kind: 'number', acceptedValue: 9 },
      tags: ['cong'],
      difficulty: 1,
      points: 10,
      categoryId: arithmetic.id,
      shuffleChoices: false,
      reviewStatus: 'approved',
      status: 'active',
    },
    {
      ...newSyncEnvelope('quiz-spell-1', deviceId),
      subject: 'language',
      grade: 1,
      type: 'short-text',
      prompt: 'Điền từ còn thiếu: con m_o (con mèo)',
      answerRule: { kind: 'text', acceptedAnswer: 'meo', caseSensitive: false, punctuationSensitive: false },
      tags: ['chinh-ta'],
      difficulty: 1,
      points: 10,
      categoryId: arithmetic.id,
      shuffleChoices: false,
      reviewStatus: 'approved',
      status: 'active',
    },
  ];
  await db.quizItems.bulkAdd(quizItems);

  const exercise: Exercise = {
    ...newSyncEnvelope('exercise-daily-seed', deviceId),
    title: 'Luyện tập buổi sáng',
    subject: 'mixed',
    grade: 1,
    items: quizItems.map((q, index) => ({ id: `ex-item-${index}`, position: index, kind: 'fixed', quizItemId: q.id })),
    timeLimitMinutes: 10,
    lives: 5,
    passingPercent: 70,
    orderMode: 'fixed',
    replayAllowed: true,
    correctionReviewEnabled: true,
    repeatSameQuestions: false,
    questionTimingMode: 'none',
    status: 'active',
  };
  await db.exercises.add(exercise);
}
