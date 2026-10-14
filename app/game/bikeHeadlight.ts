import { Mesh, MeshStandardMaterial, Vector3, type Object3D, type SpotLight } from 'three';
import type { BikeModelId } from './vehicleScale';
import { SPORT_LENS_FACES } from './sportDesign';
import { SUPERMOTO_LENS_FACE } from './supermotoBodywork';

type Point = readonly [number, number, number];

// Raw visible optical faces, before model/display scale. Sport shares the
// exact authored projector face centres with sportDesign; no stale offsets.
const LENS_FACES: Readonly<Record<BikeModelId, readonly Point[]>> = {
  '125': [[0, 0.967, -0.604]],
  scooter: [[0, 0.611, -0.785]],
  moped: [[0, 0.7779473, -0.3741487]],
  '450': [SUPERMOTO_LENS_FACE],
  '701': SPORT_LENS_FACES,
};

// Aim the existing optical cone at the near road instead of almost parallel
// to it. The old 3-degree axis left the first 2–3 m in its faint outer fringe.
// This stays in the bike frame: a wheelie still lifts the physical beam.
const AIM_DISTANCE = 20;
const AIM_DROP = AIM_DISTANCE * Math.tan(Math.PI / 9);

// Only the imported forward optics emit. Rear lamps, bodywork and shared
// metallic trim must retain their authored materials and colours.
const HEADLIGHT_MATERIALS = new Set([
  'ciao_light', 'moped_light', 'nitro_light',
  'fs450_headlight_glass', 'fs450_headlight_reflector', 'r6_reflector',
]);

/** Cache once per assembled bike; the existing road lights supply its darkness. */
export function createBikeHeadlightGlowUpdater(body: Object3D) {
  const optics = new Set<MeshStandardMaterial>();
  body.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!(material instanceof MeshStandardMaterial) || !HEADLIGHT_MATERIALS.has(material.name)) continue;
      material.emissive.set('#e2eced');
      material.emissiveIntensity = 0;
      optics.add(material);
    }
  });
  const materials = [...optics];
  let previous = -1;
  return (darkAmount: number) => {
    const darkness = Number.isFinite(darkAmount) ? Math.max(0, Math.min(1, darkAmount)) : 0;
    if (darkness === previous) return;
    previous = darkness;
    for (const material of materials) material.emissiveIntensity = darkness * 3.2;
  };
}

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
        const anchors = body.userData.headlightAnchors as Object3D[] | undefined;
        const anchor = anchors?.[i] ?? anchors?.[0];
        if (anchor) {
          // The steering group owns a manual matrix. Force its world refresh
          // when only the chassis moved, without walking its render meshes.
          if (anchor.parent && anchor.parent !== body)
            anchor.parent.updateWorldMatrix(false, false, true);
          anchor.updateWorldMatrix(false, false, true);
          lights[i].position.setFromMatrixPosition(anchor.matrixWorld);
          lights[i].target.position.set(0, -AIM_DROP, -AIM_DISTANCE).applyMatrix4(anchor.matrixWorld);
          continue;
        }
        lights[i].position.copy(sources[i]).applyMatrix4(body.matrixWorld);
        lights[i].target.position.copy(aims[i]).applyMatrix4(body.matrixWorld);
      }
    },
  };
}
