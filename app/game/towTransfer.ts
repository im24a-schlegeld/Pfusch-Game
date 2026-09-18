/** Metres / seconds. Separate lateral travel from take-off to clear an adjacent car. */
export const TOW_TRANSFER = Object.freeze({ launchVelocity: 12.5, lateralSeconds: 0.56 });
export function transferX(from: number, to: number, seconds: number) {
  const t = Math.max(0, Math.min(1, seconds / TOW_TRANSFER.lateralSeconds));
  const blend = t * t * t * (10 + t * (-15 + 6 * t));
  return from + (to - from) * blend;
}
