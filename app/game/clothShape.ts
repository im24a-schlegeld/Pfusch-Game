import * as THREE from 'three';
const gaussian = (value: number) => Math.exp(-value * value);

/** Directional compression ridges and opposing troughs, localized by garment mechanics. */
export function torsoDrape(
  geometry: THREE.BufferGeometry,
  hem: number,
  outerwear: boolean,
  knittedHem = false,
) {
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = positions.getY(i),
      z = positions.getZ(i);
    const hip = y - (0.1 + Math.abs(x) * 0.3);
    const pit = y - (0.4 - Math.abs(x) * 0.35);
    const side = Math.min(1, Math.abs(x) / 0.17);
    const ridge = (offset: number, width: number) =>
      gaussian(offset / width) -
      0.55 * gaussian((offset - width * 1.6) / width);
    const folds =
      (ridge(hip, 0.023) * 0.01 + ridge(pit, 0.021) * 0.011 * side) *
      (outerwear ? 1.2 : 1);
    const hang = gaussian((y - hem) / 0.07);
    // Side seams hang slightly lower; front compresses over the seated hip.
    const hemDrop =
      hang *
      (0.006 * side +
        0.017 * Math.max(0, z / 0.15) -
        0.004 * Math.max(0, -z / 0.15));
    const band = 1 - THREE.MathUtils.smoothstep(y - hem, 0.035, 0.054);
    const gather = knittedHem ? 1 - 0.034 * band : 1;
    positions.setXYZ(
      i,
      x * gather,
      y - hemDrop,
      (z + Math.sign(z) * folds) * gather,
    );
  }
  geometry.computeVertexNormals();
}

export function sleeveFolds(
  mesh: THREE.Mesh,
  rings: number,
  sides: number,
  tee: boolean,
  strength = 1,
) {
  const positions = mesh.geometry.getAttribute('position');
  const center = new THREE.Vector3(),
    point = new THREE.Vector3();
  for (let ring = 0; ring <= rings; ring++) {
    center.set(0, 0, 0);
    for (let j = 0; j < sides; j++)
      center.add(point.fromBufferAttribute(positions, ring * (sides + 1) + j));
    center.divideScalar(sides);
    for (let j = 0; j <= sides; j++) {
      const t = ring / rings,
        angle = (j / sides) * Math.PI * 2;
      const elbow = t - (tee ? 0.78 : 0.61) + Math.cos(angle) * 0.026;
      const cuff = t - 0.91 + Math.cos(angle) * 0.014;
      const fold =
        strength *
        (0.0038 *
          (gaussian(elbow / 0.046) -
            0.28 * gaussian((elbow - 0.062) / 0.046)) +
          (tee ? 0.0007 : 0.0015) * gaussian(cuff / 0.032));
      const index = ring * (sides + 1) + j;
      point.fromBufferAttribute(positions, index).sub(center);
      point.setLength(Math.max(0.01, point.length() + fold)).add(center);
      positions.setXYZ(index, point.x, point.y, point.z);
    }
  }
  mesh.geometry.computeVertexNormals();
}
