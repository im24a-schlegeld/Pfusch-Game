import { SIGN_IDS, type SignId } from './signCollectibles';
export const COMPLETE_SIGN_MASK = (1 << SIGN_IDS.length) - 1;
export function signBit(id: SignId) { return 1 << SIGN_IDS.indexOf(id); }
/** One set per ride. Missing/expired signs return, collected/active ones do not. */
export function nextMissingSign(
  mask: number, active: readonly { active: boolean; id: SignId }[], start: number,
): SignId | undefined {
  for (let offset = 0; offset < SIGN_IDS.length; offset++) {
    const id = SIGN_IDS[(start + offset) % SIGN_IDS.length];
    if (!(mask & signBit(id)) && !active.some(s => s.active && s.id === id)) return id;
  }
  return undefined;
}

/** Score milestones, NOT a 100 km distance requirement. One set per ride. */
export const SIGN_SCORE_MILESTONES = [8000, 24000, 42000, 62000, 82000, 100000] as const;
export const SIGN_DISTANCE_GAP = 750;
export const SIGN_RETRY_DISTANCE = 350;
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
