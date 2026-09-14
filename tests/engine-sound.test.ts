import { describe, expect, it } from 'vitest';
import { BIKES } from '../app/domain/config';
import { ENGINE_SOUNDS, engineRPM, soundId } from '../app/game/engineSound';

describe('vehicle engine identities', () => {
  it('resolves every playable bike to an explicit sound profile', () => {
    for (const bike of BIKES) {
      expect(soundId(bike.id)).toBe(bike.id);
      const profile = ENGINE_SOUNDS[soundId(bike.id)];
      expect(profile.level).toBeGreaterThan(0);
      expect(profile.noiseBand).toBeGreaterThan(0);
    }
    for (const unknown of ['missing-bike', '__proto__', 'toString'])
      expect(soundId(unknown)).toBe('450');
  });

  it('gives the Roller a distinct 50cc two-stroke combustion and transmission voice', () => {
    const scooter = ENGINE_SOUNDS.scooter;
    expect(scooter.name).toBe('50cc CVT two-stroke');
    expect(scooter.firingPerRevolution).toBe(1);
    expect(scooter).not.toEqual(ENGINE_SOUNDS['125']);
    expect(scooter.noiseBand).not.toBe(ENGINE_SOUNDS['125'].noiseBand);
    expect(scooter.mechanicalRatio).not.toBe(
      ENGINE_SOUNDS['450'].mechanicalRatio,
    );
    expect(scooter.firingPerRevolution).not.toBe(
      ENGINE_SOUNDS['701'].firingPerRevolution,
    );
  });

  it('takes up the clutch then holds a smooth CVT power band without gear-shift drops', () => {
    expect(
      engineRPM('scooter', 16, true) - engineRPM('scooter', 0, true),
    ).toBeGreaterThan(3000);
    const rpms = Array.from({ length: 27 }, (_, index) =>
      engineRPM('scooter', 16 + index, true),
    );
    for (let index = 1; index < rpms.length; index++) {
      expect(rpms[index]).toBeGreaterThanOrEqual(rpms[index - 1]);
      expect(rpms[index] - rpms[index - 1]).toBeLessThan(50);
    }
    expect(rpms.at(-1)! - rpms[0]).toBeLessThan(1000);
    expect(engineRPM('scooter', 30, true)).toBeGreaterThan(
      engineRPM('scooter', 30, false),
    );
    expect(engineRPM('scooter', 30, false, true)).toBeLessThan(
      engineRPM('scooter', 30, false),
    );
  });

  it('keeps every voice finite and bounded across playable speed and input combinations', () => {
    for (const bike of BIKES)
      for (const speed of [0, 5, 16, 22, bike.maxSpeed])
        for (const throttle of [false, true])
          for (const forward of [false, true]) {
            const rpm = engineRPM(soundId(bike.id), speed, throttle, forward);
            expect(Number.isFinite(rpm)).toBe(true);
            expect(rpm).toBeGreaterThanOrEqual(1600);
            expect(rpm).toBeLessThanOrEqual(14500);
          }
  });
});
