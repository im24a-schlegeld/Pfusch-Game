import { Vector3 } from 'three';

const signedUnit = (value: number) =>
  Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;

/** The bars visibly follow the lane manoeuvre, then centre themselves. The
 * small airborne balance correction is cosmetic and never changes physics.
 * Scalar inputs keep this render-time helper free of temporary allocations. */
export function handlebarSteeringInput(
  laneError: number,
  laneChangeAge: number,
  laneDirection: number,
  wheelie: number,
  elapsed: number,
  balance: number,
  reducedMotion: boolean,
) {
  if (reducedMotion) return 0;
  const turnPulse = Number.isFinite(laneChangeAge) && laneChangeAge > 0 && laneChangeAge < 0.42
    ? Math.sin(Math.PI * laneChangeAge / 0.42)
    : 0;
  const lift = Math.max(0, signedUnit(wheelie));
  const correction = Number.isFinite(elapsed) ? Math.sin(elapsed * 3.5) * 0.22 : 0;
  return signedUnit(signedUnit(laneError) * 0.8 + signedUnit(laneDirection) * turnPulse * 0.65
    + lift * (correction + signedUnit(balance) * 0.18));
}

/** About nine degrees at a complete lane input; calm two-degree corrections
 * during a balanced wheelie. Exponential response has no frame-rate bias. */
export function nextHandlebarAngle(current: number, input: number, dt: number) {
  const previous = Number.isFinite(current) ? current : 0;
  const duration = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  return previous + (-signedUnit(input) * 0.16 - previous) * (1 - Math.exp(-duration * 14));
}

/** Small front suspension travel about the rear contact; physics pitch is unchanged. */
export function suspensionPose(
  pitch: number,
  travel: number,
  rear: number,
  front: number,
  radius: number,
) {
  // The front is negative Z: positive compression must tip the chassis down.
  const angle = -Math.max(-0.008, Math.min(0.024, travel)) / (rear - front);
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const y = radius * (1 - c) + rear * s;
  const z = rear * (1 - c) - radius * s;
  return {
    pitch: pitch + angle,
    position: new Vector3(
      0,
      radius * (1 - Math.cos(pitch)) +
        rear * Math.sin(pitch) +
        y * Math.cos(pitch) -
        z * Math.sin(pitch),
      y * Math.sin(pitch) + z * Math.cos(pitch),
    ),
    // Inverse suspension rotation keeps front wheel, calipers and low fender together.
    axleAngle: -angle,
    axlePosition: new Vector3(
      0,
      radius * (1 - c) - rear * s,
      rear * (1 - c) + radius * s,
    ),
  };
}
