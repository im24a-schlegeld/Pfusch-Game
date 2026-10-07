import { MAX_RIDE_SPEED } from './config';

// Only the instrument scale changes: Sport retains its existing physical cap.
const DISPLAY_MAX_KMH = 180;
export function speedometerKmh(metresPerSecond: number): number {
  return Math.round(Math.max(0, metresPerSecond) * DISPLAY_MAX_KMH / MAX_RIDE_SPEED);
}
