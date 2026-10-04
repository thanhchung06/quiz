import { evaluateAnswer, numberAnswerText, numberRuleFromText, parseNumberAnswer } from '../../src/app/features/child-play/services/answer-evaluator';
import { QuizItem } from '../../src/app/shared/models/domain.model';

function numberItem(acceptedValue: number): QuizItem {
  return { type: 'number', answerRule: { kind: 'number', acceptedValue } } as QuizItem;
}

describe('number answers', () => {
  it('reads Vietnamese-style numbers', () => {
    expect(parseNumberAnswer('3,5')).toBe(3.5);
    expect(parseNumberAnswer(' 3.5 ')).toBe(3.5);
    expect(parseNumberAnswer('10 000')).toBe(10000);
    expect(parseNumberAnswer('1.000,25')).toBe(1000.25);
    expect(parseNumberAnswer('-12')).toBe(-12);
    expect(parseNumberAnswer('')).toBeNaN();
    expect(parseNumberAnswer('3,5,1')).toBeNaN();
    expect(parseNumberAnswer('abc')).toBeNaN();
  });

  it('grades a decimal answer typed with a comma or a dot', () => {
    expect(evaluateAnswer(numberItem(12.75), '12,75')).toBe(true);
    expect(evaluateAnswer(numberItem(12.75), '12.75')).toBe(true);
    expect(evaluateAnswer(numberItem(0.3), 0.1 + 0.2)).toBe(true);
    expect(evaluateAnswer(numberItem(12.75), '1275')).toBe(false);
    expect(evaluateAnswer(numberItem(56), 56)).toBe(true);
  });

  it('reads fractions and mixed numbers', () => {
    expect(parseNumberAnswer('7/2')).toBe(3.5);
    expect(parseNumberAnswer('3 1/2')).toBe(3.5);
    expect(parseNumberAnswer(' 3  1 / 2 ')).toBe(3.5);
    expect(parseNumberAnswer('-3 1/2')).toBe(-3.5);
    expect(parseNumberAnswer('1/0')).toBeNaN();
    expect(parseNumberAnswer('3 1/2/4')).toBeNaN();
  });

  it('keeps a fraction answer as written, and grades its equivalents', () => {
    const rule = numberRuleFromText('3 1/2');
    expect(rule).toEqual({ kind: 'number', acceptedValue: 3.5, acceptedText: '3 1/2' });
    expect(numberAnswerText(rule)).toBe('3 1/2');
    expect(numberRuleFromText('3,5')).toEqual({ kind: 'number', acceptedValue: 3.5 });
    expect(numberRuleFromText('abc')).toEqual({ kind: 'number' });
    const item = { type: 'number', answerRule: numberRuleFromText('1/3') } as QuizItem;
    expect(evaluateAnswer(item, '1/3')).toBe(true);
    expect(evaluateAnswer(item, '2/6')).toBe(true);
    expect(evaluateAnswer(numberItem(3.5), '3 1/2')).toBe(true);
    expect(evaluateAnswer(numberItem(3.5), '7/2')).toBe(true);
  });
});
