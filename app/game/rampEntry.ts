/** Entry response in rad/s. Bounded and spent once, never an angle reset. */
export function rampEntryImpulse(angle: number, closingSpeed: number): number {
  if (!Number.isFinite(angle) || !Number.isFinite(closingSpeed) || angle <= 0.12) return 0;
  const lift = Math.min(1, Math.max(0, (angle - 0.12) / 0.55));
  const impact = Math.min(1, Math.max(0, closingSpeed / 24));
  return lift * (0.16 + 0.12 * impact);
}
export function consumeRampImpulse(remaining: number, dt: number) {
  if (!Number.isFinite(remaining) || remaining <= 0) return { remaining: 0, applied: 0 };
  if (!Number.isFinite(dt) || dt <= 0) return { remaining, applied: 0 };
  const applied = remaining * (1 - Math.exp(-14 * Math.min(dt, 0.1)));
  return { remaining: remaining - applied, applied };
}
