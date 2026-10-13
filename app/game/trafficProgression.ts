/** Score gates and timing shared by deterministic traffic and its visual pose. */
export const TRAFFIC_PROGRESSION = Object.freeze({
  laneChangeScore: 50_000,
  oncomingScore: 100_000,
  laneChangeChance: 0.65,
  oncomingChance: 0.16,
  oncomingSpeed: 14,
  laneChangeDelay: 0.45,
  laneChangeSeconds: 1.1,
  minimumChangeArrival: 3.1,
  laneChangeApproach: 3.5,
  fullDensityScore: 200_000,
  additionalCarWeight: 4,
  // The contact/reaction budget already protects the route. Extra idle time
  // here suppresses ordinary traffic and rare tow/car encounters too much.
  initialExtraHeadway: 0,
});

export interface TrafficLaneShift {
  from: number;
  to: number;
  age: number;
  /** Pending choices may target the rider once; visible manoeuvres never home. */
  committed?: boolean;
}

export function trafficIntensity(score: number) {
  return Math.max(0, Math.min(1, score / TRAFFIC_PROGRESSION.fullDensityScore));
}

/** Close a currently open adjacent route, while the old lane becomes its exit.
 * If the rider is elsewhere, use the planned adjacent lane without chasing. */
export function trafficCutInTarget(from: number, riderLane: number, planned: number) {
  if ([-1, 0, 1].includes(riderLane) && Math.abs(riderLane - from) === 1) return riderLane;
  if ([-1, 0, 1].includes(planned) && Math.abs(planned - from) === 1) return planned;
  return from === 0 ? 1 : 0;
}

/** Zero velocity at both ends, with no per-frame randomness or extra objects. */
export function trafficLaneProgress(age: number) {
  const t = Math.max(0, Math.min(1,
    (age - TRAFFIC_PROGRESSION.laneChangeDelay) / TRAFFIC_PROGRESSION.laneChangeSeconds));
  return t * t * (3 - 2 * t);
}

export function trafficYaw(velocity: number, shift: TrafficLaneShift | null) {
  if (velocity < 0) return Math.PI;
  if (!shift) return 0;
  return -Math.sign(shift.to - shift.from) * 0.055 *
    Math.sin(trafficLaneProgress(shift.age) * Math.PI);
}
