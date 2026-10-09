import * as THREE from 'three';

// One material scale for both sleeves and every bike pose. These are cloth/UV
// dimensions, never rider bone lengths. Keep the existing bounded 512px map.
export const SLEEVE_UV_METRES = { around: 0.52, along: 0.88 } as const;

/** Fair only the cloth at the elbow, then measure ink along the actual surface. */
export function fitPrintedSleeve(
  geometry: THREE.BufferGeometry,
  rings: number,
  sides: number,
  elbow: THREE.Vector3,
) {
  const positions = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const stride = sides + 1;
  const center = new THREE.Vector3(), sample = new THREE.Vector3();
  const weights: number[] = [];
  for (let ring = 0; ring <= rings; ring++) {
    center.set(0, 0, 0);
    for (let j = 0; j < sides; j++)
      center.add(sample.fromBufferAttribute(positions, ring * stride + j));
    center.divideScalar(sides);
    weights.push(Math.exp(-((center.distanceTo(elbow) / 0.105) ** 2)));
  }
  // Round the sewn sleeve's bend without moving the joint or either contact.
  // The final displacement stays below 8mm, even in the tightest sport pose.
  const original = Float32Array.from(positions.array as ArrayLike<number>);
  for (let pass = 0; pass < 5; pass++) {
    const previous = Float32Array.from(positions.array as ArrayLike<number>);
    for (let ring = 1; ring < rings; ring++)
      for (let j = 0; j <= sides; j++)
        for (let axis = 0; axis < 3; axis++) {
          const i = (ring * stride + j) * 3 + axis;
          const average = (previous[i - stride * 3] + previous[i + stride * 3]) / 2;
          (positions.array as Float32Array)[i] = THREE.MathUtils.clamp(
            previous[i] + (average - previous[i]) * 0.45 * weights[ring],
            original[i] - 0.008,
            original[i] + 0.008,
          );
        }
  }

  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const outside = sides / 2;
  const along: number[] = [0];
  for (let ring = 1; ring <= rings; ring++) {
    a.fromBufferAttribute(positions, (ring - 1) * stride + outside);
    b.fromBufferAttribute(positions, ring * stride + outside);
    along.push(along[ring - 1] + a.distanceTo(b));
  }
  // Anchor at the cuff, so the real motif has the same physical size and cuff
  // clearance on all bikes. The inner/outer elbow may stretch the cloth, but a
  // tapered cuff must not squeeze the artwork to a needle point.
  for (let ring = 0; ring <= rings; ring++) {
    const distances: number[] = [0];
    for (let j = 1; j <= sides; j++) {
      a.fromBufferAttribute(positions, ring * stride + j - 1);
      b.fromBufferAttribute(positions, ring * stride + j);
      distances.push(distances[j - 1] + a.distanceTo(b));
    }
    for (let j = 0; j <= sides; j++) {
      uv.setXY(
        ring * stride + j,
        0.5 + (distances[j] - distances[outside]) / SLEEVE_UV_METRES.around,
        (along[rings] - along[ring]) / SLEEVE_UV_METRES.along,
      );
    }
  }
  positions.needsUpdate = true;
  uv.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}
