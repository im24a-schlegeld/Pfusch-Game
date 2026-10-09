/** Offline conversion of the original assembled Normal/Solid Rossi helmet.
 * node scripts/build-rossi-helmet.mjs <Version2 directory> <complete solid STL>
 * The separate shell only identifies paintable surfaces; the solid supplies
 * every visible position, including the correctly assembled original visor.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = fs.existsSync(
  path.join(root, '.build-check/node_modules/meshoptimizer'),
)
  ? path.join(root, '.build-check')
  : root;
const require = createRequire(path.join(runtime, 'package.json'));
const threeRoot = path.resolve(path.dirname(require.resolve('three')), '..');
const THREE = require('three');
const { STLLoader } = await import(
  pathToFileURL(path.join(threeRoot, 'examples/jsm/loaders/STLLoader.js')).href
);
const { mergeVertices } = await import(
  pathToFileURL(
    path.join(threeRoot, 'examples/jsm/utils/BufferGeometryUtils.js'),
  ).href
);
const { MeshoptSimplifier } = await import(
  pathToFileURL(require.resolve('meshoptimizer/simplifier')).href
);
await MeshoptSimplifier.ready;
const source = process.argv[2];
if (!source)
  throw new Error('Pass the extracted Normal/Pieces/Version2 directory.');
const HELMET_TILT = -0.36;
const buckets = [[], [], []],
  tilt = new THREE.Matrix4().makeRotationX(HELMET_TILT);
let sourceTriangles = 0,
  removedInteriorTriangles = 0;
// Use the original assembled solid, so the visor stays in its authored pose.
const shellBytes = fs.readFileSync(path.join(source, 'Helmet.STL'));
const shellGeometry = new STLLoader().parse(
  shellBytes.buffer.slice(
    shellBytes.byteOffset,
    shellBytes.byteOffset + shellBytes.byteLength,
  ),
);
const shellPositions = shellGeometry.attributes.position;
const hash = (x, y, z) => [x, y, z].map((v) => Math.round(v * 10)).join(',');
const shellPoints = new Set();
for (let i = 0; i < shellPositions.count; i++)
  shellPoints.add(
    hash(
      shellPositions.getX(i) + 0.004,
      shellPositions.getY(i) - 0.272,
      shellPositions.getZ(i),
    ),
  );
const onShell = (x, y, z) =>
  [-0.1, 0, 0.1].some((dx) =>
    [-0.1, 0, 0.1].some((dy) =>
      [-0.1, 0, 0.1].some((dz) =>
        shellPoints.has(hash(x + dx, y + dy, z + dz)),
      ),
    ),
  );
const solidPath = process.argv[3];
if (!solidPath)
  throw new Error(
    'Pass the complete Normal/Solid/Helmet with visor.STL as the third argument.',
  );
const bytes = fs.readFileSync(solidPath);
if (bytes.length !== 84 + bytes.readUInt32LE(80) * 50)
  throw new Error('Incomplete solid STL');
const geometry = new STLLoader().parse(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
const p = geometry.attributes.position,
  n = geometry.attributes.normal;
sourceTriangles = p.count / 3;
for (let i = 0; i < p.count; i += 3) {
  let matches = 0;
  for (let j = i; j < i + 3; j++)
    if (onShell(p.getX(j), p.getY(j), p.getZ(j))) matches++;
  const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3,
    y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3,
    z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
  const material = matches < 2 && z < 59 ? 1 : 0;
  if (
    material === 0 &&
    Math.abs(x + 0.489) < 27 &&
    y > -36 &&
    y < 14 &&
    z > 14 &&
    z < 63 &&
    n.getX(i) * (x + 0.489) + n.getY(i) * (y + 10) + n.getZ(i) * (z - 38) < -5
  ) {
    removedInteriorTriangles++;
    continue;
  }
  for (let j = i; j < i + 3; j++) {
    const point = new THREE.Vector3(
      (p.getX(j) + 0.489) * 0.0034,
      (p.getZ(j) - 36.511) * 0.0034,
      -(p.getY(j) + 6.818) * 0.0034,
    ).applyMatrix4(tilt);
    point.z -= 0.008;
    buckets[material].push(point.x, point.y, point.z);
  }
}
geometry.dispose();
shellGeometry.dispose();
const positions = [],
  normals = [],
  indices = [],
  groups = [],
  parts = [];
for (const [materialIndex, budget] of [
  [0, 4800],
  [1, 650],
]) {
  if (!buckets[materialIndex].length)
    throw new Error(`Missing material ${materialIndex}`);
  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(buckets[materialIndex], 3),
  );
  geometry = mergeVertices(geometry, 1e-6);
  const before = geometry.index.count / 3;
  const [simple, error] = MeshoptSimplifier.simplify(
    new Uint32Array(geometry.index.array),
    geometry.attributes.position.array,
    3,
    Math.min(geometry.index.count, budget * 3),
    0.003,
    ['Permissive'],
  );
  geometry.setIndex(new THREE.BufferAttribute(simple, 1));
  // Compact away unused source vertices before computing smooth lighting.
  geometry = mergeVertices(geometry.toNonIndexed(), 1e-6);
  const valid = [];
  for (let i = 0; i < geometry.index.count; i += 3) {
    const triangle = [0, 1, 2].map((j) => geometry.index.getX(i + j));
    const [a, b, c] = triangle.map((index) =>
      new THREE.Vector3().fromBufferAttribute(
        geometry.attributes.position,
        index,
      ),
    );
    if (b.sub(a).cross(c.sub(a)).lengthSq() > 1e-20) valid.push(...triangle);
  }
  geometry.setIndex(valid);
  geometry = mergeVertices(geometry.toNonIndexed(), 1e-6);
  // Rebuild normals after deleting the invisible print lining. Source normals
  // at coincident inside/outside vertices otherwise create dark rear dents.
  geometry.computeVertexNormals();
  // At a thin printable lip, coincident opposite faces can cancel the averaged
  // normal. Use an incident face normal only for those zero-length results.
  for (let i = 0; i < geometry.index.count; i += 3) {
    const triangle = [0, 1, 2].map((j) => geometry.index.getX(i + j));
    const [a, b, c] = triangle.map((index) =>
      new THREE.Vector3().fromBufferAttribute(
        geometry.attributes.position,
        index,
      ),
    );
    const face = b.sub(a).cross(c.sub(a)).normalize();
    for (const index of triangle) {
      const n = new THREE.Vector3().fromBufferAttribute(
        geometry.attributes.normal,
        index,
      );
      if (n.lengthSq() < 1e-12)
        geometry.attributes.normal.setXYZ(index, face.x, face.y, face.z);
    }
  }
  const offset = positions.length / 3,
    start = indices.length;
  for (const value of geometry.attributes.position.array) positions.push(value);
  for (const value of geometry.attributes.normal.array) normals.push(value);
  const painted = [],
    dark = [];
  const inverseTilt = tilt.clone().invert();
  const normal = new THREE.Vector3();
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const read = (index) =>
    new THREE.Vector3()
      .fromBufferAttribute(geometry.attributes.position, index)
      .add(new THREE.Vector3(0, 0, 0.008))
      .applyMatrix4(inverseTilt)
      .divideScalar(0.0034);
  for (let i = 0; i < geometry.index.count; i += 3) {
    const ia = geometry.index.getX(i),
      ib = geometry.index.getX(i + 1),
      ic = geometry.index.getX(i + 2);
    a.copy(read(ia));
    b.copy(read(ib));
    c.copy(read(ic));
    normal.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    const middle = a
      .clone()
      .add(b)
      .add(c)
      .multiplyScalar(1 / 3);
    const x = middle.x,
      y = -middle.z - 6.545,
      z = middle.y + 36.511;
    const recess =
      materialIndex === 0 &&
      ((Math.abs(x) < 5 && y > 20 && z > 61 && normal.y < 0.65) ||
        (Math.abs(x) < 12 && y > 35 && z > 12 && z < 29 && -normal.z < 0.5));
    (recess ? dark : painted).push(ia + offset, ib + offset, ic + offset);
  }
  for (const value of painted) indices.push(value);
  groups.push({ start, count: painted.length, material: materialIndex });
  if (dark.length) buckets[2] = dark;
  parts.push({
    materialIndex,
    sourceTriangles: before,
    triangles: geometry.index.count / 3,
    error,
  });
  geometry.dispose();
}
const darkStart = indices.length;
for (const value of buckets[2]) indices.push(value);
groups.push({ start: darkStart, count: buckets[2].length, material: 2 });
if (
  positions.length / 3 > 65535 ||
  positions.some((v) => !Number.isFinite(v) || Math.abs(v) > 0.32767)
)
  throw new Error('Geometry exceeds packed range');
const p16 = new Int16Array(positions.map((v) => Math.round(v * 1e5)));
const n16 = new Int16Array(normals.map((v) => Math.round(v * 32767)));
const packed = Buffer.concat([
  Buffer.from(p16.buffer),
  Buffer.from(n16.buffer),
  Buffer.from(new Uint16Array(indices).buffer),
]);
const bounds = new THREE.Box3().setFromArray(positions);
const report = {
  sourceTriangles,
  removedInteriorTriangles,
  triangles: indices.length / 3,
  vertices: positions.length / 3,
  geometryBytes: packed.length,
  bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
  tiltRadians: HELMET_TILT,
  parts,
};
if (report.triangles >= 7000 || packed.length >= 90000)
  throw new Error(`Asset budget exceeded: ${JSON.stringify(report)}`);
const asset = {
  vertices: report.vertices,
  indices: indices.length,
  groups,
  data: packed.toString('base64'),
};
fs.writeFileSync(
  path.join(root, 'app/game/fullfaceHelmetAsset.ts'),
  `// Generated by scripts/build-rossi-helmet.mjs. Plain shell, visor and vents; no artwork or print screws.\nexport const FULLFACE_HELMET_ASSET = ${JSON.stringify(asset)} as const;\n`,
);
fs.mkdirSync(path.join(root, 'outputs/rossi-helmet'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'outputs/rossi-helmet/export.json'),
  JSON.stringify(report, null, 2),
);
fs.writeFileSync(
  path.join(root, 'outputs/fullface-helmet-preview.json'),
  JSON.stringify({ positions, normals, indices, groups }),
);
console.log(JSON.stringify(report, null, 2));
