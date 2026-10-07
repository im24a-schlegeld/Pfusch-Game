import { expect, it } from 'vitest';
import { BIKES, MAX_RIDE_SPEED } from '../app/domain/config';
import { speedometerKmh } from '../app/domain/speedometer';
it('raises the displayed Sport maximum without raising its existing physical speed', () => {
  const sport = BIKES.find(bike => bike.id === '701')!;
  expect(sport.maxSpeed * 3.6).toBeCloseTo(140);
  expect(speedometerKmh(sport.maxSpeed)).toBe(180);
  expect(speedometerKmh(0)).toBe(0);
  for (let i = 1; i < BIKES.length; i++) expect(speedometerKmh(BIKES[i].maxSpeed)).toBeGreaterThan(speedometerKmh(BIKES[i - 1].maxSpeed));
  expect(sport.maxSpeed).toBe(MAX_RIDE_SPEED);
});
