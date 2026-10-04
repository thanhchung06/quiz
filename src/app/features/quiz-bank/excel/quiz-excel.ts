import type { Workbook, Worksheet } from 'exceljs';
import { QuizPackage, QuizPackageChoice, QuizPackageItem, QuizPackagePassage } from '../import/quiz-package.model';
import { Choice, QuizDifficulty, QuizItemType, Subject } from '../../../shared/models/domain.model';
import { DIFFICULTY_LABELS } from '../../../shared/difficulty';
import { parseNumberAnswer } from '../../child-play/services/answer-evaluator';
import { CategorySuggestion, gradesLabel } from '../import/category-suggestions';

/**
 * Human-editable Excel (.xlsx) form of the quiz package format
 * (contracts/quiz-package-format.md). Unlike the JSON form, it's meant to be
 * opened and edited directly in Excel / Google Sheets / LibreOffice:
 *
 * - sheet "Câu hỏi": one row per question, Vietnamese headers and labels
 *   (Toán/Tiếng Việt, Chọn một/Đúng/Sai…), one column per choice (Lựa chọn
 *   A, B, C…) and the correct answer written as letters ("A" or "A, C");
 * - sheet "Đoạn văn": one row per shared reading text / problem statement;
 *   its questions are the "Câu hỏi" rows whose "Mã đoạn văn" matches, in
 *   row order;
 * - sheet "Hướng dẫn": what every column means, plus one example per type;
 * - sheet "Danh mục gợi ý" (template only): common category names, which
 *   also feed a non-strict dropdown on the Danh mục columns.
 *
 * Columns are found by header text (accents/case/"(…)" hints ignored), so a
 * parent may reorder, hide, or add columns freely. Anything a row gets wrong
 * is reported with its sheet+row number in `problems` rather than failing
 * the whole file; rows that could not be turned into a schema-valid item at
 * all (no prompt, unknown question type…) are left out of the package.
 *
 * ExcelJS (~1 MB) is loaded lazily, only when a spreadsheet is actually read
 * or written.
 */

export const QUESTION_SHEET = 'Câu hỏi';
export const PASSAGE_SHEET = 'Đoạn văn';
export const GUIDE_SHEET = 'Hướng dẫn';
export const SUGGESTION_SHEET = 'Danh mục gợi ý';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const SUBJECT_LABELS: Record<Subject, string> = { math: 'Toán', language: 'Tiếng Việt' };

/** Same wording as the quiz item form's type <select>. */
const TYPE_LABELS: Record<QuizItemType, string> = {
  'single-choice': 'Chọn một',
  'multiple-choice': 'Chọn nhiều',
  'true-false': 'Đúng/Sai',
  'short-text': 'Điền từ',
  number: 'Số',
  'match-pairs': 'Nối cặp',
};

const CHOICE_TYPES: QuizItemType[] = ['single-choice', 'multiple-choice', 'true-false', 'match-pairs'];
const MIN_CHOICE_COLUMNS = 4;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const TRUE_FALSE_CHOICES: Choice[] = [
  { id: 'true', text: 'Đúng' },
  { id: 'false', text: 'Sai' },
];
/** Extra empty rows below the data that still get dropdowns, so new rows typed by hand get them too. */
const EXTRA_VALIDATED_ROWS = 300;

type QuestionField =
  | 'externalId'
  | 'subject'
  | 'grade'
  | 'category'
  | 'type'
  | 'prompt'
  | 'imageUrl'
  | 'answer'
  | 'explanation'
  | 'difficulty'
  | 'points'
  | 'tags'
  | 'shuffle'
  | 'passageKey';

type PassageField = 'passageKey' | 'subject' | 'grade' | 'category' | 'title' | 'text' | 'imageUrl';

interface ColumnSpec<F extends string> {
  field: F;
  header: string;
  /** Other header spellings accepted on import (English field names, older wording…). */
  aliases?: string[];
  width: number;
  wrap?: boolean;
  required?: string;
  help: string;
  example: string;
}

const QUESTION_COLUMNS_BEFORE_CHOICES: ColumnSpec<QuestionField>[] = [
  {
    field: 'externalId',
    header: 'Mã câu hỏi',
    aliases: ['externalId', 'ma'],
    width: 16,
    required: 'Không',
    help: 'Mã riêng của câu hỏi. Giữ nguyên mã khi sửa câu hỏi đã xuất ra để lúc nhập lại có thể cập nhật đúng câu cũ; để trống với câu hỏi mới.',
    example: 'toan2-cong-001',
  },
  {
    field: 'subject',
    header: 'Môn',
    aliases: ['subject', 'mon hoc'],
    width: 12,
    required: 'Có*',
    help: 'Toán hoặc Tiếng Việt. *Câu thuộc đoạn văn có thể để trống — lấy theo đoạn văn.',
    example: 'Toán',
  },
  {
    field: 'grade',
    header: 'Lớp',
    aliases: ['grade'],
    width: 7,
    required: 'Có*',
    help: 'Số từ 1 đến 5. *Câu thuộc đoạn văn có thể để trống — lấy theo đoạn văn.',
    example: '2',
  },
  {
    field: 'category',
    header: 'Danh mục',
    aliases: ['category'],
    width: 22,
    required: 'Không',
    help: 'Tên danh mục. Danh mục chưa có sẽ được tạo mới; để trống sẽ vào danh mục "Khác" (hoặc danh mục của đoạn văn).',
    example: 'Phép cộng',
  },
  {
    field: 'type',
    header: 'Loại câu hỏi',
    aliases: ['type', 'loai'],
    width: 14,
    required: 'Có',
    help: 'Chọn một, Chọn nhiều, Đúng/Sai, Điền từ hoặc Số.',
    example: 'Chọn một',
  },
  {
    field: 'prompt',
    header: 'Nội dung câu hỏi',
    aliases: ['prompt', 'cau hoi'],
    width: 50,
    wrap: true,
    required: 'Có',
    help: 'Đề bài hiển thị cho trẻ. Có thể xuống dòng (Alt+Enter trong Excel).',
    example: '5 + 3 = ?',
  },
  {
    field: 'imageUrl',
    header: 'Hình minh họa',
    aliases: ['imageUrl', 'image', 'hinh anh', 'anh'],
    width: 28,
    required: 'Không',
    help: 'Link ảnh trên internet (https://…), hoặc tên tệp ảnh đặt trong thư mục public/assets/images của ứng dụng (ví dụ: cam.png hoặc assets/images/lop2/cam.png). Lưu ý: ảnh trên internet cần có mạng mới hiển thị.',
    example: 'https://example.com/hinh.png',
  },
];

const QUESTION_COLUMNS_AFTER_CHOICES: ColumnSpec<QuestionField>[] = [
  {
    field: 'answer',
    header: 'Đáp án đúng',
    aliases: ['answer', 'correct answer', 'dap an'],
    width: 16,
    wrap: true,
    required: 'Có',
    help: 'Chọn một: một chữ cái (B). Chọn nhiều: các chữ cái cách nhau bởi dấu phẩy (A, C). Đúng/Sai: Đúng hoặc Sai. Điền từ: từ cần điền. Số: con số (12), khoảng số (10..20), hoặc cả hai (12; 10..20).',
    example: 'B',
  },
  {
    field: 'explanation',
    header: 'Giải thích',
    aliases: ['explanation'],
    width: 40,
    wrap: true,
    required: 'Không',
    help: 'Lời giải thích hiện sau khi trẻ trả lời.',
    example: '5 + 3 = 8.',
  },
  {
    field: 'difficulty',
    header: 'Độ khó',
    aliases: ['difficulty'],
    width: 12,
    required: 'Không',
    help: 'Số 1–5 (1 Dễ, 2 Trung bình, 3 Khó, 4 Rất khó, 5 Chuyên gia) hoặc tên mức. Mặc định 2.',
    example: '1',
  },
  {
    field: 'points',
    header: 'Điểm',
    aliases: ['points', 'diem so'],
    width: 8,
    required: 'Không',
    help: 'Số điểm của câu hỏi. Mặc định 10.',
    example: '10',
  },
  {
    field: 'tags',
    header: 'Nhãn',
    aliases: ['tags', 'the'],
    width: 22,
    wrap: true,
    required: 'Không',
    help: 'Các nhãn cách nhau bởi dấu chấm phẩy (;) hoặc xuống dòng.',
    example: 'cộng; trong phạm vi 20',
  },
  {
    field: 'shuffle',
    header: 'Trộn đáp án',
    aliases: ['shuffleChoices', 'shuffle'],
    width: 12,
    required: 'Không',
    help: 'Có hoặc Không — có đảo thứ tự các lựa chọn khi trẻ làm bài không. Mặc định Có.',
    example: 'Có',
  },
  {
    field: 'passageKey',
    header: 'Mã đoạn văn',
    aliases: ['passageKey', 'passage', 'doan van'],
    width: 14,
    required: 'Không',
    help: 'Chỉ dùng cho câu hỏi thuộc một đoạn văn/bài toán nhiều câu hỏi: ghi đúng "Mã đoạn văn" ở trang "Đoạn văn". Thứ tự câu trong đoạn theo thứ tự dòng.',
    example: 'DV1',
  },
];

const PASSAGE_COLUMNS: ColumnSpec<PassageField>[] = [
  {
    field: 'passageKey',
    header: 'Mã đoạn văn',
    aliases: ['passageKey', 'ma'],
    width: 14,
    required: 'Có',
    help: 'Mã tự đặt, không trùng nhau (ví dụ DV1, DV2). Các câu hỏi của đoạn văn ghi mã này ở cột "Mã đoạn văn" trang "Câu hỏi". Mỗi đoạn văn cần ít nhất 2 câu hỏi.',
    example: 'DV1',
  },
  { field: 'subject', header: 'Môn', aliases: ['subject'], width: 12, required: 'Có', help: 'Toán hoặc Tiếng Việt.', example: 'Tiếng Việt' },
  { field: 'grade', header: 'Lớp', aliases: ['grade'], width: 7, required: 'Có', help: 'Số từ 1 đến 5.', example: '3' },
  {
    field: 'category',
    header: 'Danh mục',
    aliases: ['category'],
    width: 22,
    required: 'Không',
    help: 'Tên danh mục cho mọi câu hỏi trong đoạn văn.',
    example: 'Đọc hiểu',
  },
  { field: 'title', header: 'Tiêu đề', aliases: ['title'], width: 26, wrap: true, required: 'Có', help: 'Tiêu đề đoạn văn / bài toán.', example: 'Con mèo của Lan' },
  {
    field: 'text',
    header: 'Nội dung',
    aliases: ['text', 'noi dung doan van'],
    width: 70,
    wrap: true,
    required: 'Có',
    help: 'Đoạn văn cần đọc hoặc đề bài toán chung.',
    example: 'Lan có một con mèo tên là Mimi…',
  },
  {
    field: 'imageUrl',
    header: 'Hình minh họa',
    aliases: ['imageUrl', 'image', 'hinh anh', 'anh'],
    width: 28,
    required: 'Không',
    help: 'Giống cột "Hình minh họa" ở trang "Câu hỏi".',
    example: 'cho-meo.png',
  },
];

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type ExcelJsModule = typeof import('exceljs');

async function loadExcelJs(): Promise<ExcelJsModule> {
  const mod = (await import('exceljs')) as ExcelJsModule & { default?: ExcelJsModule };
  return mod.default ?? mod;
}

/** Lowercase, no Vietnamese accents, no "(…)" hints, letters/digits only — so "Độ khó (1-5)" and "do kho" both match. */
function normalizeKey(value: string): string {
  return value
    .replace(/\(.*?\)/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function cellText(sheet: Worksheet, row: number, col: number | undefined): string {
  if (!col) return '';
  const cell = sheet.getRow(row).getCell(col);
  const value = cell.value;
  if (value === null || value === undefined) return '';
  // Hyperlinks (Excel auto-links pasted image URLs) keep their target, not just the display text.
  if (typeof value === 'object' && 'hyperlink' in value && typeof value.hyperlink === 'string') {
    const text = typeof value.text === 'string' ? value.text : '';
    return (/^https?:/i.test(text) ? text : value.hyperlink).trim();
  }
  return (cell.text ?? '').replace(/\r\n/g, '\n').trim();
}

function columnIndex<F extends string>(sheet: Worksheet, specs: ColumnSpec<F>[]): Map<F, number> {
  const byKey = new Map<string, F>();
  for (const spec of specs) {
    for (const name of [spec.header, spec.field, ...(spec.aliases ?? [])]) byKey.set(normalizeKey(name), spec.field);
  }
  const result = new Map<F, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    const field = byKey.get(normalizeKey(cell.text ?? ''));
    if (field && !result.has(field)) result.set(field, col);
  });
  return result;
}

/** "Lựa chọn A" / "Choice A" / "A" header → column number, keyed by uppercase letter. */
function choiceColumns(sheet: Worksheet): Map<string, number> {
  const result = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    const match = /^(?:luachon|dapan|choice|option)?([a-z])$/.exec(normalizeKey(cell.text ?? ''));
    if (match) result.set(match[1].toUpperCase(), col);
  });
  return result;
}

function isRowEmpty(sheet: Worksheet, row: number): boolean {
  let empty = true;
  sheet.getRow(row).eachCell((cell) => {
    if ((cell.text ?? '').trim()) empty = false;
  });
  return empty;
}

function parseSubject(value: string): Subject | undefined {
  const key = normalizeKey(value);
  if (['toan', 'math', 'maths'].includes(key)) return 'math';
  if (['tiengviet', 'tv', 'language', 'vietnamese'].includes(key)) return 'language';
  return undefined;
}

function parseType(value: string): QuizItemType | undefined {
  const key = normalizeKey(value);
  for (const [type, label] of Object.entries(TYPE_LABELS) as Array<[QuizItemType, string]>) {
    if (key === normalizeKey(label) || key === normalizeKey(type)) return type;
  }
  const extra: Record<string, QuizItemType> = {
    motdapan: 'single-choice',
    chon1: 'single-choice',
    nhieudapan: 'multiple-choice',
    dungsai: 'true-false',
    truefalse: 'true-false',
    dientu: 'short-text',
    tuluan: 'short-text',
    dienso: 'number',
    ghepdoi: 'match-pairs',
  };
  return extra[key];
}

function parseGrade(value: string): number | undefined {
  const match = /\d+/.exec(value);
  const n = match ? Number(match[0]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : undefined;
}

function parseDifficulty(value: string): QuizDifficulty | undefined {
  const n = Number(value);
  if (Number.isInteger(n) && n >= 1 && n <= 5) return n as QuizDifficulty;
  const key = normalizeKey(value);
  for (const [level, label] of Object.entries(DIFFICULTY_LABELS)) {
    if (normalizeKey(label) === key) return Number(level) as QuizDifficulty;
  }
  return undefined;
}

function parseBoolean(value: string): boolean | undefined {
  const key = normalizeKey(value);
  if (['co', 'yes', 'true', 'x', '1', 'dung'].includes(key)) return true;
  if (['khong', 'no', 'false', '0', 'sai'].includes(key)) return false;
  return undefined;
}

function toNumberString(value: string): string {
  const trimmed = value.trim();
  return /^-?\d+,\d+$/.test(trimmed) ? trimmed.replace(',', '.') : trimmed;
}

// ---------------------------------------------------------------------------
// Export: QuizPackage → .xlsx
// ---------------------------------------------------------------------------

function styleHeader(sheet: Worksheet, specs: Array<{ help: string }>, withFilter = true): void {
  const header = sheet.getRow(1);
  header.height = 30;
  header.eachCell((cell, col) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    const help = specs[col - 1]?.help;
    if (help) cell.note = help;
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  if (withFilter) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: specs.length } };
}

function addListValidation(sheet: Worksheet, col: number, lastRow: number, values: string[], hint: string): void {
  for (let row = 2; row <= lastRow; row++) {
    sheet.getRow(row).getCell(col).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${values.join(',')}"`],
      showErrorMessage: true,
      errorStyle: 'warning',
      errorTitle: 'Giá trị không hợp lệ',
      error: hint,
    };
  }
}

function applyColumns<F extends string>(sheet: Worksheet, specs: ColumnSpec<F>[]): void {
  sheet.columns = specs.map((spec) => ({
    header: spec.header,
    key: spec.field,
    width: spec.width,
    style: { alignment: { vertical: 'top', wrapText: !!spec.wrap } },
  }));
}

function choiceColumnSpecs(count: number): ColumnSpec<QuestionField>[] {
  return Array.from({ length: count }, (_, i) => ({
    field: `choice${LETTERS[i]}` as QuestionField,
    header: `Lựa chọn ${LETTERS[i]}`,
    width: 16,
    wrap: true,
    required: i < 2 ? 'Có*' : 'Không',
    help: `Nội dung lựa chọn ${LETTERS[i]} (cho câu Chọn một / Chọn nhiều). Muốn kèm hình thì thêm một dòng "Hình: <link hoặc tên tệp>" trong ô (Alt+Enter để xuống dòng), ví dụ "Quả cam" rồi "Hình: cam.png"; lựa chọn chỉ có hình thì chỉ ghi dòng "Hình: …". Câu Đúng/Sai để trống các cột lựa chọn. Cần thêm lựa chọn thì thêm cột "Lựa chọn ${LETTERS[count] ?? 'X'}"…`,
    example: ['7', '8', '9', ''][i] ?? '',
  }));
}

/**
 * A choice cell is the option's text, optionally with a line "Hình: <ảnh>"
 * giving its picture (link or file name in assets/images), e.g.
 * "Quả cam\nHình: cam.png" — or just "Hình: cam.png" for a picture-only option.
 */
const CHOICE_IMAGE_LINE = /^\s*(?:hình|hinh|ảnh|anh|image|img)\s*:\s*(\S.*)$/i;

export function parseChoiceCell(value: string): { text: string; imageUrl?: string } {
  let imageUrl: string | undefined;
  const textLines: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    const match = CHOICE_IMAGE_LINE.exec(line);
    if (match && !imageUrl) imageUrl = match[1].trim();
    else textLines.push(line);
  }
  return { text: textLines.join('\n').trim(), imageUrl };
}

export function formatChoiceCell(choice: { text: string; imageUrl?: string }): string {
  return [choice.text, choice.imageUrl ? `Hình: ${choice.imageUrl}` : ''].filter(Boolean).join('\n');
}

function isStandardTrueFalse(choices: Array<{ text: string }> | undefined): boolean {
  if (!choices || choices.length !== 2) return false;
  const keys = choices.map((c) => normalizeKey(c.text)).sort();
  return keys[0] === 'dung' && keys[1] === 'sai';
}

function answerCell(item: QuizPackageItem): string {
  if (CHOICE_TYPES.includes(item.type)) {
    const choices = item.choices ?? [];
    if (item.type === 'true-false' && isStandardTrueFalse(choices)) {
      return choices.find((c) => item.correctAnswerIds?.includes(c.id))?.text ?? '';
    }
    return (item.correctAnswerIds ?? [])
      .map((id) => choices.findIndex((c) => c.id === id))
      .filter((i) => i >= 0)
      .map((i) => LETTERS[i])
      .join(', ');
  }
  if (item.type === 'number') {
    const parts: string[] = [];
    if (item.acceptedAnswer) parts.push(item.acceptedAnswer);
    if (item.acceptedRange) parts.push(`${item.acceptedRange.min}..${item.acceptedRange.max}`);
    return parts.join('; ');
  }
  return item.acceptedAnswer ?? '';
}

function numericOrText(value: string): string | number {
  return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
}

function questionRow(item: QuizPackageItem, passageKey?: string): Record<string, string | number | undefined> {
  const row: Record<string, string | number | undefined> = {
    externalId: item.externalId,
    // A passage question inherits these from its passage — leaving them blank keeps a single place to edit them.
    subject: passageKey ? undefined : item.subject && SUBJECT_LABELS[item.subject],
    grade: passageKey ? undefined : item.grade,
    category: passageKey ? undefined : item.category?.name,
    type: TYPE_LABELS[item.type],
    prompt: item.prompt,
    imageUrl: item.imageUrl,
    answer: item.type === 'number' ? numericOrText(answerCell(item)) : answerCell(item),
    explanation: item.explanation,
    difficulty: item.difficulty,
    points: item.points,
    tags: item.tags?.length ? item.tags.join('; ') : undefined,
    shuffle: item.shuffleChoices === undefined ? undefined : item.shuffleChoices ? 'Có' : 'Không',
    passageKey,
  };
  const writeChoices = !(item.type === 'true-false' && isStandardTrueFalse(item.choices));
  if (CHOICE_TYPES.includes(item.type) && writeChoices) {
    (item.choices ?? []).forEach((choice, i) => (row[`choice${LETTERS[i]}`] = formatChoiceCell(choice)));
  }
  return row;
}

function buildGuideSheet(workbook: Workbook, questionSpecs: ColumnSpec<QuestionField>[]): void {
  const sheet = workbook.addWorksheet(GUIDE_SHEET);
  sheet.columns = [
    { header: 'Trang / Cột', key: 'column', width: 26 },
    { header: 'Bắt buộc', key: 'required', width: 10 },
    { header: 'Cách điền', key: 'help', width: 90, style: { alignment: { wrapText: true, vertical: 'top' } } },
    { header: 'Ví dụ', key: 'example', width: 24, style: { alignment: { wrapText: true, vertical: 'top' } } },
  ];
  styleHeader(sheet, [], false);

  const intro = [
    'Mỗi dòng ở trang "Câu hỏi" là một câu hỏi. Sửa trực tiếp, thêm dòng mới hoặc xóa dòng rồi nhập lại tệp này trong mục "Nhập gói câu hỏi".',
    'Câu hỏi có "Mã câu hỏi" trùng với câu đã có trong ứng dụng được coi là trùng lặp: khi nhập có thể chọn bỏ qua hoặc cập nhật câu cũ.',
    'Đoạn văn / bài toán nhiều câu hỏi: khai báo ở trang "Đoạn văn", rồi ghi "Mã đoạn văn" cho từng câu hỏi của nó ở trang "Câu hỏi".',
  ];
  for (const line of intro) {
    const row = sheet.addRow({ column: '•', help: line });
    row.getCell('help').font = { italic: true };
  }
  sheet.addRow({});

  const addSection = (title: string, specs: Array<ColumnSpec<string>>) => {
    const titleRow = sheet.addRow({ column: title });
    titleRow.font = { bold: true, size: 12 };
    for (const spec of specs) {
      sheet.addRow({ column: spec.header, required: spec.required ?? '', help: spec.help, example: spec.example });
    }
    sheet.addRow({});
  };
  addSection(`Trang "${QUESTION_SHEET}"`, questionSpecs);
  addSection(`Trang "${PASSAGE_SHEET}"`, PASSAGE_COLUMNS);

  const typeTitle = sheet.addRow({ column: 'Ví dụ theo loại câu hỏi' });
  typeTitle.font = { bold: true, size: 12 };
  for (const example of TYPE_EXAMPLES) {
    sheet.addRow({ column: example.type, required: '', help: example.how, example: example.answer });
  }
}

/** One short "how to fill it" line per question type, for the guide sheet. */
const TYPE_EXAMPLES: Array<{ type: string; how: string; answer: string }> = [
  { type: 'Chọn một', how: 'Ghi các lựa chọn vào cột Lựa chọn A, B, C…; Đáp án đúng là MỘT chữ cái. Ví dụ: "5 + 3 = ?" với A=7, B=8, C=9.', answer: 'B' },
  { type: 'Chọn nhiều', how: 'Như Chọn một, nhưng Đáp án đúng có thể nhiều chữ cái, cách nhau bởi dấu phẩy.', answer: 'A, C' },
  { type: 'Đúng/Sai', how: 'Để trống các cột lựa chọn; Đáp án đúng ghi Đúng hoặc Sai.', answer: 'Đúng' },
  { type: 'Điền từ', how: 'Để trống các cột lựa chọn; Đáp án đúng là từ/cụm từ trẻ cần gõ (không phân biệt hoa thường, dấu câu).', answer: 'thấp' },
  { type: 'Số', how: 'Đáp án đúng là một số, hoặc một khoảng số "nhỏ..lớn" (mọi số trong khoảng đều đúng).', answer: '12  hoặc  11..19' },
  { type: 'Hình minh họa', how: 'Cột Hình minh họa: link https://… (cần mạng), hoặc tên tệp ảnh trong public/assets/images (dùng được khi ngoại tuyến).', answer: 'vi-du-dong-ho.svg' },
];

/** "Danh mục gợi ý": common primary-school categories, also the source of the Danh mục dropdowns. Returns the dropdown's range formula. */
function buildSuggestionSheet(workbook: Workbook, suggestions: CategorySuggestion[]): string {
  const sheet = workbook.addWorksheet(SUGGESTION_SHEET);
  const specs = [
    { header: 'Môn', key: 'subject', width: 12, help: '' },
    { header: 'Lớp', key: 'grades', width: 10, help: '' },
    { header: 'Danh mục', key: 'name', width: 42, help: 'Tên gợi ý — chọn trong ô Danh mục ở trang Câu hỏi, hoặc tự gõ tên khác.' },
    { header: 'Dạng bài thường gặp', key: 'examples', width: 80, help: '' },
  ];
  sheet.columns = specs.map(({ header, key, width }) => ({ header, key, width, style: { alignment: { vertical: 'top', wrapText: true } } }));
  for (const s of suggestions) {
    sheet.addRow({ subject: SUBJECT_LABELS[s.subject], grades: gradesLabel(s.grades), name: s.name, examples: s.examples });
  }
  styleHeader(sheet, specs);
  return `'${SUGGESTION_SHEET}'!$C$2:$C$${suggestions.length + 1}`;
}

/** Dropdown of suggested names that still accepts any typed-in name (no error popup). */
function addSuggestionDropdown(sheet: Worksheet, col: number, lastRow: number, rangeFormula: string): void {
  for (let row = 2; row <= lastRow; row++) {
    sheet.getRow(row).getCell(col).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [rangeFormula],
      showErrorMessage: false,
      showInputMessage: true,
      promptTitle: 'Danh mục',
      prompt: 'Chọn tên gợi ý hoặc tự gõ tên danh mục khác.',
    };
  }
}

export interface XlsxExportOptions {
  /** Adds the "Danh mục gợi ý" sheet and category dropdowns (used by the downloadable template). */
  categorySuggestions?: CategorySuggestion[];
}

export async function quizPackageToXlsx(pkg: QuizPackage, options: XlsxExportOptions = {}): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Luyện Tập Mỗi Ngày';
  workbook.title = pkg.packageTitle ?? '';
  workbook.created = new Date();

  const allItems = [...pkg.quizzes, ...(pkg.passages ?? []).flatMap((p) => p.questions)];
  const maxChoices = Math.max(
    MIN_CHOICE_COLUMNS,
    ...allItems.map((i) => (CHOICE_TYPES.includes(i.type) ? (i.choices?.length ?? 0) : 0)),
  );
  const questionSpecs = [
    ...QUESTION_COLUMNS_BEFORE_CHOICES,
    ...choiceColumnSpecs(Math.min(maxChoices, LETTERS.length)),
    ...QUESTION_COLUMNS_AFTER_CHOICES,
  ];

  // --- Câu hỏi ---
  const questions = workbook.addWorksheet(QUESTION_SHEET);
  applyColumns(questions, questionSpecs);
  for (const item of pkg.quizzes) questions.addRow(questionRow(item));

  // Passage keys: a short, human-typable DV1, DV2… rather than the internal passage id.
  const passageKeys = (pkg.passages ?? []).map((_, i) => `DV${i + 1}`);
  (pkg.passages ?? []).forEach((passage, i) => {
    for (const q of passage.questions) questions.addRow(questionRow(q, passageKeys[i]));
  });
  styleHeader(questions, questionSpecs);

  const lastQuestionRow = questions.rowCount + EXTRA_VALIDATED_ROWS;
  const colOf = (field: string) => questionSpecs.findIndex((s) => s.field === field) + 1;
  addListValidation(questions, colOf('subject'), lastQuestionRow, Object.values(SUBJECT_LABELS), 'Chọn Toán hoặc Tiếng Việt.');
  addListValidation(questions, colOf('grade'), lastQuestionRow, ['1', '2', '3', '4', '5'], 'Lớp từ 1 đến 5.');
  addListValidation(
    questions,
    colOf('type'),
    lastQuestionRow,
    Object.entries(TYPE_LABELS)
      .filter(([type]) => type !== 'match-pairs')
      .map(([, label]) => label),
    'Chọn một loại câu hỏi trong danh sách.',
  );
  addListValidation(questions, colOf('difficulty'), lastQuestionRow, ['1', '2', '3', '4', '5'], 'Độ khó từ 1 đến 5.');
  addListValidation(questions, colOf('shuffle'), lastQuestionRow, ['Có', 'Không'], 'Chọn Có hoặc Không.');

  // --- Đoạn văn ---
  const passages = workbook.addWorksheet(PASSAGE_SHEET);
  applyColumns(passages, PASSAGE_COLUMNS);
  (pkg.passages ?? []).forEach((passage: QuizPackagePassage, i) => {
    passages.addRow({
      passageKey: passageKeys[i],
      subject: SUBJECT_LABELS[passage.subject],
      grade: passage.grade,
      category: passage.category?.name,
      title: passage.title,
      text: passage.text,
      imageUrl: passage.imageUrl,
    });
  });
  styleHeader(passages, PASSAGE_COLUMNS);
  const lastPassageRow = passages.rowCount + EXTRA_VALIDATED_ROWS;
  addListValidation(passages, 2, lastPassageRow, Object.values(SUBJECT_LABELS), 'Chọn Toán hoặc Tiếng Việt.');
  addListValidation(passages, 3, lastPassageRow, ['1', '2', '3', '4', '5'], 'Lớp từ 1 đến 5.');

  // --- Hướng dẫn ---
  buildGuideSheet(workbook, questionSpecs);

  // --- Danh mục gợi ý ---
  if (options.categorySuggestions?.length) {
    const range = buildSuggestionSheet(workbook, options.categorySuggestions);
    addSuggestionDropdown(questions, colOf('category'), lastQuestionRow, range);
    addSuggestionDropdown(passages, 4, lastPassageRow, range);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// Import: .xlsx → QuizPackage
// ---------------------------------------------------------------------------

export interface ExcelSourceRef {
  sheet: string;
  row: number;
}

export interface ExcelParseResult {
  pkg: QuizPackage;
  /** Human-readable, row-numbered issues found while reading the sheet (Vietnamese). */
  problems: string[];
  /** Where each `pkg.quizzes[i]` came from, for row-numbered error messages in the import preview. */
  quizSources: ExcelSourceRef[];
}

interface ParsedQuestion {
  row: number;
  passageKey?: string;
  item: QuizPackageItem;
}

function findSheet(workbook: Workbook, name: string): Worksheet | undefined {
  const wanted = normalizeKey(name);
  return workbook.worksheets.find((ws) => normalizeKey(ws.name) === wanted);
}

function applyAnswer(
  item: QuizPackageItem,
  answer: string,
  choices: Choice[],
  where: string,
  problems: string[],
): void {
  if (CHOICE_TYPES.includes(item.type)) {
    if (item.type === 'true-false' && choices.length === 0) {
      item.choices = TRUE_FALSE_CHOICES.map((c) => ({ ...c }));
      const value = parseBoolean(answer);
      if (value === undefined) {
        problems.push(`${where}: câu Đúng/Sai cần ghi "Đúng" hoặc "Sai" ở cột Đáp án đúng.`);
        item.correctAnswerIds = [];
      } else {
        item.correctAnswerIds = [value ? 'true' : 'false'];
      }
      return;
    }
    item.choices = choices;
    const letters = answer
      .toUpperCase()
      .split(/[\s,;/&+]+/)
      .filter(Boolean);
    const ids: string[] = [];
    for (const letter of letters) {
      const choice = choices.find((c) => c.id === letter.toLowerCase());
      if (choice) ids.push(choice.id);
      else problems.push(`${where}: đáp án "${letter}" không khớp với cột lựa chọn nào có nội dung.`);
    }
    item.correctAnswerIds = ids;
    return;
  }

  if (item.type === 'number') {
    for (const part of answer.split(/[;\n]+/).map((p) => p.trim()).filter(Boolean)) {
      const range = /^(-?\d+(?:[.,]\d+)?)\s*(?:\.\.|…|–|—|\s-\s|đến|den|to)\s*(-?\d+(?:[.,]\d+)?)$/i.exec(part);
      if (range) {
        const min = Number(toNumberString(range[1]));
        const max = Number(toNumberString(range[2]));
        item.acceptedRange = { min: Math.min(min, max), max: Math.max(min, max) };
      } else if (!Number.isNaN(Number(toNumberString(part)))) {
        item.acceptedAnswer = toNumberString(part);
      } else if (part.includes('/') && !Number.isNaN(parseNumberAnswer(part))) {
        item.acceptedAnswer = part; // a fraction or mixed number, kept as written: "7/2", "3 1/2"
      } else {
        problems.push(`${where}: "${part}" không phải là số, phân số hoặc khoảng số (ví dụ 12, 3 1/2 hoặc 10..20).`);
      }
    }
    return;
  }

  if (answer) item.acceptedAnswer = answer;
}

function parseQuestionSheet(sheet: Worksheet, problems: string[]): ParsedQuestion[] {
  const cols = columnIndex(sheet, [...QUESTION_COLUMNS_BEFORE_CHOICES, ...QUESTION_COLUMNS_AFTER_CHOICES]);
  const choiceCols = choiceColumns(sheet);
  const result: ParsedQuestion[] = [];

  if (!cols.has('prompt') || !cols.has('type')) {
    problems.push(`Trang "${sheet.name}": không tìm thấy cột "Nội dung câu hỏi" và/hoặc "Loại câu hỏi" ở dòng tiêu đề (dòng 1).`);
    return result;
  }

  for (let row = 2; row <= sheet.rowCount; row++) {
    if (isRowEmpty(sheet, row)) continue;
    const where = `Trang "${sheet.name}" dòng ${row}`;
    const get = (field: QuestionField) => cellText(sheet, row, cols.get(field));

    const typeText = get('type');
    const type = parseType(typeText);
    if (!type) {
      problems.push(`${where}: loại câu hỏi "${typeText}" không hợp lệ — dòng này bị bỏ qua.`);
      continue;
    }
    const prompt = get('prompt');
    if (!prompt) {
      problems.push(`${where}: thiếu nội dung câu hỏi — dòng này bị bỏ qua.`);
      continue;
    }

    const item: QuizPackageItem = { type, prompt };
    const passageKey = get('passageKey') || undefined;

    const externalId = get('externalId');
    if (externalId) item.externalId = externalId;

    const subjectText = get('subject');
    if (subjectText) {
      item.subject = parseSubject(subjectText);
      if (!item.subject) problems.push(`${where}: môn "${subjectText}" không hợp lệ (Toán hoặc Tiếng Việt).`);
    }
    const gradeText = get('grade');
    if (gradeText) {
      item.grade = parseGrade(gradeText);
      if (item.grade === undefined) problems.push(`${where}: lớp "${gradeText}" không hợp lệ (1–5).`);
    }
    const categoryName = get('category');
    if (categoryName) item.category = { name: categoryName };

    const imageUrl = get('imageUrl');
    if (imageUrl) item.imageUrl = imageUrl;
    const explanation = get('explanation');
    if (explanation) item.explanation = explanation;

    const difficultyText = get('difficulty');
    if (difficultyText) {
      item.difficulty = parseDifficulty(difficultyText);
      if (item.difficulty === undefined) problems.push(`${where}: độ khó "${difficultyText}" không hợp lệ (1–5) — dùng mặc định.`);
    }
    const pointsText = get('points');
    if (pointsText) {
      const points = Number(toNumberString(pointsText));
      if (Number.isFinite(points) && points >= 0) item.points = points;
      else problems.push(`${where}: điểm "${pointsText}" không phải là số — dùng mặc định.`);
    }
    const tags = get('tags')
      .split(/[;\n]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length) item.tags = tags;
    const shuffleText = get('shuffle');
    if (shuffleText) item.shuffleChoices = parseBoolean(shuffleText);

    const choices: QuizPackageChoice[] = [];
    for (const [letter, col] of [...choiceCols.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const cell = cellText(sheet, row, col);
      if (!cell) continue;
      const { text, imageUrl } = parseChoiceCell(cell);
      choices.push(imageUrl ? { id: letter.toLowerCase(), text, imageUrl } : { id: letter.toLowerCase(), text });
    }
    applyAnswer(item, get('answer'), choices, where, problems);

    result.push({ row, passageKey, item });
  }
  return result;
}

function parsePassageSheet(
  sheet: Worksheet | undefined,
  questions: ParsedQuestion[],
  problems: string[],
): QuizPackagePassage[] {
  const byKey = new Map<string, ParsedQuestion[]>();
  for (const q of questions) {
    if (!q.passageKey) continue;
    const key = normalizeKey(q.passageKey);
    byKey.set(key, [...(byKey.get(key) ?? []), q]);
  }
  const used = new Set<string>();
  const passages: QuizPackagePassage[] = [];

  if (sheet) {
    const cols = columnIndex(sheet, PASSAGE_COLUMNS);
    for (let row = 2; row <= sheet.rowCount; row++) {
      if (isRowEmpty(sheet, row)) continue;
      const where = `Trang "${sheet.name}" dòng ${row}`;
      const get = (field: PassageField) => cellText(sheet, row, cols.get(field));

      const keyText = get('passageKey');
      const key = normalizeKey(keyText);
      if (!key) {
        problems.push(`${where}: thiếu "Mã đoạn văn" — đoạn văn này bị bỏ qua.`);
        continue;
      }
      if (used.has(key)) {
        problems.push(`${where}: "Mã đoạn văn" ${keyText} bị trùng — đoạn văn này bị bỏ qua.`);
        continue;
      }
      used.add(key);

      const subject = parseSubject(get('subject'));
      const grade = parseGrade(get('grade'));
      const title = get('title');
      const text = get('text');
      const qs = byKey.get(key) ?? [];
      const missing = [
        !subject && 'Môn (Toán/Tiếng Việt)',
        grade === undefined && 'Lớp (1–5)',
        !title && 'Tiêu đề',
        !text && 'Nội dung',
      ].filter(Boolean);
      if (missing.length) {
        problems.push(`${where}: thiếu hoặc sai ${missing.join(', ')} — đoạn văn ${keyText} và ${qs.length} câu hỏi của nó bị bỏ qua.`);
        continue;
      }
      if (qs.length < 2) {
        problems.push(`${where}: đoạn văn ${keyText} cần ít nhất 2 câu hỏi ở trang "${QUESTION_SHEET}" (đang có ${qs.length}) — bị bỏ qua.`);
        continue;
      }

      const categoryName = get('category');
      const imageUrl = get('imageUrl');
      passages.push({
        externalKey: keyText,
        subject: subject!,
        grade: grade!,
        category: categoryName ? { name: categoryName } : undefined,
        title,
        text,
        imageUrl: imageUrl || undefined,
        questions: qs.map((q) => q.item),
      });
    }
  }

  for (const [key, qs] of byKey) {
    if (used.has(key)) continue;
    const rows = qs.map((q) => q.row).join(', ');
    problems.push(`Trang "${QUESTION_SHEET}" dòng ${rows}: "Mã đoạn văn" ${qs[0].passageKey} không có ở trang "${PASSAGE_SHEET}" — các dòng này bị bỏ qua.`);
  }
  return passages;
}

export async function xlsxToQuizPackage(data: ArrayBuffer, packageTitle?: string): Promise<ExcelParseResult> {
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as Parameters<typeof workbook.xlsx.load>[0]);

  const problems: string[] = [];
  const questionSheet =
    findSheet(workbook, QUESTION_SHEET) ??
    workbook.worksheets.find(
      (ws) => ![PASSAGE_SHEET, GUIDE_SHEET, SUGGESTION_SHEET].some((name) => normalizeKey(ws.name) === normalizeKey(name)),
    );
  if (!questionSheet) {
    problems.push(`Không tìm thấy trang "${QUESTION_SHEET}" trong tệp Excel.`);
    return { pkg: { formatVersion: '1.1', packageTitle, language: 'vi', quizzes: [] }, problems, quizSources: [] };
  }

  const questions = parseQuestionSheet(questionSheet, problems);
  const passages = parsePassageSheet(findSheet(workbook, PASSAGE_SHEET), questions, problems);
  const standalone = questions.filter((q) => !q.passageKey);

  return {
    pkg: {
      formatVersion: '1.1',
      packageTitle,
      language: 'vi',
      quizzes: standalone.map((q) => q.item),
      passages: passages.length ? passages : undefined,
    },
    problems,
    quizSources: standalone.map((q) => ({ sheet: questionSheet.name, row: q.row })),
  };
}
