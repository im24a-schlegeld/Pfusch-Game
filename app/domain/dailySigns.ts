import { DAILY_SIGN_CHALLENGE, dailySignEventKey, dailySignLetterKey } from './dailyChallenges.js';
import { dayKey, refreshDaily } from './progression.js';
import type { ChallengeProgress, Player } from './types';
import { SIGN_IDS, type SignId } from '../game/signCollectibles.js';

/** Stable letter keys preserve pickup identities when saved state is restored.
 * Cloud conflicts retain a backup rather than merging automatically. The date
 * is UTC; yesterday's collection is never displayed. */
export function dailySignMask(progress: ChallengeProgress, date = dayKey()) {
  if (progress.date !== date) return 0;
  if (progress.claimed.includes(DAILY_SIGN_CHALLENGE.id)) return 63;
  return SIGN_IDS.reduce((mask, id, index) =>
    mask | (progress.values[dailySignLetterKey(id)] === 1 ? 1 << index : 0), 0);
}

/** One immutable, immediately persistable pickup update. Each of P F U S C H
 * counts once across today's rides; completed runs never recount the letters. */
export function recordDailySign(player: Player, eventId: string, id: SignId, date = dayKey()): Player {
  const current = refreshDaily(player, date);
  const eventKey = dailySignEventKey(eventId);
  const challenge = DAILY_SIGN_CHALLENGE;
  const count = current.challenges.values[challenge.id] ?? 0;
  if (!SIGN_IDS.includes(id) || !eventKey || current.challenges.values[eventKey] === 1 ||
    current.challenges.values[dailySignLetterKey(id)] === 1 || count >= challenge.target ||
    current.challenges.claimed.includes(challenge.id)) return current;
  const nextCount = count + 1;
  const complete = nextCount === challenge.target;
  return {
    ...current,
    coins: current.coins + (complete ? challenge.coins : 0),
    challenges: {
      ...current.challenges,
      values: { ...current.challenges.values, [eventKey]: 1, [dailySignLetterKey(id)]: 1, [challenge.id]: nextCount },
      claimed: complete ? [...current.challenges.claimed, challenge.id] : current.challenges.claimed,
    },
  };
}
