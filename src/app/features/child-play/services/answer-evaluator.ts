import { AnswerRule, QuizItem } from '../../../shared/models/domain.model';

/**
 * Reads a typed number the way a Vietnamese pupil writes it: comma as the
 * decimal separator ("3,5"), spaces or dots as thousands separators
 * ("10 000", "1.000,5"). A plain "3.5" (no comma) still reads as 3.5.
 * Returns NaN for anything that isn't a number.
 */
export function parseNumberAnswer(input: unknown): number {
  if (typeof input === 'number') return input;
  let s = String(input ?? '').trim().replace(/\s+/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN;
}

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
      const value = parseNumberAnswer(submitted);
      if (Number.isNaN(value)) return false;
      // Tolerance only absorbs floating-point noise (e.g. 0,1 + 0,2), never a genuinely different answer.
      if (rule.acceptedValue !== undefined) return Math.abs(value - rule.acceptedValue) < 1e-9;
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
