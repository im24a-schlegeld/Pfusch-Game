import * as THREE from 'three';

/** Sample the lowest actual fender triangle in body-local metres. */
function undersideAt(geometry: THREE.BufferGeometry, x: number, z: number) {
  const positions = geometry.getAttribute('position'), index = geometry.getIndex()!;
  let lowest = Infinity;
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    const ax = positions.getX(a), az = positions.getZ(a);
    const bx = positions.getX(b), bz = positions.getZ(b);
    const cx = positions.getX(c), cz = positions.getZ(c);
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-12) continue;
    const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
    const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
    const w = 1 - u - v;
    if (Math.min(u, v, w) >= -1e-6) {
      lowest = Math.min(lowest, u * positions.getY(a) + v * positions.getY(b) + w * positions.getY(c));
    }
  }
  if (!Number.isFinite(lowest)) throw new Error('Der Supermoto-Spritzschutz braucht die echte Heckkotflügel-Unterseite.');
  return lowest;
}

/** The exported 450 omits its source rear plate. Fit a small rubber flap to
 * the retained fender, leaving a flat rear face large enough for a 9 cm decal. */
export function addImportedSupermotoMudflap(body: THREE.Group, tail: THREE.Vector3) {
  if (body.getObjectByName('supermoto-mudflap')) return;
  const fender = body.getObjectByName('fs450_bodywork_paint:body');
  if (!(fender instanceof THREE.Mesh)) throw new Error('Der importierte Supermoto-Heckkotflügel fehlt.');

  const cols = 4, rows = 2, stride = cols + 1, faceCount = (rows + 1) * stride;
  const mountZ = tail.z - 0.12;
  const attachment = Array.from({ length: stride }, (_, col) =>
    undersideAt(fender.geometry, (col / cols * 2 - 1) * 0.065, mountZ));
  const edgeY = Math.min(...attachment);
  const vertices: number[] = [], indices: number[] = [];
  for (let layer = 0; layer < 2; layer++) {
    for (let row = 0; row <= rows; row++) {
      for (let col = 0; col <= cols; col++) {
        const lateral = col / cols * 2 - 1;
        // The small upper return follows all five fender samples. Its inset
        // seats the rubber in the plastic instead of leaving a floating edge.
        const halfWidth = row === 0 ? 0.065 : row === 1 ? 0.064 : 0.06;
        const y = row === 0 ? attachment[col] + 0.0015 : edgeY - (row === 1 ? 0.035 : 0.2);
        const z = mountZ + (row === 0 ? 0 : row === 1 ? 0.012 : 0.075);
        vertices.push(lateral * halfWidth, y, z - layer * 0.003);
      }
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const a = row * stride + col, b = a + stride;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
      indices.push(a + faceCount, a + 1 + faceCount, b + faceCount,
        a + 1 + faceCount, b + 1 + faceCount, b + faceCount);
    }
  }
  const perimeter: number[] = [];
  for (let col = 0; col < cols; col++) perimeter.push(col);
  for (let row = 0; row < rows; row++) perimeter.push(row * stride + cols);
  for (let col = cols; col > 0; col--) perimeter.push(rows * stride + col);
  for (let row = rows; row > 0; row--) perimeter.push(row * stride);
  for (let i = 0; i < perimeter.length; i++) {
    const a = perimeter[i], b = perimeter[(i + 1) % perimeter.length];
    indices.push(a, b, a + faceCount, b, b + faceCount, a + faceCount);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({
    name: 'fs450_mudflap_rubber', color: '#141414', metalness: 0, roughness: 1,
  });
  material.userData.fixedHardwareFinish = true;
  const flap = new THREE.Mesh(geometry, material);
  flap.name = 'supermoto-mudflap';
  flap.userData.bikePaintSurface = false;
  flap.userData.bikeStickerSurface = true;
  flap.castShadow = flap.receiveShadow = true;
  body.add(flap);
}
