import * as THREE from 'three';
import type { LimbPose } from './riderMotion';

/** Skin the existing curved cloth/skin geometry. UVs and product artwork are preserved. */
export function skinLimb(
  parent: THREE.Object3D,
  meshes: THREE.Mesh[],
  rest: LimbPose,
) {
  const upper = new THREE.Bone(),
    lower = new THREE.Bone();
  parent.add(upper);
  upper.add(lower);
  const skeleton = new THREE.Skeleton([upper, lower]);
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const direction = new THREE.Vector3(),
    up = new THREE.Vector3(0, 1, 0),
    rotation = new THREE.Quaternion();
  const update = (pose: LimbPose) => {
    a.set(...pose.start);
    b.set(...pose.joint);
    c.set(...pose.end);
    upper.position.copy(a);
    upper.quaternion.setFromUnitVectors(
      up,
      direction.subVectors(b, a).normalize(),
    );
    lower.position.set(0, a.distanceTo(b), 0);
    rotation.setFromUnitVectors(up, direction.subVectors(c, b).normalize());
    lower.quaternion.copy(upper.quaternion).invert().multiply(rotation);
  };
  update(rest);
  const segmentA = new THREE.Line3(a.clone(), b.clone()),
    segmentB = new THREE.Line3(b.clone(), c.clone());
  const sample = new THREE.Vector3(),
    closestA = new THREE.Vector3(),
    closestB = new THREE.Vector3();
  const lengthA = a.distanceTo(b),
    lengthB = b.distanceTo(c);
  for (const original of meshes) {
    const geometry = original.geometry,
      positions = geometry.getAttribute('position');
    const indices = new Uint16Array(positions.count * 4),
      weights = new Float32Array(positions.count * 4);
    for (let i = 0; i < positions.count; i++) {
      sample.fromBufferAttribute(positions, i);
      const tA = segmentA.closestPointToPointParameter(sample, true),
        tB = segmentB.closestPointToPointParameter(sample, true);
      segmentA.at(tA, closestA);
      segmentB.at(tB, closestB);
      const along =
        sample.distanceToSquared(closestA) < sample.distanceToSquared(closestB)
          ? tA * lengthA
          : lengthA + tB * lengthB;
      const weight = THREE.MathUtils.smoothstep(
        along,
        lengthA - 0.055,
        lengthA + 0.055,
      );
      indices[i * 4 + 1] = 1;
      weights[i * 4] = 1 - weight;
      weights[i * 4 + 1] = weight;
    }
    geometry.setAttribute(
      'skinIndex',
      new THREE.Uint16BufferAttribute(indices, 4),
    );
    geometry.setAttribute(
      'skinWeight',
      new THREE.Float32BufferAttribute(weights, 4),
    );
    const skinned = new THREE.SkinnedMesh(geometry, original.material);
    skinned.name = original.name;
    skinned.castShadow = true;
    skinned.receiveShadow = true;
    // A small rider is always in view. Avoid stale rest-pose bounds after joint motion.
    skinned.frustumCulled = false;
    parent.remove(original);
    parent.add(skinned);
    parent.updateWorldMatrix(true, true);
    skinned.bind(skeleton);
  }
  return update;
}
