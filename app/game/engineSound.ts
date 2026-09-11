export const ENGINE_SOUNDS = {
  '125': {
    name: 'Tuned 50cc two-stroke',
    firingPerRevolution: 1,
    harmonicFalloff: 0.62,
    cutoff: 2300,
    noise: 0.012,
    level: 0.066,
  },
  '450': {
    name: 'Four-stroke single',
    firingPerRevolution: 0.5,
    harmonicFalloff: 0.85,
    cutoff: 1000,
    noise: 0.007,
    level: 0.095,
  },
  '701': {
    name: '1000cc four-stroke inline-four',
    firingPerRevolution: 2,
    harmonicFalloff: 1.45,
    cutoff: 3600,
    noise: 0.005,
    level: 0.072,
  },
} as const;
export type EngineSoundId = keyof typeof ENGINE_SOUNDS;
export function soundId(id: string): EngineSoundId {
  return id in ENGINE_SOUNDS ? (id as EngineSoundId) : '450';
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
