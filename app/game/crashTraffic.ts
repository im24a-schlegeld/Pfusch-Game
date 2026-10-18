import type { Obstacle } from './engine';

/** Preserve the impact obstacle for contact physics, but never pin an unrelated
 * parked vehicle or construction barrier to the screen while the rider coasts. */
export function shouldFreezeCrashTraffic(
  obstacle: Pick<Obstacle, 'kind' | 'velocity'>,
  directlyHit: boolean,
): boolean {
  if (directlyHit) return true;
  if (obstacle.kind === 'construction') return false;
  return Number.isFinite(obstacle.velocity) && Math.abs(obstacle.velocity) > 0.05;
}
