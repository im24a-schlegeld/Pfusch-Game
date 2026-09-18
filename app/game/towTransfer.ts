/** Metres / seconds. Tuned for clearing normal cars without cartoon jumps. */
export const TOW_TRANSFER = Object.freeze({ launchVelocity: 8.1, lateralSeconds: 0.54 });
export function transferX(from: number, to: number, seconds: number) {
  const t = Math.max(0, Math.min(1, seconds / TOW_TRANSFER.lateralSeconds));
  const blend = t * t * t * (10 + t * (-15 + 6 * t));
  return from + (to - from) * blend;
}
