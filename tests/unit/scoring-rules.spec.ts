import { bonusFor, outcomeOf, starsFor } from '../../src/app/features/child-play/services/scoring.service';

describe('stars and bonus (plan §3.5)', () => {
  it('3 stars only for all correct; 2 from halfway between pass rate and 100 (rounded down); 1 from the pass rate', () => {
    expect(starsFor(10, 10, 60)).toBe(3);
    expect(starsFor(8, 10, 60)).toBe(2); // 80% >= (60+100)/2
    expect(starsFor(7, 10, 60)).toBe(1);
    expect(starsFor(5, 10, 60)).toBe(0);
    expect(starsFor(87, 100, 75)).toBe(2); // (75+100)/2 = 87.5 → 87
    expect(starsFor(86, 100, 75)).toBe(1);
  });

  it('without a pass rate: 80% for 2 stars, anything else is 1 star (every try passes)', () => {
    expect(starsFor(8, 10, 0)).toBe(2);
    expect(starsFor(0, 10, 0)).toBe(1);
  });

  it('bonus +50% for 3 stars, +25% for 2, rounded down', () => {
    expect(bonusFor(45, 2)).toBe(11);
    expect(bonusFor(45, 3)).toBe(22);
    expect(bonusFor(45, 1)).toBe(0);
    expect(outcomeOf(45, 8, 10, 60, false)).toEqual({ stars: 2, bonus: 11, pointsEarned: 56, passed: true });
  });

  it('an abandoned try never passes', () => {
    expect(outcomeOf(100, 10, 10, 0, true)).toEqual({ stars: 0, bonus: 0, pointsEarned: 100, passed: false });
  });
});
