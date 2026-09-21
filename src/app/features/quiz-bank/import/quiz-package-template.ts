import { QuizPackage, QuizPackagePassage } from './quiz-package.model';

/**
 * Downloadable reference package (FR-025): one example per well-defined,
 * fully-playable item type (single-choice, multiple-choice, true-false,
 * short-text, number — match-pairs is excluded since the app has no
 * child-play screen for it yet, a pre-existing gap), matching
 * contracts/quiz-package-format.md exactly.
 *
 * The passage example below deliberately mixes all five of those types
 * about the same reading text, to show that a passage group isn't limited
 * to any one question type.
 *
 * true-false is graded like any other choice item (by choice id membership
 * in correctAnswerIds), so the literal ids "true"/"false" below are just a
 * clear, stable convention for AI-authored packages — not a hard grading
 * requirement.
 */
const PASSAGE_EXAMPLE: QuizPackagePassage = {
  subject: 'language',
  grade: 3,
  category: { name: 'Đọc hiểu', subject: 'language' },
  title: 'Con mèo của Lan',
  text: 'Lan có một con mèo tên là Mimi. Mimi có bộ lông màu trắng và đôi mắt xanh biếc. Mỗi sáng, Mimi thường nằm ngủ trên bậu cửa sổ, đón nắng ấm. Lan rất yêu quý Mimi và luôn cho nó ăn đúng giờ.',
  questions: [
    {
      type: 'single-choice',
      prompt: 'Con mèo trong bài tên là gì?',
      choices: [
        { id: 'a', text: 'Mimi' },
        { id: 'b', text: 'Lan' },
        { id: 'c', text: 'Miu' },
      ],
      correctAnswerIds: ['a'],
      points: 10,
    },
    {
      type: 'multiple-choice',
      prompt: 'Mimi có những đặc điểm nào dưới đây?',
      choices: [
        { id: 'a', text: 'Lông màu trắng' },
        { id: 'b', text: 'Mắt xanh biếc' },
        { id: 'c', text: 'Lông màu đen' },
        { id: 'd', text: 'Thích bơi lội' },
      ],
      correctAnswerIds: ['a', 'b'],
      points: 10,
    },
    {
      type: 'true-false',
      prompt: 'Mimi thường nằm ngủ trên bậu cửa sổ mỗi sáng. Đúng hay Sai?',
      choices: [
        { id: 'true', text: 'Đúng' },
        { id: 'false', text: 'Sai' },
      ],
      correctAnswerIds: ['true'],
      points: 10,
    },
    {
      type: 'short-text',
      prompt: 'Mimi thường nằm ngủ ở đâu mỗi sáng?',
      acceptedAnswer: 'bậu cửa sổ',
      explanation: 'Bài văn viết: "Mỗi sáng, Mimi thường nằm ngủ trên bậu cửa sổ".',
      points: 10,
    },
    {
      type: 'number',
      prompt: 'Bài văn nhắc đến bao nhiêu con mèo?',
      acceptedAnswer: '1',
      points: 10,
    },
  ],
};

export const QUIZ_PACKAGE_TEMPLATE: QuizPackage = {
  formatVersion: '1.1',
  packageTitle: 'Mẫu gói câu hỏi',
  language: 'vi',
  passages: [PASSAGE_EXAMPLE],
  quizzes: [
    {
      subject: 'math',
      grade: 2,
      category: { name: 'Phép cộng', subject: 'math' },
      tags: ['cong', 'trong-pham-vi-20'],
      difficulty: 1,
      type: 'single-choice',
      prompt: '5 + 3 = ?',
      choices: [
        { id: 'a', text: '7' },
        { id: 'b', text: '8' },
        { id: 'c', text: '9' },
      ],
      correctAnswerIds: ['b'],
      shuffleChoices: true,
      explanation: '5 + 3 = 8.',
      points: 10,
    },
    {
      subject: 'math',
      grade: 2,
      category: { name: 'Số chẵn lẻ', subject: 'math' },
      difficulty: 2,
      type: 'multiple-choice',
      prompt: 'Chọn tất cả các số chẵn.',
      choices: [
        { id: 'a', text: '2' },
        { id: 'b', text: '3' },
        { id: 'c', text: '4' },
        { id: 'd', text: '5' },
      ],
      correctAnswerIds: ['a', 'c'],
      shuffleChoices: true,
      points: 10,
    },
    {
      subject: 'math',
      grade: 1,
      category: { name: 'So sánh số', subject: 'math' },
      difficulty: 1,
      type: 'true-false',
      prompt: '10 lớn hơn 7. Đúng hay Sai?',
      choices: [
        { id: 'true', text: 'Đúng' },
        { id: 'false', text: 'Sai' },
      ],
      correctAnswerIds: ['true'],
      points: 10,
    },
    {
      subject: 'language',
      grade: 3,
      category: { name: 'Từ vựng', subject: 'language' },
      difficulty: 2,
      type: 'short-text',
      prompt: 'Trái nghĩa của "cao" là gì?',
      acceptedAnswer: 'thấp',
      explanation: '"Cao" và "thấp" là hai từ trái nghĩa.',
      points: 10,
    },
    {
      subject: 'math',
      grade: 2,
      category: { name: 'Phép nhân', subject: 'math' },
      difficulty: 2,
      type: 'number',
      prompt: '4 x 3 = ?',
      acceptedAnswer: '12',
      points: 10,
    },
  ],
};
