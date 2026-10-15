import { expect, it } from 'vitest';
import { wheelieDurationMultiplier } from '../app/game/wheelie';

it('rewards long continuous wheelies and sustained risky angles without unlimited multipliers', () => {
  expect(wheelieDurationMultiplier(0, 0)).toBe(1);
  expect(wheelieDurationMultiplier(4, 0)).toBeGreaterThan(1);
  expect(wheelieDurationMultiplier(12, 0)).toBeGreaterThan(wheelieDurationMultiplier(4, 0));
  expect(wheelieDurationMultiplier(12, 5)).toBeGreaterThan(wheelieDurationMultiplier(12, 0));
  expect(wheelieDurationMultiplier(100, 100)).toBeCloseTo(2.5 * 2.2);
  expect(wheelieDurationMultiplier(Number.NaN, 2)).toBe(1);
});