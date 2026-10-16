import type { Player } from '../../app/domain/types.js';
import { ApiError } from './auth.js';

/** A conservative sanity check, NOT proof of a genuine ride.
 * First-time syncs accept realistic accumulated progress, not arbitrary fortunes.
 * Digital values do not authorize verified discounts or Shopify purchases.
 */
export function assertPlausibleDigitalSave(previous: Player | null, next: Player): void {
  const additionalRuns = Math.max(0, next.runsPlayed - (previous?.runsPlayed ?? 0));
  const credits = next.coins - (previous?.coins ?? 150);
  const experience = next.xp - (previous?.xp ?? 0);
  const distance = next.totalDistance - (previous?.totalDistance ?? 0);
  const highScore = next.highScore - (previous?.highScore ?? 0);
  const maxExperience = 10_000 + 30_000 * additionalRuns;
  // finishRun grants at least floor(distance / 9) XP for each endless ride.
  // Keep distance headroom consistent with that budget, including rounding
  // when several offline settlements arrive together.
  const maxDistance = 9 * (maxExperience + additionalRuns);
  // Includes generous headroom for challenges, daily signs, referral credits,
  // client retries and accumulated offline rides. Runs are not cryptographic proof.
  if (credits > 2_000 + 10_000 * additionalRuns ||
      experience > maxExperience ||
      distance > maxDistance ||
      highScore > 1_000_000 + 5_000_000 * additionalRuns) {
    throw new ApiError(422, 'implausible_game_progress');
  }
}
