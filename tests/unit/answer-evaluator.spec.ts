import { evaluateAnswer, parseNumberAnswer } from '../../src/app/features/child-play/services/answer-evaluator';
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
});
