import { Vector3 } from 'three';

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
