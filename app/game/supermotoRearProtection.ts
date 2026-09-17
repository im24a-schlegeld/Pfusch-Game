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

/** Lowest point of the already-built tubular subframe at a longitudinal station. */
function frameBottomAt(geometry: THREE.BufferGeometry, z: number) {
  const p = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!index) return Infinity;
  let lowest = Infinity;
  for (let i = 0; i < index.count; i += 3) {
    const tri = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    for (let j = 0; j < 3; j++) {
      const a = tri[j], b = tri[(j + 1) % 3];
      const az = p.getZ(a), bz = p.getZ(b);
      if (Math.abs(bz - az) < 1e-9) continue;
      const t = (z - az) / (bz - az);
      if (t >= 0 && t <= 1) lowest = Math.min(lowest, p.getY(a) + t * (p.getY(b) - p.getY(a)));
    }
  }
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

/** A thin, closed sheet. The two faces share a rim; no separate hanging blocks. */
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
  return geometry;
}

/** Fitted to the actual side covers; never extends below the exposed tail tip. */
export function addSupermotoRearProtection(
  body: THREE.Group,
  paint: THREE.MeshStandardMaterial,
  rubber: THREE.MeshStandardMaterial,
) {
  if (body.getObjectByName('supermoto-rear-protection-v35')) return;
  const tail = body.getObjectByName('supermoto-tail-fender');
  const cover = body.getObjectByName('supermoto-side-cover');
  const rail = body.getObjectByName('supermoto-rear-subframe');
  const airbox = body.getObjectByName('supermoto-airbox');
  if (!(tail instanceof THREE.Mesh) || !(cover instanceof THREE.Mesh) ||
      !(rail instanceof THREE.Mesh) || !(airbox instanceof THREE.Mesh)) {
    throw new Error('Build the Supermoto side covers and tail before its inner liner');
  }
  const boundary = readSideBoundary(cover);
  const frontZ = 0.50;
  const endZ = Math.max(...boundary.map(p => p[2]));
  const sections = new Map<number, { halfWidth: number; edgeY: number; crown: number }>();
  const section = (z: number) => {
    const cached = sections.get(z);
    if (cached) return cached;
    const edge = lowerEdgeAt(boundary, z);
    const roof = undersideAt(tail.geometry, 0, z);
    // The rim is inside the side-cover wall, not suspended below it.
    const edgeY = edge.y + 0.005;
    // Stay below the actual subframe tubes, so they cannot poke through the pan.
    const crown = Math.min(edgeY + 0.020, roof + 0.001,
      frameBottomAt(rail.geometry, z) - 0.006);
    const result = { halfWidth: edge.x + 0.001, edgeY, crown };
    sections.set(z, result);
    return result;
  };
  const linerPoint = (z: number, v: number): Point => {
    const p = section(z);
    const edgeT = Math.max(0, Math.min(1, (Math.abs(v) - 0.84) / 0.16));
    const edgeBlend = edgeT * edgeT * (3 - 2 * edgeT);
    return [p.halfWidth * v, p.crown + (p.edgeY - p.crown) * edgeBlend, z];
  };
  const parts = new THREE.Group();
  parts.name = 'supermoto-rear-protection-v35';
  const linerFinish = paint.clone();
  linerFinish.metalness = 0;
  linerFinish.roughness = 0.9;
  const liner = new THREE.Mesh(
    sheet(48, 20, (u, v) => linerPoint(frontZ + (endZ - frontZ) * u, v), [0, -0.003, 0]),
    linerFinish,
  );
  liner.name = 'supermoto-under-tail-liner';
  liner.castShadow = liner.receiveShadow = true;
  parts.add(liner);

  // Fastened to the underside immediately behind the spring, before the tire.
  // The free edge ends above the narrowest spring/tire gap.
  const mountZ = 0.40;

  const flapFinish = rubber.clone();
  flapFinish.color.set('#171717');
  flapFinish.metalness = 0;
  flapFinish.roughness = 1;
  const flap = new THREE.Mesh(
    sheet(20, 12, (u, v) => {
      const halfWidth = 0.083 - 0.009 * u * u;
      const x = halfWidth * v;
      const attachmentY = undersideAt(airbox.geometry, x, mountZ) + 0.001;
      const roundedCorner = 0.007 * Math.pow(Math.abs(v), 6) * u * u;
      return [
        x,
        attachmentY - 0.208 * u + roundedCorner,
        mountZ + 0.080 * u + 0.005 * Math.sin(Math.PI * u),
      ];
    }, [0, 0, -0.003]),
    flapFinish,
  );
  flap.name = 'supermoto-mudflap';
  flap.castShadow = flap.receiveShadow = true;
  parts.add(flap);
  body.add(parts);
}
