/** World metres and seconds. Traffic never changes the player's chosen arc. */
export const TOW_TRANSFER = Object.freeze({
  launchVelocity: 5.85,
  gravity: 14,
  landingGravity: 34,
  landingAfter: 0.6,
  lateralSeconds: 0.58,
  minimumTakeoffHeight: 1.02,
});
const smooth = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * t * (10 + t * (-15 + 6 * t));
};
export function transferX(from: number, to: number, seconds: number) {
  return from + (to - from) * smooth(seconds / TOW_TRANSFER.lateralSeconds);
}
