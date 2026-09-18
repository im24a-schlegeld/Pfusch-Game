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
