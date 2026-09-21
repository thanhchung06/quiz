/**
 * JSON Schema for the AI quiz package format, matching
 * contracts/quiz-package-format.md exactly (FR-025, FR-026, FR-073–075).
 */
const QUIZ_PACKAGE_ITEM_PROPERTIES = {
  externalId: { type: 'string' },
  subject: { enum: ['math', 'language'] },
  grade: { type: 'integer', minimum: 1, maximum: 5 },
  category: {
    type: 'object',
    properties: {
      externalKey: { type: 'string' },
      name: { type: 'string' },
      subject: { enum: ['math', 'language'] },
    },
  },
  tags: { type: 'array', items: { type: 'string' } },
  difficulty: { type: 'integer', minimum: 1, maximum: 5 },
  type: {
    enum: ['single-choice', 'short-text', 'number', 'multiple-choice', 'true-false', 'match-pairs'],
  },
  prompt: { type: 'string', minLength: 1 },
  choices: {
    type: 'array',
    items: {
      type: 'object',
      required: ['id', 'text'],
      properties: { id: { type: 'string' }, text: { type: 'string' } },
    },
  },
  correctAnswerIds: { type: 'array', items: { type: 'string' } },
  acceptedAnswer: { type: 'string' },
  acceptedRange: {
    type: 'object',
    properties: { min: { type: 'number' }, max: { type: 'number' } },
  },
  shuffleChoices: { type: 'boolean' },
  explanation: { type: 'string' },
  points: { type: 'number' },
} as const;

export const QUIZ_PACKAGE_SCHEMA = {
  $id: 'quiz-package.schema.json',
  type: 'object',
  required: ['formatVersion', 'quizzes'],
  definitions: {
    // subject/grade are NOT required here: a question nested under a
    // passage may omit them and inherit the passage's own subject/grade
    // (normalized in package-validator.service.ts before validation runs).
    // Only prompt/type are always required, top-level or nested.
    quizPackageItem: {
      type: 'object',
      required: ['type', 'prompt'],
      properties: QUIZ_PACKAGE_ITEM_PROPERTIES,
    },
  },
  properties: {
    formatVersion: { type: 'string' },
    packageTitle: { type: 'string' },
    language: { type: 'string' },
    quizzes: {
      type: 'array',
      items: { $ref: '#/definitions/quizPackageItem' },
    },
    passages: {
      type: 'array',
      items: {
        type: 'object',
        required: ['subject', 'grade', 'title', 'text', 'questions'],
        properties: {
          externalKey: { type: 'string' },
          subject: { enum: ['math', 'language'] },
          grade: { type: 'integer', minimum: 1, maximum: 5 },
          category: {
            type: 'object',
            properties: {
              externalKey: { type: 'string' },
              name: { type: 'string' },
              subject: { enum: ['math', 'language'] },
            },
          },
          title: { type: 'string', minLength: 1 },
          text: { type: 'string', minLength: 1 },
          questions: {
            type: 'array',
            minItems: 2,
            items: { $ref: '#/definitions/quizPackageItem' },
          },
        },
      },
    },
  },
} as const;
