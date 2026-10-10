import { DAILY_SIGN_CHALLENGE, dailySignEventKey } from './dailyChallenges.js';
import { dayKey, refreshDaily } from './progression.js';
import type { Player } from './types';

/** One immutable, immediately persistable pickup update. Counts any six signs
 * across today's rides, never a distinct-sign set or a completed run total. */
export function recordDailySign(player: Player, eventId: string, date = dayKey()): Player {
  const current = refreshDaily(player, date);
  const eventKey = dailySignEventKey(eventId);
  const challenge = DAILY_SIGN_CHALLENGE;
  const count = current.challenges.values[challenge.id] ?? 0;
  if (!eventKey || current.challenges.values[eventKey] === 1 || count >= challenge.target ||
    current.challenges.claimed.includes(challenge.id)) return current;
  const nextCount = count + 1;
  const complete = nextCount === challenge.target;
  return {
    ...current,
    coins: current.coins + (complete ? challenge.coins : 0),
    challenges: {
      ...current.challenges,
      values: { ...current.challenges.values, [eventKey]: 1, [challenge.id]: nextCount },
      claimed: complete ? [...current.challenges.claimed, challenge.id] : current.challenges.claimed,
    },
  };
}
