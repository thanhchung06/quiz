/**
 * @jest-environment node
 *
 * The Tiếng Anh ("english") subject: the sample question packages at the
 * repo root and the downloadable template pass the real import validator,
 * every sample's own answer is graded correct, and the subject lists/labels
 * cover every subject.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PackageValidatorService } from '../../src/app/features/quiz-bank/import/services/package-validator.service';
import { toAnswerRule } from '../../src/app/features/quiz-bank/import/services/import-commit.service';
import {
  QuizPackage,
  QuizPackageItem,
  choicesFromPackage,
  normalizePackagePassages,
} from '../../src/app/features/quiz-bank/import/quiz-package.model';
import { QUIZ_PACKAGE_TEMPLATE } from '../../src/app/features/quiz-bank/import/quiz-package-template';
import { CATEGORY_SUGGESTIONS } from '../../src/app/features/quiz-bank/import/category-suggestions';
import { evaluateAnswer } from '../../src/app/features/child-play/services/answer-evaluator';
import { CategoryRepository } from '../../src/app/data/repositories/category.repository';
import { QuizItem } from '../../src/app/shared/models/domain.model';
import { CATEGORY_SUBJECT_LABELS, SUBJECTS, SUBJECT_LABELS, categoryFitsSubject } from '../../src/app/shared/subjects';

const SAMPLE_FILES = ['quiz-import-tieng-anh-lop1-2.json', 'quiz-import-tieng-anh-lop3.json'];
const samples = SAMPLE_FILES.map(
  (file) => [file, JSON.parse(readFileSync(join(__dirname, '../..', file), 'utf8')) as QuizPackage] as const,
);

const validator = new PackageValidatorService({ list: async () => [] } as unknown as CategoryRepository);

function allQuestions(pkg: QuizPackage): QuizPackageItem[] {
  const normalized = normalizePackagePassages(pkg);
  return [...normalized.quizzes, ...(normalized.passages ?? []).flatMap((p) => p.questions)];
}

/** The answer the package itself says is right, in the shape the play screen submits. */
function intendedAnswer(item: QuizPackageItem): unknown {
  if (item.type === 'short-text') return item.acceptedAnswer;
  if (item.type === 'number') return Number(item.acceptedAnswer);
  return item.correctAnswerIds;
}

describe('Tiếng Anh sample packages', () => {
  it.each(samples)('%s passes the import validator with no errors', async (_file, pkg) => {
    const result = await validator.validate(pkg);

    expect(result.formatVersionSupported).toBe(true);
    expect(result.schemaErrors).toEqual([]);
    expect(result.itemErrors).toEqual([]);
    expect(result.passageResults.flatMap((p) => p.errors)).toEqual([]);
  });

  it.each(samples)('%s: every question is Tiếng Anh, in a suggested category, with a unique id', (_file, pkg) => {
    const suggested = new Set(CATEGORY_SUGGESTIONS.filter((s) => s.subject === 'english').map((s) => s.name));
    const questions = allQuestions(pkg);

    expect(questions.length).toBeGreaterThanOrEqual(10);
    for (const q of questions) {
      expect(q.subject).toBe('english');
      expect(q.grade).toBeGreaterThanOrEqual(1);
      expect(q.grade).toBeLessThanOrEqual(5);
      expect(suggested).toContain(q.category?.name);
    }
    const ids = pkg.quizzes.map((q) => q.externalId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(samples)(
    "%s: each question's own answer is graded correct and single-choice has exactly one",
    (_file, pkg) => {
      for (const q of allQuestions(pkg)) {
        const item = {
          type: q.type,
          choices: choicesFromPackage(q.choices),
          answerRule: toAnswerRule(q),
          points: 10,
        } as QuizItem;
        expect([q.prompt, evaluateAnswer(item, intendedAnswer(q))]).toEqual([q.prompt, true]);
        if (q.type === 'single-choice' || q.type === 'true-false') expect(q.correctAnswerIds).toHaveLength(1);
      }
    },
  );
});

describe('Tiếng Anh in the template and the subject lists', () => {
  it('the downloadable template has Tiếng Anh questions and a Tiếng Anh passage, and still validates', async () => {
    expect(QUIZ_PACKAGE_TEMPLATE.quizzes.some((q) => q.subject === 'english')).toBe(true);
    expect(QUIZ_PACKAGE_TEMPLATE.passages!.some((p) => p.subject === 'english')).toBe(true);

    const result = await validator.validate(QUIZ_PACKAGE_TEMPLATE);
    expect(result.schemaErrors).toEqual([]);
    expect(result.itemErrors).toEqual([]);
    expect(result.passageResults.flatMap((p) => p.errors)).toEqual([]);
  });

  it('the import schema rejects a subject the app does not know', async () => {
    const pkg: QuizPackage = {
      formatVersion: '1.1',
      quizzes: [{ ...QUIZ_PACKAGE_TEMPLATE.quizzes[0], subject: 'french' as never }],
    };

    const result = await validator.validate(pkg);

    expect(result.schemaErrors.join(' ')).toContain('subject');
  });

  it('every subject has a label, suggested categories, and shared ("both") categories fit it', () => {
    expect(SUBJECTS).toContain('english');
    for (const subject of SUBJECTS) {
      expect(SUBJECT_LABELS[subject]).toBeTruthy();
      expect(CATEGORY_SUGGESTIONS.some((s) => s.subject === subject)).toBe(true);
      expect(categoryFitsSubject('both', subject)).toBe(true);
    }
    expect(SUBJECT_LABELS.english).toBe('Tiếng Anh');
    expect(CATEGORY_SUBJECT_LABELS.both).toBe('Tất cả các môn');
    expect(categoryFitsSubject('math', 'english')).toBe(false);
  });
});
