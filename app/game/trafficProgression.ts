/** Score gates and timing shared by deterministic traffic and its visual pose. */
export const TRAFFIC_PROGRESSION = Object.freeze({
  laneChangeScore: 50_000,
  oncomingScore: 100_000,
  laneChangeChance: 0.65,
  oncomingChance: 0.16,
  oncomingSpeed: 14,
  laneChangeDelay: 0.3,
  laneChangeSeconds: 1.1,
  minimumChangeArrival: 2.8,
  laneChangeApproach: 3.2,
});

export interface TrafficLaneShift {
  from: number;
  to: number;
  age: number;
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
