import { TRAFFIC_PROGRESSION, trafficIntensity } from './trafficProgression';

/** All distances are metres; speeds are metres/second. No km/h/m/s mixing. */
export const TRAFFIC_FLOW = Object.freeze({
  // Keep a reachable safe lane while making the road feel consistently busy.
  density: 0.46,
  maximumTrafficSpeed: 23,
  maximumCarSpeed: 16,
  towClosingSpeed: 12,
  reactionSeconds: 0.5,
  laneChangeSeconds: 0.38,
  minimumArrivalGap: 1.22,
  towCarPairChance: 0.18,
  minimumVehicleGap: 2,
});
export function trafficWaveSpacing(
  initial: number,
  minimum: number,
  difficulty: number,
  score = 0,
) {
  const d = Math.max(0, Math.min(1, difficulty));
  return (initial + (minimum - initial) * d) * TRAFFIC_FLOW.density * (1 - trafficIntensity(score) * 0.18);
}
/** First/last contact, not just vehicle centres, must have a reachable exit. */
export function trafficArrivalGap(
  riderSpeed: number,
  previousSpeed: number,
  nextSpeed: number,
  previousHalfLength: number,
  nextHalfLength: number,
  score = 0,
) {
  const previousClosing = Math.max(5, riderSpeed - previousSpeed);
  const nextClosing = Math.max(5, riderSpeed - nextSpeed);
  // A changing car can leave a different exit than the original wave planned.
  // Two adjacent swipes cover even the opposite edge; density never removes
  // this physical escape budget. Density grows through spawn spacing and the
  // moving-traffic mix, without adding idle time to ordinary early waves.
  return Math.max(
    TRAFFIC_FLOW.minimumArrivalGap,
    TRAFFIC_FLOW.reactionSeconds +
      TRAFFIC_FLOW.laneChangeSeconds * 2 +
      previousHalfLength / previousClosing +
      nextHalfLength / nextClosing,
  ) + TRAFFIC_PROGRESSION.initialExtraHeadway * (1 - trafficIntensity(score));
}
/** Different speeds must not create an ordinary side-by-side pair later. */
export function trafficSeparatedUntilPass(
  previousZ: number,
  previousSpeed: number,
  nextSpeed: number,
  previousHalfLength: number,
  nextHalfLength: number,
  sharedLifetime: number,
) {
  const initialGap = 145 - previousZ;
  const finalGap = initialGap + (nextSpeed - previousSpeed) * sharedLifetime;
  return Math.min(initialGap, finalGap) >=
    previousHalfLength + nextHalfLength + TRAFFIC_FLOW.minimumVehicleGap;
}
