import { describe, expect, it } from 'vitest';
import { SpeedCameraSchedule } from '../app/game/speedCamera';

const openRoad = () => true;

describe('score-based speed camera scheduling', () => {
  it('places the first camera ahead at 7,500 points and the next at 22,500', () => {
    const schedule = new SpeedCameraSchedule();
    schedule.update(7499, 1000, true, openRoad);
    expect(schedule.camera.active).toBe(false);
    schedule.update(7500, 1000, true, openRoad);
    expect(schedule.camera.active).toBe(true);
    expect(schedule.camera.distance).toBeGreaterThanOrEqual(1090);
    expect(schedule.camera.distance).toBeLessThanOrEqual(1198);
    const first = { ...schedule.camera };
    schedule.update(22499, first.distance + 30, true, openRoad);
    expect(schedule.camera.active).toBe(false);
    schedule.update(22500, first.distance + 35, true, openRoad);
    expect(schedule.camera.active).toBe(true);
    expect(schedule.camera.id).not.toBe(first.id);
    expect(schedule.camera.distance).toBeGreaterThan(first.distance + 35);
    expect(schedule.camera.triggered).toBe(false);
  });

  it('retains one stable camera and its one-shot flash state until it is passed', () => {
    const schedule = new SpeedCameraSchedule();
    schedule.update(7500, 1000, true, openRoad);
    const camera = schedule.camera;
    const placement = [camera.id, camera.distance, camera.side];
    camera.triggered = true;
    for (let distance = 1001; distance <= camera.distance + 10; distance++) {
      schedule.update(25000, distance, true, openRoad);
      expect(schedule.camera).toBe(camera);
      expect([camera.id, camera.distance, camera.side]).toEqual(placement);
      expect(camera.triggered).toBe(true);
    }
  });

  it('keeps a crossed score threshold pending while a pursuit is active', () => {
    const schedule = new SpeedCameraSchedule();
    schedule.update(7500, 1000, false, openRoad);
    schedule.update(9000, 1400, false, openRoad);
    expect(schedule.camera.active).toBe(false);
    schedule.update(9001, 1401, true, openRoad);
    expect(schedule.camera.active).toBe(true);
    expect(schedule.camera.distance).toBeGreaterThan(1401);
  });

  it('waits for an eligible roadside instead of losing the threshold in a tunnel', () => {
    const schedule = new SpeedCameraSchedule();
    schedule.update(7500, 1000, true, () => false);
    expect(schedule.camera.active).toBe(false);
    schedule.update(8200, 1200, true, (distance) => distance >= 1350);
    expect(schedule.camera.active).toBe(true);
    expect(schedule.camera.distance).toBeGreaterThanOrEqual(1350);
    expect(schedule.camera.distance).toBeLessThanOrEqual(1398);
  });

  it('uses deterministic placement and alternating road sides across threshold cycles', () => {
    const a = new SpeedCameraSchedule();
    const b = new SpeedCameraSchedule();
    const sides: number[] = [];
    for (let index = 0; index < 6; index++) {
      const score = 7500 + index * 15000;
      const distance = 1000 + index * 1000;
      for (const schedule of [a, b])
        schedule.update(score, distance, true, openRoad);
      expect(a.camera.active).toBe(true);
      expect(a.camera).toEqual(b.camera);
      sides.push(a.camera.side);
      for (const schedule of [a, b])
        schedule.update(score, schedule.camera.distance + 30, true, openRoad);
    }
    for (let index = 1; index < sides.length; index++)
      expect(sides[index]).toBe(-sides[index - 1]);
  });
});
