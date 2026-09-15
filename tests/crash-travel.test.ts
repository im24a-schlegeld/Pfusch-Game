import { expect, it } from 'vitest';
import { createCrashTravel } from '../app/game/crashTravel';

it('keeps immediate forward inertia for an unblocked fall, with progressive slowing', () => {
  const fall = createCrashTravel(25, false, false);
  expect(fall.speed).toBe(25);
  fall.advance(1 / 60, true);
  expect(fall.distance).toBeGreaterThan(0.39);
  const earlySpeed = fall.speed;
  for (let i = 0; i < 60; i++) fall.advance(1 / 60, true);
  expect(fall.speed).toBeLessThan(earlySpeed / 10);
  expect(fall.distance).toBeGreaterThan(7);
});
it('freezes visual travel while inactive and reduces impact/reduced-motion travel', () => {
  const fall = createCrashTravel(25, false, false),
    impact = createCrashTravel(25, true, false);
  fall.advance(0.1, true);
  impact.advance(0.1, true);
  expect(impact.distance).toBeLessThan(fall.distance / 3);
  const before = fall.distance;
  fall.advance(0.1, false);
  expect(fall.distance).toBe(before);
  const reduced = createCrashTravel(25, false, true);
  reduced.advance(0.1, true);
  expect(reduced.distance).toBe(0);
});
