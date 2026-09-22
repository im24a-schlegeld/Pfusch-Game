/** All distances are metres; speeds are metres/second. No km/h/m/s mixing. */
export const TRAFFIC_FLOW = Object.freeze({
  density: 0.74,
  maximumTrafficSpeed: 23,
  maximumCarSpeed: 16,
  towClosingSpeed: 12,
  reactionSeconds: 0.62,
  laneChangeSeconds: 0.35,
  pairedTrafficChance: 0.045,
  towCarPairChance: 0.12,
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
    1.5,
    TRAFFIC_FLOW.reactionSeconds +
      TRAFFIC_FLOW.laneChangeSeconds +
      previousHalfLength / previousClosing +
      nextHalfLength / nextClosing,
  );
}
