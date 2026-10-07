import { expect, it } from 'vitest';
import { BIKES, MAX_RIDE_SPEED } from '../app/domain/config';
import { speedometerKmh } from '../app/domain/speedometer';
import { distanceAtTime, speedAtTime } from '../app/game/world';
it('raises the displayed Sport maximum without raising its existing physical speed', () => {
  const sport = BIKES.find(bike => bike.id === '701')!;
  expect(sport.maxSpeed * 3.6).toBeCloseTo(140);
  expect(speedometerKmh(sport.maxSpeed)).toBe(180);
  expect(speedometerKmh(0)).toBe(0);
  for (let i = 1; i < BIKES.length; i++) expect(speedometerKmh(BIKES[i].maxSpeed)).toBeGreaterThan(speedometerKmh(BIKES[i - 1].maxSpeed));
  expect(sport.maxSpeed).toBe(MAX_RIDE_SPEED);
});

it('preserves the historical Sport travel pace independently of the faster-reading display', () => {
  const sport = BIKES.find(bike => bike.id === '701')!;
  // Before the instrument change: 22 m/s start, 0.28 m/s² acceleration, 140 km/h cap.
  for (const [seconds, speed, metres] of [[10, 24.8, 234], [30, 30.4, 786], [60, 38.8, 1824]]) {
    expect(speedAtTime(seconds, sport)).toBeCloseTo(speed, 9);
    expect(distanceAtTime(seconds, sport)).toBeCloseTo(metres, 9);
  }
  expect(speedAtTime(300, sport)).toBeCloseTo(140 / 3.6, 9);
  expect(speedometerKmh(speedAtTime(300, sport))).toBe(180);
  for (const seconds of [10, 30, 60, 120, 300]) for (let i = 1; i < BIKES.length; i++) {
    expect(speedAtTime(seconds, BIKES[i - 1])).toBeLessThan(speedAtTime(seconds, BIKES[i]));
    expect(distanceAtTime(seconds, BIKES[i - 1])).toBeLessThan(distanceAtTime(seconds, BIKES[i]));
  }
});
