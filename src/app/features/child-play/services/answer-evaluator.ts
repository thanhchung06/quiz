import { AnswerRule, QuizItem } from '../../../shared/models/domain.model';

/**
 * Evaluates a submitted answer against a QuizItem's answerRule. Correctness
 * for choice-based types is always resolved by choice id, never position
 * (FR-038 / spec note under QB 04), so shuffling never affects scoring.
 */
export function evaluateAnswer(item: QuizItem, submitted: unknown): boolean {
  const rule: AnswerRule = item.answerRule;
  switch (rule.kind) {
    case 'choice': {
      const submittedIds = Array.isArray(submitted) ? (submitted as string[]) : [submitted as string];
      const correct = new Set(rule.correctChoiceIds);
      return (
        submittedIds.length === correct.size && submittedIds.every((id) => correct.has(id))
      );
    }
    case 'text': {
      let a = String(submitted ?? '').trim();
      let b = rule.acceptedAnswer.trim();
      if (!rule.caseSensitive) {
        a = a.toLowerCase();
        b = b.toLowerCase();
      }
      if (!rule.punctuationSensitive) {
        const stripPunct = (s: string) => s.replace(/[.,!?;:'"()]/g, '');
        a = stripPunct(a);
        b = stripPunct(b);
      }
      return a === b;
    }
    case 'number': {
      const value = Number(submitted);
      if (Number.isNaN(value)) return false;
      if (rule.acceptedValue !== undefined) return value === rule.acceptedValue;
      if (rule.min !== undefined && rule.max !== undefined) return value >= rule.min && value <= rule.max;
      return false;
    }
    case 'boolean':
      return Boolean(submitted) === rule.correctValue;
    case 'pairs': {
      const submittedPairs = submitted as Array<{ leftId: string; rightId: string }>;
      if (!Array.isArray(submittedPairs) || submittedPairs.length !== rule.pairs.length) return false;
      const expected = new Map(rule.pairs.map((p) => [p.leftId, p.rightId]));
      return submittedPairs.every((p) => expected.get(p.leftId) === p.rightId);
    }
    default:
      return false;
  }
}
