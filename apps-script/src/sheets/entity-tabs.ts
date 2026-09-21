/**
 * The full spreadsheet structure (spec.md "Spreadsheet structure"): one tab
 * per entity type, all read/written through the generic row helpers in
 * generic-table.ts, since every entity shares the same (id, version, body)
 * shape once the sync envelope is factored out.
 */
export const ENTITY_TABS = [
  'Profiles',
  'Categories',
  'QuizItems',
  'QuizChoices',
  'Exercises',
  'ExerciseItems',
  'Assignments',
  'Rotations',
  'Attempts',
  'AnswerResults',
  'Rewards',
  'ChangeLog',
  'DeletedRecords',
] as const;

export type EntityTab = (typeof ENTITY_TABS)[number];
