import * as THREE from 'three';

type Point = [number, number, number];
type EdgeSample = { x: number; y: number };

/** Intersect a vertical line with the mesh's real triangles (bike-local space). */
function undersideAt(geometry: THREE.BufferGeometry, x: number, z: number) {
  const p = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!index) throw new Error('Supermoto rear fender must be indexed');
  let lowest = Infinity;
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    const ax = p.getX(a), az = p.getZ(a);
    const bx = p.getX(b), bz = p.getZ(b);
    const cx = p.getX(c), cz = p.getZ(c);
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-12) continue;
    const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
    const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
    const w = 1 - u - v;
    if (Math.min(u, v, w) < -1e-6) continue;
    lowest = Math.min(lowest, u * p.getY(a) + v * p.getY(b) + w * p.getY(c));
  }
  if (!Number.isFinite(lowest)) throw new Error('Rear liner sample outside the existing fender');
  return lowest;
}

/** sidePanel() stores two copies of its ordered boundary, one per wall face. */
function readSideBoundary(cover: THREE.Mesh): Point[] {
  const p = cover.geometry.getAttribute('position');
  const count = p.count / 2;
  if (!Number.isInteger(count) || count < 3) {
    throw new Error('Unexpected Supermoto side-cover topology');
  }
  return Array.from({ length: count }, (_, i) => [
    Math.abs(p.getX(i)), p.getY(i), p.getZ(i),
  ] as Point);
}

function lowerEdgeAt(boundary: Point[], z: number): EdgeSample {
  let result: EdgeSample | undefined;
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i], b = boundary[(i + 1) % boundary.length];
    const dz = b[2] - a[2];
    if (Math.abs(dz) < 1e-8) continue;
    const t = (z - a[2]) / dz;
    if (t < -1e-6 || t > 1 + 1e-6) continue;
    const y = a[1] + (b[1] - a[1]) * t;
    if (!result || y < result.y) {
      result = { x: a[0] + (b[0] - a[0]) * t, y };
    }
  }
  if (!result) throw new Error('Rear liner sample outside the existing side cover');
  return result;
}

/** A thin, closed sheet. The two faces share a rim. */
function sheet(
  rows: number,
  cols: number,
  at: (u: number, v: number) => Point,
  thickness: Point,
) {
  const vertices: number[] = [];
  const indices: number[] = [];
  const stride = cols + 1;
  const faceCount = (rows + 1) * stride;
  for (let layer = 0; layer < 2; layer++) {
    for (let row = 0; row <= rows; row++) {
      for (let col = 0; col <= cols; col++) {
        const p = at(row / rows, col / cols * 2 - 1);
        vertices.push(
          p[0] + layer * thickness[0],
          p[1] + layer * thickness[1],
          p[2] + layer * thickness[2],
        );
      }
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const a = row * stride + col, b = a + stride;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
      indices.push(
        a + faceCount, a + 1 + faceCount, b + faceCount,
        a + 1 + faceCount, b + 1 + faceCount, b + faceCount,
      );
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
  return geometry;
}

/** Read the already-built, symmetric covers; only add the liner and mudflap. */
export function addSupermotoRearProtection(
  body: THREE.Group,
  paint: THREE.MeshStandardMaterial,
  rubber: THREE.MeshStandardMaterial,
) {
  if (body.getObjectByName('supermoto-rear-protection-v37')) return;

  const tail = body.getObjectByName('supermoto-tail-fender');
  const cover = body.getObjectByName('supermoto-side-cover');
  const airbox = body.getObjectByName('supermoto-airbox');

  if (!(tail instanceof THREE.Mesh) || !(cover instanceof THREE.Mesh) ||
      !(airbox instanceof THREE.Mesh)) {
    throw new Error('Build the Supermoto side covers and tail before its inner liner');
  }

  const covers: THREE.Mesh[] = [];
  body.traverse((object) => {
    if (object.name === 'supermoto-side-cover' && object instanceof THREE.Mesh) covers.push(object);
  });
  if (covers.length !== 2) throw new Error('Expected two Supermoto side covers');
  const boundary = readSideBoundary(cover);
  // Start the dark wheel-arch liner farther forward so rear-view gaps expose
  // less of the subframe and suspension without changing collision geometry.
  const frontZ = 0.38;
  const endZ = Math.max(...boundary.map(p => p[2]));
  const sections = new Map<number, { halfWidth: number; edgeY: number; crown: number }>();

  const section = (z: number) => {
    const cached = sections.get(z);
    if (cached) return cached;
    const edge = lowerEdgeAt(boundary, z);
    const roof = undersideAt(tail.geometry, 0, z);

    // Close the slim plastics directly underneath the seat. The diagonal
    // lower subframe stays exposed instead of pulling this sheet into a bowl.
    const edgeY = edge.y + 0.004;
    const crown = Math.min(
      edgeY + 0.014,
      roof - 0.002,
    );
    const result = { halfWidth: edge.x + 0.001, edgeY, crown };
    sections.set(z, result);
    return result;
  };

  const linerPoint = (z: number, v: number): Point => {
    const p = section(z);
    // Complementary weights: the liner must not sag below both edge/crown.
    const edgeBlend = Math.pow(Math.abs(v), 1.65);
    return [
      p.halfWidth * v,
      p.crown + (p.edgeY - p.crown) * edgeBlend,
      z,
    ];
  };

  const parts = new THREE.Group();
  parts.name = 'supermoto-rear-protection-v37';

  const linerFinish = paint.clone();
  linerFinish.metalness = 0;
  linerFinish.roughness = 0.92;
  const liner = new THREE.Mesh(
    sheet(
      28,
      12,
      (u, v) => linerPoint(frontZ + (endZ - frontZ) * u, v),
      [0, -0.003, 0],
    ),
    linerFinish,
  );
  liner.name = 'supermoto-under-tail-liner';
  liner.castShadow = liner.receiveShadow = true;
  parts.add(liner);

  // Mudflap sits near the spring, not at the tail. Small and dark.
  const mountZ = 0.405;
  const flapFinish = rubber.clone();
  flapFinish.color.set('#141414');
  flapFinish.metalness = 0;
  flapFinish.roughness = 1;

  const flap = new THREE.Mesh(
    sheet(
      18,
      10,
      (u, v) => {
        const topHalf = 0.064 - 0.005 * u;
        const x = topHalf * v;
        const attachmentY = undersideAt(airbox.geometry, x, mountZ) + 0.001;
        return [
          x,
          attachmentY - 0.16 * u - 0.028 * u * u,
          mountZ + 0.058 * u,
        ];
      },
      [0, 0, -0.003],
    ),
    flapFinish,
  );
  flap.name = 'supermoto-mudflap';
  flap.castShadow = flap.receiveShadow = true;
  parts.add(flap);

  body.add(parts);
}
