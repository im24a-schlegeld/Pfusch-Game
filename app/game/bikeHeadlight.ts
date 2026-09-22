import { Vector3, type Object3D, type SpotLight } from 'three';
import type { BikeModelId } from './vehicleScale';
import { SPORT_LENS_FACES } from './sportDesign';

type Point = readonly [number, number, number];

// Raw visible optical faces, before model/display scale. Sport shares the
// exact authored projector face centres with sportDesign; no stale offsets.
const LENS_FACES: Readonly<Record<BikeModelId, readonly Point[]>> = {
  '125': [[0, 0.967, -0.604]],
  scooter: [[0, 0.611, -0.785]],
  '450': [[0, 0.99, -0.641]],
  '701': SPORT_LENS_FACES,
};

// Preserve the former road beam's slight downward angle: 1.22 m over 23 m.
// This is a direction in the bike frame, so wheelies raise both source and aim.
const AIM_DISTANCE = 20;
const AIM_DROP = (AIM_DISTANCE * (1.25 - 0.03)) / 23;

export interface BikeHeadlightRig {
  readonly count: 1 | 2;
  /**
   * Call after the complete bike pose is applied. Destinations and their targets
   * belong to the untransformed scene, as worldLighting's lights currently do.
   * Only the first `count` destinations are updated; intensity/visibility and
   * the total light budget remain the caller's responsibility.
   */
  copyPose(body: Object3D, lights: readonly SpotLight[]): void;
}

/** Cached optical coordinates; no per-frame allocations or retained bike body. */
export function createBikeHeadlightRig(model: BikeModelId): BikeHeadlightRig {
  const sources = LENS_FACES[model].map(([x, y, z]) => new Vector3(x, y, z));
  const aims = sources.map(
    (source) =>
      new Vector3(source.x, source.y - AIM_DROP, source.z - AIM_DISTANCE),
  );
  const count = sources.length as 1 | 2;

  return {
    count,
    copyPose(body, lights) {
      if (lights.length < count)
        throw new RangeError(
          'The bike headlight rig needs one destination per lens',
        );

      // Refresh only this ancestor chain, not the full rider/vehicle mesh tree.
      // This includes root movement/lean, display scale and rear-axle suspension.
      body.updateWorldMatrix(true, false);
      for (let i = 0; i < count; i++) {
        lights[i].position.copy(sources[i]).applyMatrix4(body.matrixWorld);
        lights[i].target.position.copy(aims[i]).applyMatrix4(body.matrixWorld);
      }
    },
  };
}
