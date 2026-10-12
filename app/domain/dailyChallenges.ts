import { DAILY_CHALLENGE_POOL } from './config.js';
import type { ChallengeDefinition, ChallengeProgress } from './types';
import { SIGN_IDS, type SignId } from '../game/signCollectibles.js';

const DAY_MS = 86_400_000;
const slots = ['daily-rides', 'daily-skill', 'daily-focus', 'daily-distance'] as const;
const legacySlots = ['three-rides', 'one-wheel', 'close-call', 'night-shift'] as const;
export const DAILY_SIGN_CHALLENGE: ChallengeDefinition = {
  id: 'daily-signs', title: 'PFUSCH sammeln', description: 'Sammle heute P, F, U, S, C und H.',
  stat: 'signs', target: 6, coins: 120, xp: 0, cadence: 'daily',
};
export const DAILY_SIGN_EVENT_PREFIX = 'daily-pfusch:event:';
export const dailySignLetterKey = (id: SignId) => `daily-pfusch:${id}`;

/** Run UUID plus serial stays below the server backup's 160-character key bound. */
export function dailySignEventKey(eventId: string): string | null {
  return typeof eventId === 'string' && eventId.length <= 128 && eventId.trim() === eventId &&
    /^[A-Za-z0-9_.:-]+:\d+$/.test(eventId)
    ? DAILY_SIGN_EVENT_PREFIX + eventId : null;
}
const rewards = [{ coins: 60, xp: 160 }, { coins: 70, xp: 140 }, { coins: 80, xp: 130 }, { coins: 90, xp: 110 }];
const harderTargets: Record<ChallengeDefinition['stat'], number> = {
  runs: 5, wheelie: 500, nearMisses: 10, distance: 4000, jumps: 8, score: 9000, signs: 6,
};
const descriptions: Record<ChallengeDefinition['stat'], (target: string) => string> = {
  runs: target => `${target} Fahrten beenden`,
  wheelie: target => `${target} m Wheelie fahren`,
  nearMisses: target => `${target} knappe Manöver schaffen`,
  distance: target => `${target} m fahren`,
  jumps: target => `${target} Sprünge schaffen`,
  score: target => `${target} Punkte sammeln`,
  signs: target => `${target} Schilder sammeln`,
};

/** Four rotating tasks plus the fixed sign collection for everyone on a UTC day. */
export function dailyChallengesForDate(date: string): ChallengeDefinition[] {
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date)
    throw new Error('Ungültiger Aufgabentag');
  const day = Math.floor(timestamp / DAY_MS), cycle = ((day % 4) + 4) % 4;
  const harder = Math.floor(day / 4) % 2 !== 0;
  const selected = [0, cycle % 2 ? 4 : 1, cycle >= 2 ? 5 : 2, 3];
  return [...selected.map((index, slot) => {
    const mission = DAILY_CHALLENGE_POOL[index];
    const target = harder ? harderTargets[mission.stat] : mission.target;
    return { ...mission, id: slots[slot], target,
      description: descriptions[mission.stat](target.toLocaleString('de-CH')),
      ...rewards[(slot + cycle) % rewards.length] };
  }), { ...DAILY_SIGN_CHALLENGE }];
}

/** Additive schema-1 migration: each old task keeps its earned daily reward slot.
 * Carry progress only when the metric still matches; never reinterpret metres as jumps.
 * Legacy keys remain intact, while stable new IDs make repeated migration a no-op. */
export function normalizeDailyProgress(progress: ChallengeProgress, date: string): ChallengeProgress {
  if (progress.date !== date) return { date, values: {}, claimed: [] };
  let values = progress.values, claimed = progress.claimed;
  // Only the original four slots have legacy aliases. Never map the additive
  // fifth task onto an undefined legacy property from an older snapshot.
  for (const [slot, mission] of dailyChallengesForDate(date).slice(0, legacySlots.length).entries()) {
    const legacyId = legacySlots[slot], legacyValue = progress.values[legacyId];
    const wasClaimed = progress.claimed.includes(legacyId);
    if (legacyValue === undefined && !wasClaimed) continue;
    if (!Object.prototype.hasOwnProperty.call(values, mission.id)) {
      const sameMetric = DAILY_CHALLENGE_POOL[slot].stat === mission.stat;
      values = { ...values, [mission.id]: wasClaimed ? mission.target : sameMetric ? Math.min(mission.target, legacyValue ?? 0) : 0 };
    }
    if (wasClaimed && !claimed.includes(mission.id)) claimed = [...claimed, mission.id];
  }
  const signId = DAILY_SIGN_CHALLENGE.id, target = DAILY_SIGN_CHALLENGE.target;
  // Explicit schema-1 migration: the old counter never stored letter identity.
  // Completed payouts remain completed; partial counts cannot invent letters.
  const signClaimed = claimed.includes(signId);
  let letterCount = 0;
  for (const id of SIGN_IDS) {
    const key = dailySignLetterKey(id);
    if (signClaimed || values[key] === 1) {
      letterCount++;
      if (values[key] !== 1) values = { ...values, [key]: 1 };
    } else if (values[key] !== undefined) {
      if (values === progress.values) values = { ...values };
      delete values[key];
    }
  }
  let eventCount = 0;
  for (const key of Object.keys(values)) {
    if (key.startsWith('daily-signs:event:')) {
      if (values === progress.values) values = { ...values };
      delete values[key];
      continue;
    }
    if (!key.startsWith(DAILY_SIGN_EVENT_PREFIX)) continue;
    if (dailySignEventKey(key.slice(DAILY_SIGN_EVENT_PREFIX.length)) === key && values[key] === 1 && eventCount < target) {
      eventCount++;
    } else {
      if (values === progress.values) values = { ...values };
      delete values[key];
    }
  }
  if (values[signId] !== undefined || letterCount > 0 || eventCount > 0 || claimed.includes(signId)) {
    const value = values[signId];
    const count = letterCount;
    if (value !== count) values = { ...values, [signId]: count };
  }
  return values === progress.values && claimed === progress.claimed ? progress : { date, values, claimed };
}
