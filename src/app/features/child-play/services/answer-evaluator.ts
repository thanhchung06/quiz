import { AnswerRule, QuizItem } from '../../../shared/models/domain.model';

/** One plain number, Vietnamese style: "3,5", "10 000", "1.000,5", or "3.5". NaN otherwise. */
function parseDecimal(input: string): number {
  let s = input.replace(/\s+/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN;
}

/**
 * Reads a typed number the way a Vietnamese pupil writes it: comma as the
 * decimal separator ("3,5"), spaces or dots as thousands separators
 * ("10 000", "1.000,5"), a fraction ("7/2") or a mixed number ("3 1/2",
 * "-3 1/2"). A plain "3.5" (no comma) still reads as 3.5.
 * Returns NaN for anything that isn't a number.
 */
export function parseNumberAnswer(input: unknown): number {
  if (typeof input === 'number') return input;
  const s = String(input ?? '').trim();
  const fraction = /^(-)?\s*(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (fraction) {
    const [, minus, whole, numerator, denominator] = fraction;
    if (Number(denominator) === 0) return NaN;
    const value = Number(whole ?? 0) + Number(numerator) / Number(denominator);
    return minus ? -value : value;
  }
  return parseDecimal(s);
}

/** A number rule's answer as the parent wrote it ("3 1/2"), not as the stored value (3.5). */
export function numberAnswerText(rule: { acceptedValue?: number; acceptedText?: string }): string {
  return rule.acceptedText ?? (rule.acceptedValue !== undefined ? String(rule.acceptedValue) : '');
}

/** The number rule for an answer typed by the parent; `acceptedText` keeps a fraction's spelling for display. */
export function numberRuleFromText(text: string): { kind: 'number'; acceptedValue?: number; acceptedText?: string } {
  const trimmed = text.trim();
  const value = parseNumberAnswer(trimmed);
  if (!trimmed || Number.isNaN(value)) return { kind: 'number' };
  return trimmed.includes('/') ? { kind: 'number', acceptedValue: value, acceptedText: trimmed } : { kind: 'number', acceptedValue: value };
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
