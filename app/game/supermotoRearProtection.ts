import * as THREE from 'three';

type Point = [number, number, number];
type EdgeSample = { x: number; y: number };

function smoothstep(a: number, b: number, t: number) {
  const x = THREE.MathUtils.clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
}

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
      if (t >= 0 && t <= 1) {
        lowest = Math.min(lowest, p.getY(a) + t * (p.getY(b) - p.getY(a)));
      }
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

function reshapeSideCover(cover: THREE.Mesh) {
  const geometry = cover.geometry;
  const p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const absX = Math.abs(x);
    let y = p.getY(i);
    let z = p.getZ(i);

    // Rear side plastic: lower and slightly longer like the references.
    const rear = smoothstep(0.50, 0.86, z);
    const rearLowerBand = 1 - smoothstep(0.79, 1.02, y);
    y -= rear * (0.045 + 0.105 * rearLowerBand);
    z += rear * rearLowerBand * 0.018;
    const rearOut = rear * (0.18 + 0.82 * rearLowerBand);
    const newAbsX = absX + 0.002 + rearOut * 0.011;

    // Front lower angle: stronger slash and fuller descent like a real shroud.
    const front = 1 - smoothstep(0.28, 0.56, z);
    const frontLowerBand = 1 - smoothstep(0.82, 0.97, y);
    y -= front * frontLowerBand * 0.068;
    z -= front * frontLowerBand * 0.022;
    const frontOut = front * (0.25 + 0.75 * frontLowerBand) * 0.01;

    p.setXYZ(i, Math.sign(x) * (newAbsX + frontOut), y, z);
  }
  p.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function addRiderFootpegs(body: THREE.Group) {
  if (body.getObjectByName('supermoto-rider-footpeg-left')) return;

  const dark = new THREE.MeshStandardMaterial({
    color: '#25292c',
    metalness: 0.46,
    roughness: 0.56,
  });
  const alloy = new THREE.MeshStandardMaterial({
    color: '#b5bcc0',
    metalness: 0.74,
    roughness: 0.34,
  });

  const group = new THREE.Group();
  group.name = 'supermoto-rider-footpeg-assembly-v36';

  for (const s of [-1, 1]) {
    const peg = new THREE.Group();
    peg.name = s < 0 ? 'supermoto-rider-footpeg-left' : 'supermoto-rider-footpeg-right';

    const mount = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.032, 0.012), dark);
    mount.position.set(s * 0.112, 0.418, 0.158);
    peg.add(mount);

    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.04), dark);
    brace.position.set(s * 0.126, 0.405, 0.174);
    brace.rotation.z = s * 0.42;
    peg.add(brace);

    const platform = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.011, 0.020), alloy);
    platform.position.set(s * 0.157, 0.396, 0.182);
    peg.add(platform);

    for (let i = 0; i < 5; i++) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.004, 0.018), alloy);
      tooth.position.set(
        s * (0.138 + i * 0.0095),
        0.403,
        0.182,
      );
      peg.add(tooth);
    }

    const endCap = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.014, 0.022), dark);
    endCap.position.set(s * 0.182, 0.397, 0.182);
    peg.add(endCap);

    group.add(peg);
  }

  body.add(group);
}

/** Fits the side plastics lower and adds undertail + mudflap + rider pegs. */
export function addSupermotoRearProtection(
  body: THREE.Group,
  paint: THREE.MeshStandardMaterial,
  rubber: THREE.MeshStandardMaterial,
) {
  if (body.getObjectByName('supermoto-rear-protection-v36')) return;

  const tail = body.getObjectByName('supermoto-tail-fender');
  const cover = body.getObjectByName('supermoto-side-cover');
  const rail = body.getObjectByName('supermoto-rear-subframe');
  const airbox = body.getObjectByName('supermoto-airbox');

  if (!(tail instanceof THREE.Mesh) || !(cover instanceof THREE.Mesh) ||
      !(rail instanceof THREE.Mesh) || !(airbox instanceof THREE.Mesh)) {
    throw new Error('Build the Supermoto side covers and tail before its inner liner');
  }

  reshapeSideCover(cover);
  const boundary = readSideBoundary(cover);
  const frontZ = 0.44;
  const endZ = Math.max(...boundary.map(p => p[2]));
  const sections = new Map<number, { halfWidth: number; edgeY: number; crown: number }>();

  const section = (z: number) => {
    const cached = sections.get(z);
    if (cached) return cached;
    const edge = lowerEdgeAt(boundary, z);
    const roof = undersideAt(tail.geometry, 0, z);

    // Keep the liner close to the lowered side plastics, with more visible drop.
    const edgeY = edge.y + 0.004;
    const crown = Math.min(
      edgeY + 0.026,
      roof - 0.002,
      frameBottomAt(rail.geometry, z) - 0.004,
    );
    const result = { halfWidth: edge.x + 0.001, edgeY, crown };
    sections.set(z, result);
    return result;
  };

  const linerPoint = (z: number, v: number): Point => {
    const p = section(z);
    const inner = 1 - Math.pow(Math.abs(v), 1.2);
    const edgeBlend = Math.pow(Math.abs(v), 1.65);
    return [
      p.halfWidth * v,
      p.crown * inner + p.edgeY * edgeBlend,
      z + 0.002 * inner,
    ];
  };

  const parts = new THREE.Group();
  parts.name = 'supermoto-rear-protection-v36';

  const linerFinish = paint.clone();
  linerFinish.metalness = 0;
  linerFinish.roughness = 0.92;
  const liner = new THREE.Mesh(
    sheet(
      56,
      22,
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
  addRiderFootpegs(body);
}
