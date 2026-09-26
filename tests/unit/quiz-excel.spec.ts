/**
 * @jest-environment node
 */
import * as ExcelJS from 'exceljs';
import { quizPackageToXlsx, xlsxToQuizPackage, parseChoiceCell, formatChoiceCell, QUESTION_SHEET, PASSAGE_SHEET, SUGGESTION_SHEET } from '../../src/app/features/quiz-bank/excel/quiz-excel';
import { QUIZ_PACKAGE_TEMPLATE } from '../../src/app/features/quiz-bank/import/quiz-package-template';
import { QuizPackage } from '../../src/app/features/quiz-bank/import/quiz-package.model';
import { CATEGORY_SUGGESTIONS } from '../../src/app/features/quiz-bank/import/category-suggestions';

/** Builds an .xlsx by hand, the way a parent would type it into Excel. */
async function handWrittenWorkbook(questions: unknown[][], passages?: unknown[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const q = wb.addWorksheet(QUESTION_SHEET);
  questions.forEach((row, i) => (q.getRow(i + 1).values = row as ExcelJS.CellValue[]));
  if (passages) {
    const p = wb.addWorksheet(PASSAGE_SHEET);
    passages.forEach((row, i) => (p.getRow(i + 1).values = row as ExcelJS.CellValue[]));
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

// ExcelJS is large; its first load/parse can exceed Jest's 5s default on a slow or busy machine.
jest.setTimeout(60_000);

describe('quiz Excel import/export', () => {
  it('round-trips the package template (standalone quizzes + a passage) through .xlsx', async () => {
    const pkg: QuizPackage = {
      ...QUIZ_PACKAGE_TEMPLATE,
      quizzes: QUIZ_PACKAGE_TEMPLATE.quizzes.map((q, i) => (i === 0 ? { ...q, imageUrl: 'https://example.com/a.png' } : q)),
      passages: QUIZ_PACKAGE_TEMPLATE.passages!.map((p) => ({ ...p, imageUrl: 'meo.png' })),
    };

    const buffer = await quizPackageToXlsx(pkg);
    const { pkg: parsed, problems } = await xlsxToQuizPackage(buffer);

    expect(problems).toEqual([]);
    expect(parsed.quizzes).toHaveLength(pkg.quizzes.length);
    for (const [i, original] of pkg.quizzes.entries()) {
      const back = parsed.quizzes[i];
      expect(back.type).toBe(original.type);
      expect(back.prompt).toBe(original.prompt);
      expect(back.subject).toBe(original.subject);
      expect(back.grade).toBe(original.grade);
      expect(back.category?.name).toBe(original.category?.name);
      expect(back.difficulty).toBe(original.difficulty);
      expect(back.imageUrl).toBe(original.imageUrl);
      expect(back.acceptedAnswer).toBe(original.acceptedAnswer);
      expect(back.tags ?? []).toEqual(original.tags ?? []);
      // Choice ids become letters, but the chosen texts must be the same.
      const correctTexts = (item: typeof original) =>
        (item.correctAnswerIds ?? []).map((id) => item.choices!.find((c) => c.id === id)!.text).sort();
      expect(correctTexts(back)).toEqual(correctTexts(original));
      expect(back.choices?.map((c) => c.text)).toEqual(original.choices?.map((c) => c.text));
    }

    expect(parsed.passages).toHaveLength(1);
    const passage = parsed.passages![0];
    const originalPassage = pkg.passages![0];
    expect(passage.title).toBe(originalPassage.title);
    expect(passage.text).toBe(originalPassage.text);
    expect(passage.imageUrl).toBe('meo.png');
    expect(passage.category?.name).toBe(originalPassage.category?.name);
    expect(passage.questions.map((q) => q.prompt)).toEqual(originalPassage.questions.map((q) => q.prompt));
  });

  it('reads a hand-typed sheet with Vietnamese labels, reordered columns and number ranges', async () => {
    const buffer = await handWrittenWorkbook([
      ['Loại câu hỏi', 'Nội dung câu hỏi', 'Môn', 'Lớp', 'Lựa chọn A', 'Lựa chọn B', 'Lựa chọn C', 'Đáp án đúng', 'Độ khó', 'Hình minh họa'],
      ['Chọn nhiều', 'Số chẵn?', 'Toán', 'Lớp 2', '2', '3', '4', 'A, C', 'Khó', 'chan.png'],
      ['Đúng/Sai', '10 > 7', 'toán', 1, null, null, null, 'Đúng'],
      ['Số', 'Khoảng 10 đến 20', 'Toán', 3, null, null, null, '10..20'],
      ['Điền từ', 'Trái nghĩa của "cao"?', 'Tiếng Việt', 3, null, null, null, 'thấp'],
      [],
      ['Chọn một', 'Đáp án sai chữ', 'Toán', 2, 'x', 'y', null, 'D'],
    ]);

    const { pkg, problems, quizSources } = await xlsxToQuizPackage(buffer);

    expect(pkg.quizzes).toHaveLength(5);
    expect(pkg.quizzes[0]).toMatchObject({
      type: 'multiple-choice',
      subject: 'math',
      grade: 2,
      difficulty: 3,
      imageUrl: 'chan.png',
      correctAnswerIds: ['a', 'c'],
    });
    expect(pkg.quizzes[1]).toMatchObject({ type: 'true-false', correctAnswerIds: ['true'] });
    expect(pkg.quizzes[1].choices?.map((c) => c.id)).toEqual(['true', 'false']);
    expect(pkg.quizzes[2]).toMatchObject({ type: 'number', acceptedRange: { min: 10, max: 20 } });
    expect(pkg.quizzes[3]).toMatchObject({ type: 'short-text', subject: 'language', acceptedAnswer: 'thấp' });
    expect(quizSources[4]).toEqual({ sheet: QUESTION_SHEET, row: 7 });
    expect(problems).toEqual([expect.stringContaining('dòng 7')]);
  });

  it('groups passage questions and reports rows it had to skip', async () => {
    const buffer = await handWrittenWorkbook(
      [
        ['Loại câu hỏi', 'Nội dung câu hỏi', 'Đáp án đúng', 'Mã đoạn văn'],
        ['Điền từ', 'Câu 1', 'a', 'DV1'],
        ['Số', 'Câu 2', '3', 'dv1'],
        ['Không rõ', 'Loại sai', 'x'],
        ['Điền từ', 'Mồ côi', 'x', 'DV9'],
      ],
      [
        ['Mã đoạn văn', 'Môn', 'Lớp', 'Tiêu đề', 'Nội dung'],
        ['DV1', 'Tiếng Việt', 3, 'Bài đọc', 'Nội dung bài đọc'],
      ],
    );

    const { pkg, problems } = await xlsxToQuizPackage(buffer);

    expect(pkg.quizzes).toHaveLength(0);
    expect(pkg.passages).toHaveLength(1);
    expect(pkg.passages![0].questions.map((q) => q.prompt)).toEqual(['Câu 1', 'Câu 2']);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('dòng 4');
    expect(problems[1]).toContain('DV9');
  });

  it('writes the downloadable template with every question type, image examples and category suggestions', async () => {
    const buffer = await quizPackageToXlsx(QUIZ_PACKAGE_TEMPLATE, { categorySuggestions: CATEGORY_SUGGESTIONS });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as Parameters<typeof wb.xlsx.load>[0]);
    expect(wb.getWorksheet(SUGGESTION_SHEET)!.actualRowCount).toBe(CATEGORY_SUGGESTIONS.length + 1);

    const { pkg, problems } = await xlsxToQuizPackage(buffer);
    expect(problems).toEqual([]);
    const types = new Set([...pkg.quizzes, ...pkg.passages!.flatMap((p) => p.questions)].map((q) => q.type));
    expect([...types].sort()).toEqual(['multiple-choice', 'number', 'short-text', 'single-choice', 'true-false']);
    expect(pkg.quizzes.find((q) => q.externalId === 'mau-so-khoang')?.acceptedRange).toEqual({ min: 11, max: 19 });
    expect(pkg.quizzes.filter((q) => q.imageUrl).map((q) => q.imageUrl)).toEqual([
      'vi-du-hinh-vuong.svg',
      'assets/images/vi-du-dong-ho.svg',
      expect.stringMatching(/^https:\/\//),
    ]);
    // Every template category is one of the suggested names.
    const suggested = new Set(CATEGORY_SUGGESTIONS.map((c) => c.name));
    for (const q of QUIZ_PACKAGE_TEMPLATE.quizzes) expect(suggested).toContain(q.category?.name);
  });
});

describe('choice pictures in Excel cells', () => {
  it('reads an optional "Hình:" line from a choice cell', () => {
    expect(parseChoiceCell('Quả cam')).toEqual({ text: 'Quả cam', imageUrl: undefined });
    expect(parseChoiceCell('Quả cam\nHình: cam.png')).toEqual({ text: 'Quả cam', imageUrl: 'cam.png' });
    expect(parseChoiceCell('hinh: https://x.org/a.png')).toEqual({ text: '', imageUrl: 'https://x.org/a.png' });
  });

  it('writes text and picture back into one cell', () => {
    expect(formatChoiceCell({ text: 'Quả cam', imageUrl: 'cam.png' })).toBe('Quả cam\nHình: cam.png');
    expect(formatChoiceCell({ text: '', imageUrl: 'cam.png' })).toBe('Hình: cam.png');
    expect(formatChoiceCell({ text: '7' })).toBe('7');
  });

  it('keeps choice pictures through an .xlsx round trip', async () => {
    const { pkg } = await xlsxToQuizPackage(await quizPackageToXlsx(QUIZ_PACKAGE_TEMPLATE));
    const q = pkg!.quizzes.find((x) => x.externalId === 'mau-anh-lua-chon');
    expect(q?.choices).toEqual([
      { id: 'a', text: '', imageUrl: 'vi-du-hinh-tron.svg' },
      { id: 'b', text: '', imageUrl: 'vi-du-hinh-tam-giac.svg' },
      { id: 'c', text: 'Hình chữ nhật', imageUrl: 'vi-du-hinh-chu-nhat.svg' },
    ]);
    expect(q?.correctAnswerIds).toEqual(['b']);
  });
});
