export const ENGINE_SOUNDS = {
  '125': {
    name: 'Tuned 50cc two-stroke',
    firingPerRevolution: 1,
    harmonicFalloff: 0.62,
    cutoff: 2300,
    noise: 0.012,
    level: 0.066,
    harmonicDecay: 0.015,
    phaseOffset: 0.45,
    mechanicalWave: 'sine',
    resonance: 1.6,
    noiseBand: 1900,
    mechanicalRatio: 2.03,
  },
  scooter: {
    name: '50cc CVT two-stroke',
    firingPerRevolution: 1,
    harmonicFalloff: 0.78,
    cutoff: 1900,
    noise: 0.01,
    level: 0.063,
    harmonicDecay: 0.022,
    phaseOffset: 0.36,
    mechanicalWave: 'sine',
    resonance: 1.25,
    noiseBand: 1550,
    mechanicalRatio: 1.52,
  },
  '450': {
    name: 'Four-stroke single',
    firingPerRevolution: 0.5,
    harmonicFalloff: 0.85,
    cutoff: 1000,
    noise: 0.007,
    level: 0.095,
    harmonicDecay: 0.04,
    phaseOffset: 0.12,
    mechanicalWave: 'sine',
    resonance: 0.7,
    noiseBand: 650,
    mechanicalRatio: 1.01,
  },
  '701': {
    name: '1000cc four-stroke inline-four',
    firingPerRevolution: 2,
    harmonicFalloff: 1.45,
    cutoff: 3600,
    noise: 0.005,
    level: 0.072,
    harmonicDecay: 0.015,
    phaseOffset: 0.12,
    mechanicalWave: 'triangle',
    resonance: 0.7,
    noiseBand: 3200,
    mechanicalRatio: 1.01,
  },
} as const;
export type EngineSoundId = keyof typeof ENGINE_SOUNDS;
export function soundId(id: string): EngineSoundId {
  return Object.hasOwn(ENGINE_SOUNDS, id) ? (id as EngineSoundId) : '450';
}
export function engineRPM(
  id: EngineSoundId,
  speed: number,
  throttle: boolean,
  forward = false,
) {
  const load = throttle ? 1 : forward ? -0.35 : 0;
  if (id === '125')
    return Math.max(1600, Math.min(10800, 2800 + speed * 165 + load * 900));
  if (id === 'scooter') {
    // The centrifugal clutch takes up first, then the CVT holds the power band
    // as road speed rises. No stepped gearbox pitch drops on the scooter.
    const clutch = Math.max(0, Math.min(16, speed));
    return Math.max(
      1800,
      Math.min(
        10200,
        2000 + clutch * 260 + Math.max(0, speed - 16) * 28 + load * 1200,
      ),
    );
  }
  if (id === '450') {
    const gear = Math.max(0, Math.floor((speed - 12) / 12));
    return Math.max(
      1700,
      Math.min(9600, 2000 + speed * 220 * 0.78 ** gear + load * 1100),
    );
  }
  const gear = Math.max(0, Math.floor((speed - 15) / 14));
  return Math.max(
    1700,
    Math.min(14500, 3600 + speed * 240 * 0.82 ** gear + load * 1900),
  );
}
