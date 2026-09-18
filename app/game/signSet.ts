import { SIGN_IDS, type SignId } from './signCollectibles';
export const COMPLETE_SIGN_MASK = (1 << SIGN_IDS.length) - 1;
export function signBit(id: SignId) { return 1 << SIGN_IDS.indexOf(id); }
export function nextMissingSign(
  mask: number, active: readonly { active: boolean; id: SignId }[], start: number,
): SignId | undefined {
  for (let offset = 0; offset < SIGN_IDS.length; offset++) {
    const id = SIGN_IDS[(start + offset) % SIGN_IDS.length];
    if (!(mask & signBit(id)) && !active.some(s => s.active && s.id === id)) return id;
  }
  return undefined;
}
export const SIGN_SCORE_MILESTONES = [14000, 30000, 48000, 68000, 88000, 108000] as const;
export const SIGN_DISTANCE_GAP = 1150;
export const SIGN_RETRY_DISTANCE = 650;
export function collectedSignCount(mask: number): number {
  let bits = mask & COMPLETE_SIGN_MASK, count = 0;
  while (bits) { count += bits & 1; bits >>>= 1; }
  return count;
}
export function signScoreReady(mask: number, score: number): boolean {
  const count = collectedSignCount(mask);
  return Number.isFinite(score) && count < SIGN_SCORE_MILESTONES.length
    && score >= SIGN_SCORE_MILESTONES[count];
}
