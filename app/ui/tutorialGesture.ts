import { RIDE_GESTURE } from './rideGestures';

/** Resume only once an existing gameplay gesture can actually produce input. */
export function tutorialGestureIntent(dx: number, dy: number, allowWeight = true) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
  return (allowWeight && Math.abs(dy) >= 24) ||
    (Math.abs(dx) >= RIDE_GESTURE.lanePixels && Math.abs(dx) >= Math.abs(dy) * 0.72);
}
