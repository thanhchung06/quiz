import { DuplicateDetectorService } from '../../src/app/features/quiz-bank/import/services/duplicate-detector.service';
import { QuizItemRepository } from '../../src/app/data/repositories/quiz-item.repository';
import { QuizItem } from '../../src/app/shared/models/domain.model';
import { QuizPackageItem } from '../../src/app/features/quiz-bank/import/quiz-package.model';

const existing = [
  {
    id: 'q1',
    prompt: 'Câu nào dưới đây là câu ghép?',
    choices: [
      { id: 'a', text: 'Trời mưa, đường trơn.' },
      { id: 'b', text: 'Em đi học.' },
    ],
  },
] as QuizItem[];

function detector(): DuplicateDetectorService {
  return new DuplicateDetectorService({ list: async () => existing } as unknown as QuizItemRepository);
}

describe('DuplicateDetectorService likely duplicates', () => {
  it('flags the same prompt with the same options (in any order, spacing, case)', async () => {
    const item = {
      prompt: '  câu nào dưới đây là câu ghép? ',
      choices: [
        { id: 'x', text: 'em đi học.' },
        { id: 'y', text: 'Trời  mưa, đường trơn.' },
      ],
    } as QuizPackageItem;
    expect(await detector().findDuplicates([item])).toEqual([{ index: 0, matchesExistingId: 'q1', reason: 'normalizedPrompt' }]);
  });

  it('does not flag a generic prompt reused with different options', async () => {
    const item = {
      prompt: 'Câu nào dưới đây là câu ghép?',
      choices: [
        { id: 'a', text: 'Chị ngã, em nâng.' },
        { id: 'b', text: 'Trên trời mây trắng như bông.' },
      ],
    } as QuizPackageItem;
    expect(await detector().findDuplicates([item])).toEqual([]);
  });
});
