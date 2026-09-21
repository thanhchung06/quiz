import { db } from './db';
import { seedFixedProfiles, CHILD_ONE_ID, CHILD_TWO_ID } from './seed';
import { newSyncEnvelope } from '../shared/models/sync.model';
import { currentDeviceId } from './repositories/base-repository';
import { normalizeName } from './repositories/category.repository';
import { Category, QuizItem, Exercise, Assignment, Rotation } from '../shared/models/domain.model';

function todayLocalDate(): string {
  const now = new Date();
  const tzOffsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

/**
 * Dev/test seed data enabling every user story's independent test (per
 * tasks.md T026): a math category with a handful of single-choice/short-text/
 * number quiz items, one exercise built from them, and both a dated
 * Assignment and a Rotation entry so US1 can be exercised with or without an
 * explicit daily assignment. Idempotent — skips if already seeded.
 */
export async function seedDevData(): Promise<void> {
  await seedFixedProfiles();

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

  const assignment: Assignment = {
    ...newSyncEnvelope('assignment-child-one-today', deviceId),
    profileId: CHILD_ONE_ID,
    exerciseId: exercise.id,
    assignedDate: todayLocalDate(),
    isPrimary: true,
  };
  await db.assignments.add(assignment);

  // Child Two has no dated assignment — exercises the rotation fallback (FR-069).
  const rotation: Rotation = {
    ...newSyncEnvelope('rotation-child-two', deviceId),
    profileId: CHILD_TWO_ID,
    orderedExerciseIds: [exercise.id],
    cursor: 0,
  };
  await db.rotations.add(rotation);
}
