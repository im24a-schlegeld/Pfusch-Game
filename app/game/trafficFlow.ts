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
) {
  const d = Math.max(0, Math.min(1, difficulty));
  return (initial + (minimum - initial) * d) * TRAFFIC_FLOW.density;
}
/** First/last contact, not just vehicle centres, must have a reachable exit. */
export function trafficArrivalGap(
  riderSpeed: number,
  previousSpeed: number,
  nextSpeed: number,
  previousHalfLength: number,
  nextHalfLength: number,
) {
  const previousClosing = Math.max(5, riderSpeed - previousSpeed);
  const nextClosing = Math.max(5, riderSpeed - nextSpeed);
  return Math.max(
    TRAFFIC_FLOW.minimumArrivalGap,
    TRAFFIC_FLOW.reactionSeconds +
      TRAFFIC_FLOW.laneChangeSeconds +
      previousHalfLength / previousClosing +
      nextHalfLength / nextClosing,
  );
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
