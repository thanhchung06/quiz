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
 *
 * The standalone quizzes give one short example per question type (number
 * twice: an exact answer and an accepted range), plus `imageUrl` examples —
 * a bare file name and a path under public/assets/images, and an internet
 * https:// link. Every category name comes from CATEGORY_SUGGESTIONS, which
 * the downloaded templates also list as suggestions.
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

/**
 * A public-domain photo (Wikimedia Commons) for the internet-image example.
 * Internet images need a connection to show; files in public/assets/images
 * are cached for offline use.
 */
const INTERNET_IMAGE_EXAMPLE = 'https://upload.wikimedia.org/wikipedia/commons/1/15/Red_Apple.jpg';

export const QUIZ_PACKAGE_TEMPLATE: QuizPackage = {
  formatVersion: '1.1',
  packageTitle: 'Mẫu gói câu hỏi',
  language: 'vi',
  passages: [PASSAGE_EXAMPLE],
  quizzes: [
    // --- Chọn một (single-choice): exactly one correct choice id ---
    {
      externalId: 'mau-chon-mot',
      subject: 'math',
      grade: 1,
      category: { name: 'Phép cộng, trừ', subject: 'math' },
      tags: ['cộng', 'trong phạm vi 10'],
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
    // --- Chọn nhiều (multiple-choice): one or more correct choice ids ---
    {
      externalId: 'mau-chon-nhieu',
      subject: 'language',
      grade: 4,
      category: { name: 'Danh từ, động từ, tính từ', subject: 'language' },
      difficulty: 2,
      type: 'multiple-choice',
      prompt: 'Chọn tất cả các danh từ trong nhóm từ sau.',
      choices: [
        { id: 'a', text: 'quyển sách' },
        { id: 'b', text: 'chạy' },
        { id: 'c', text: 'con mèo' },
        { id: 'd', text: 'xinh đẹp' },
      ],
      correctAnswerIds: ['a', 'c'],
      shuffleChoices: true,
      explanation: '"Quyển sách" và "con mèo" chỉ sự vật nên là danh từ; "chạy" là động từ, "xinh đẹp" là tính từ.',
      points: 10,
    },
    // --- Đúng/Sai (true-false): choices are always "true"/"false" ---
    {
      externalId: 'mau-dung-sai',
      subject: 'math',
      grade: 3,
      category: { name: 'Nhận biết hình', subject: 'math' },
      difficulty: 1,
      type: 'true-false',
      prompt: 'Hình vuông có 4 cạnh bằng nhau. Đúng hay Sai?',
      choices: [
        { id: 'true', text: 'Đúng' },
        { id: 'false', text: 'Sai' },
      ],
      correctAnswerIds: ['true'],
      points: 10,
    },
    // --- Điền từ (short-text): the child types a word; case/punctuation are ignored ---
    {
      externalId: 'mau-dien-tu',
      subject: 'language',
      grade: 3,
      category: { name: 'Từ đồng nghĩa, trái nghĩa', subject: 'language' },
      difficulty: 2,
      type: 'short-text',
      prompt: 'Từ trái nghĩa với "cao" là gì?',
      acceptedAnswer: 'thấp',
      explanation: '"Cao" và "thấp" là hai từ trái nghĩa.',
      points: 10,
    },
    {
      externalId: 'mau-chinh-ta',
      subject: 'language',
      grade: 2,
      category: { name: 'Chính tả', subject: 'language' },
      difficulty: 2,
      type: 'short-text',
      prompt: 'Điền "ch" hay "tr" vào chỗ trống: ...ăng sáng',
      acceptedAnswer: 'tr',
      explanation: 'Viết đúng là "trăng sáng".',
      points: 10,
    },
    // --- Số (number): one exact value in acceptedAnswer ---
    {
      externalId: 'mau-so',
      subject: 'math',
      grade: 2,
      category: { name: 'Bảng nhân, bảng chia', subject: 'math' },
      difficulty: 1,
      type: 'number',
      prompt: '4 × 3 = ?',
      acceptedAnswer: '12',
      points: 10,
    },
    // --- Số (number) with acceptedRange: any value from min to max is correct ---
    {
      externalId: 'mau-so-khoang',
      subject: 'math',
      grade: 1,
      category: { name: 'Đọc, viết, so sánh số', subject: 'math' },
      difficulty: 2,
      type: 'number',
      prompt: 'Viết một số lớn hơn 10 và nhỏ hơn 20.',
      acceptedRange: { min: 11, max: 19 },
      explanation: 'Các số từ 11 đến 19 đều đúng.',
      points: 10,
    },
    // --- Hình minh họa (imageUrl): a file name in public/assets/images ---
    {
      externalId: 'mau-anh-trong-ung-dung',
      subject: 'math',
      grade: 2,
      category: { name: 'Nhận biết hình', subject: 'math' },
      difficulty: 3,
      type: 'number',
      prompt: 'Hình bên có tất cả bao nhiêu hình vuông?',
      imageUrl: 'vi-du-hinh-vuong.svg',
      acceptedAnswer: '5',
      explanation: '4 hình vuông nhỏ và 1 hình vuông lớn bao quanh: 4 + 1 = 5.',
      points: 10,
    },
    {
      externalId: 'mau-anh-dong-ho',
      subject: 'math',
      grade: 1,
      category: { name: 'Xem đồng hồ, thời gian', subject: 'math' },
      difficulty: 1,
      type: 'single-choice',
      prompt: 'Đồng hồ chỉ mấy giờ?',
      imageUrl: 'assets/images/vi-du-dong-ho.svg',
      choices: [
        { id: 'a', text: '3 giờ' },
        { id: 'b', text: '12 giờ' },
        { id: 'c', text: '9 giờ' },
      ],
      correctAnswerIds: ['a'],
      explanation: 'Kim ngắn chỉ số 3, kim dài chỉ số 12: 3 giờ.',
      points: 10,
    },
    // --- Hình cho từng lựa chọn (choices[].imageUrl): options that are pictures ---
    {
      externalId: 'mau-anh-lua-chon',
      subject: 'math',
      grade: 1,
      category: { name: 'Nhận biết hình', subject: 'math' },
      difficulty: 1,
      type: 'single-choice',
      prompt: 'Hình nào là hình tam giác?',
      choices: [
        { id: 'a', text: '', imageUrl: 'vi-du-hinh-tron.svg' },
        { id: 'b', text: '', imageUrl: 'vi-du-hinh-tam-giac.svg' },
        { id: 'c', text: 'Hình chữ nhật', imageUrl: 'vi-du-hinh-chu-nhat.svg' },
      ],
      correctAnswerIds: ['b'],
      explanation: 'Hình tam giác có 3 cạnh và 3 góc.',
      points: 10,
    },
    // --- Hình minh họa (imageUrl): a picture from the internet (https://…) ---
    {
      externalId: 'mau-anh-internet',
      subject: 'language',
      grade: 1,
      category: { name: 'Mở rộng vốn từ', subject: 'language' },
      difficulty: 1,
      type: 'single-choice',
      prompt: 'Quả trong hình là quả gì?',
      imageUrl: INTERNET_IMAGE_EXAMPLE,
      choices: [
        { id: 'a', text: 'Quả táo' },
        { id: 'b', text: 'Quả cam' },
        { id: 'c', text: 'Quả chuối' },
      ],
      correctAnswerIds: ['a'],
      points: 10,
    },
  ],
};
