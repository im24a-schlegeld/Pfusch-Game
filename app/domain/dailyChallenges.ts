import { DAILY_CHALLENGE_POOL } from './config.js';
import type { ChallengeDefinition, ChallengeProgress } from './types';

const DAY_MS = 86_400_000;
const slots = ['daily-rides', 'daily-skill', 'daily-focus', 'daily-distance'] as const;
const legacySlots = ['three-rides', 'one-wheel', 'close-call', 'night-shift'] as const;
const rewards = [{ coins: 60, xp: 160 }, { coins: 70, xp: 140 }, { coins: 80, xp: 130 }, { coins: 90, xp: 110 }];
const harderTargets: Record<ChallengeDefinition['stat'], number> = {
  runs: 5, wheelie: 500, nearMisses: 10, distance: 4000, jumps: 8, score: 9000,
};
const descriptions: Record<ChallengeDefinition['stat'], (target: string) => string> = {
  runs: target => `${target} Fahrten beenden`,
  wheelie: target => `${target} m Wheelie fahren`,
  nearMisses: target => `${target} knappe Manöver schaffen`,
  distance: target => `${target} m fahren`,
  jumps: target => `${target} Sprünge schaffen`,
  score: target => `${target} Punkte sammeln`,
};

/** Same four tasks for everyone on a UTC day; no random, player or storage inputs. */
export function dailyChallengesForDate(date: string): ChallengeDefinition[] {
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date)
    throw new Error('Ungültiger Aufgabentag');
  const day = Math.floor(timestamp / DAY_MS), cycle = ((day % 4) + 4) % 4;
  const harder = Math.floor(day / 4) % 2 !== 0;
  const selected = [0, cycle % 2 ? 4 : 1, cycle >= 2 ? 5 : 2, 3];
  return selected.map((index, slot) => {
    const mission = DAILY_CHALLENGE_POOL[index];
    const target = harder ? harderTargets[mission.stat] : mission.target;
    return { ...mission, id: slots[slot], target,
      description: descriptions[mission.stat](target.toLocaleString('de-CH')),
      ...rewards[(slot + cycle) % rewards.length] };
  });
}

/** Additive schema-1 migration: each old task keeps its earned daily reward slot.
 * Carry progress only when the metric still matches; never reinterpret metres as jumps.
 * Legacy keys remain intact, while stable new IDs make repeated migration a no-op. */
export function normalizeDailyProgress(progress: ChallengeProgress, date: string): ChallengeProgress {
  if (progress.date !== date) return { date, values: {}, claimed: [] };
  let values = progress.values, claimed = progress.claimed;
  for (const [slot, mission] of dailyChallengesForDate(date).entries()) {
    const legacyId = legacySlots[slot], legacyValue = progress.values[legacyId];
    const wasClaimed = progress.claimed.includes(legacyId);
    if (legacyValue === undefined && !wasClaimed) continue;
    if (!Object.prototype.hasOwnProperty.call(values, mission.id)) {
      const sameMetric = DAILY_CHALLENGE_POOL[slot].stat === mission.stat;
      values = { ...values, [mission.id]: wasClaimed ? mission.target : sameMetric ? Math.min(mission.target, legacyValue ?? 0) : 0 };
    }
    if (wasClaimed && !claimed.includes(mission.id)) claimed = [...claimed, mission.id];
  }
  return values === progress.values && claimed === progress.claimed ? progress : { date, values, claimed };
}
