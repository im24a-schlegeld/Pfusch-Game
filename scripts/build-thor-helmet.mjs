/** Offline import: node scripts/build-thor-helmet.mjs <extracted source directory>.
 * RadekC Thor clean _1 variants; the other versions include print supports.
 * One uniform conversion fits the existing adult head on every bike.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  runtime = fs.existsSync(
    path.join(root, '.build-check/node_modules/meshoptimizer'),
  )
    ? '.build-check'
    : '.',
  require = createRequire(path.join(root, runtime, 'package.json')),
  THREE = require('three'),
  threeRoot = path.resolve(path.dirname(require.resolve('three')), '..');
const { STLLoader } = await import(
  pathToFileURL(path.join(threeRoot, 'examples/jsm/loaders/STLLoader.js'))
);
const { mergeVertices } = await import(
  pathToFileURL(
    path.join(threeRoot, 'examples/jsm/utils/BufferGeometryUtils.js'),
  )
);
const { MeshoptSimplifier } = await import(
  pathToFileURL(require.resolve('meshoptimizer/simplifier'))
);
await MeshoptSimplifier.ready;

/** Remove the small print-hanger above the rear crown, preserving its base skin. */
function removePrintHanger(geometry) {
  const p = geometry.attributes.position, moved = new Uint8Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const sourceX = 2 - (p.getZ(i) + .005) / .00565;
    const sourceZ = p.getX(i) / .00565;
    if (sourceX < -15 || sourceX > -3.5 || Math.abs(sourceZ) > 2.3) continue;
    // Continue the original crown between the hanger's two feet.
    const t = sourceX + 4;
    const crown = (46.39 + .36 * t - .006 * t * t - .07 * sourceZ * sourceZ - 20.17) * .00565;
    if (p.getY(i) > crown) { p.setY(i, crown); moved[i] = 1; }
  }
  const kept = [], face = new THREE.Triangle(), normal = new THREE.Vector3();
  for (let i = 0; i < geometry.index.count; i += 3) {
    const ids = [0, 1, 2].map(j => geometry.index.getX(i + j));
    [face.a, face.b, face.c].forEach((v, j) => v.fromBufferAttribute(p, ids[j]));
    if (face.getArea() < 1e-12) continue;
    if (ids.some(id => moved[id]) && face.getNormal(normal).y <= 0) continue;
    kept.push(...ids);
  }
  geometry.setIndex(kept);
  return mergeVertices(geometry.toNonIndexed(), .000002);
}

/** Fair only the embossed side-letter strip; its surrounding molded rails stay fixed. */
function removeSideLettering(geometry) {
  const p = geometry.attributes.position, selected = new Set(), neighbors = new Map();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i), diagonal = y - .47 * z;
    if (Math.abs(p.getX(i)) > .085 && z > -.055 && z < .10 && diagonal > -.069 && diagonal < -.022)
      selected.add(i);
  }
  for (const i of selected) neighbors.set(i, new Set());
  for (let i = 0; i < geometry.index.count; i += 3) {
    const ids = [0, 1, 2].map(j => geometry.index.getX(i + j));
    for (const a of ids) if (selected.has(a)) for (const b of ids) if (a !== b) neighbors.get(a).add(b);
  }
  const values = new Float32Array(p.count);
  for (let iteration = 0; iteration < 160; iteration++) {
    for (const a of selected) {
      let total = 0, weight = 0;
      for (const b of neighbors.get(a)) {
        const distance = Math.hypot(p.getY(a) - p.getY(b), p.getZ(a) - p.getZ(b));
        const w = 1 / Math.max(.0005, distance);
        total += p.getX(b) * w; weight += w;
      }
      values[a] = weight ? total / weight : p.getX(a);
    }
    for (const a of selected) p.setX(a, values[a]);
  }
  // Fine letter topology must not leave a readable normal imprint. Reconstruct
  // its unbranded quadratic skin from the unchanged surrounding panel border.
  for (const sign of [-1, 1]) fairPatch(geometry, [...selected].filter(i => p.getX(i) * sign > 0), 0);
  const rear = [];
  for (let i = 0; i < p.count; i++)
    if (p.getZ(i) > .105 && p.getX(i) > -.053 && p.getX(i) < .053 && p.getY(i) > -.092 && p.getY(i) < -.038)
      rear.push(i);
  fairPatch(geometry, rear, 2);
  const rearBadge = [];
  for (let i = 0; i < p.count; i++)
    if (p.getZ(i) > .11 && Math.abs(p.getX(i)) < .037 && p.getY(i) > .025 && p.getY(i) < .083)
      rearBadge.push(i);
  fairPatch(geometry, rearBadge, 2);
}

/** Surface-only refit. The embossed region's tangential coordinates do not move. */
function fairPatch(geometry, selectedIds, axis) {
  const p = geometry.attributes.position, selected = new Set(selectedIds), border = new Set();
  for (let i = 0; i < geometry.index.count; i += 3) {
    const ids = [0, 1, 2].map(j => geometry.index.getX(i + j));
    if (ids.some(id => selected.has(id))) for (const id of ids) if (!selected.has(id)) border.add(id);
  }
  const basis = i => {
    const u = (axis === 0 ? p.getZ(i) : p.getX(i)) * 10, v = p.getY(i) * 10;
    return [1, u, v, u * u, u * v, v * v];
  };
  const rows = Array.from({ length: 6 }, () => new Float64Array(7));
  for (const i of border) {
    const a = basis(i), value = p.array[i * 3 + axis];
    for (let j = 0; j < 6; j++) {
      for (let k = 0; k < 6; k++) rows[j][k] += a[j] * a[k];
      rows[j][6] += a[j] * value;
    }
  }
  for (let j = 0; j < 6; j++) {
    let pivot = j;
    for (let k = j + 1; k < 6; k++) if (Math.abs(rows[k][j]) > Math.abs(rows[pivot][j])) pivot = k;
    [rows[j], rows[pivot]] = [rows[pivot], rows[j]];
    if (Math.abs(rows[j][j]) < 1e-10) return;
    const divisor = rows[j][j];
    for (let k = j; k < 7; k++) rows[j][k] /= divisor;
    for (let row = 0; row < 6; row++) if (row !== j) {
      const scale = rows[row][j];
      for (let k = j; k < 7; k++) rows[row][k] -= scale * rows[j][k];
    }
  }
  for (const i of selected) {
    const value = basis(i).reduce((total, a, j) => total + a * rows[j][6], 0);
    if (Math.abs(value - p.array[i * 3 + axis]) > .012) throw new Error('Letter repair exceeds the source panel.');
    p.array[i * 3 + axis] = value;
  }
  const key = i => [p.getX(i), p.getY(i), p.getZ(i)].map(v => Math.round(v * 1e6)).join(',');
  geometry.userData.repairedNormals ??= new Map();
  for (const i of selected) {
    const [, u, v] = basis(i);
    const du = 10 * (rows[1][6] + 2 * rows[3][6] * u + rows[4][6] * v);
    const dv = 10 * (rows[2][6] + rows[4][6] * u + 2 * rows[5][6] * v);
    const normal = axis === 0
      ? new THREE.Vector3(1, -dv, -du).multiplyScalar(Math.sign(p.getX(i))).normalize()
      : new THREE.Vector3(-du, -dv, 1).normalize();
    geometry.userData.repairedNormals.set(key(i), normal.toArray());
  }
  // Embossed glyph walls collapse onto this skin. Remove their now-zero-area
  // or inward duplicate faces before welding, rather than retaining ghost ink.
  const kept = [], face = new THREE.Triangle(), normal = new THREE.Vector3();
  for (let i = 0; i < geometry.index.count; i += 3) {
    const ids = [0, 1, 2].map(j => geometry.index.getX(i + j));
    [face.a, face.b, face.c].forEach((v, j) => v.fromBufferAttribute(p, ids[j]));
    if (face.getArea() < 1e-11) continue;
    if (ids.every(id => selected.has(id))) {
      const sign = axis === 0 ? Math.sign(p.getX(ids[0])) : 1;
      if (face.getNormal(normal).getComponent(axis) * sign <= 0) continue;
    }
    kept.push(...ids);
  }
  geometry.setIndex(kept);
}
const positions = [],
  normals = [],
  indices = [],
  groups = [],
  parts = [];
for (const [file, budget] of [
  ['thor_helmet_1.stl', 4300],
  ['thor_helmet_visor_1.stl', 750],
]) {
  const bytes = fs.readFileSync(path.join(process.argv[2], file));
  let g = new STLLoader().parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  g.deleteAttribute('normal');
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    p.setXYZ(i, z * 0.00565, (y - 20.17) * 0.00565, -(x - 2) * 0.00565 - 0.005);
  }
  g = mergeVertices(g, 0.000002);
  const before = g.index.count / 3;
  if (file === 'thor_helmet_1.stl') g = removePrintHanger(g);
  const [simple] = MeshoptSimplifier.simplify(
    new Uint32Array(g.index.array),
    g.attributes.position.array,
    3,
    budget * 3,
    0.008,
    ['Permissive'],
  );
  g.setIndex(new THREE.BufferAttribute(simple, 1));
  g = mergeVertices(g.toNonIndexed(), 0.000002);
  if (file === 'thor_helmet_1.stl') {
    removeSideLettering(g);
    const repaired = g.userData.repairedNormals;
    g = mergeVertices(g.toNonIndexed(), .000002);
    g.userData.repairedNormals = repaired;
  }
  g.computeVertexNormals();
  if (g.userData.repairedNormals) {
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const key = [p.getX(i), p.getY(i), p.getZ(i)].map(v => Math.round(v * 1e6)).join(',');
      const repaired = g.userData.repairedNormals.get(key);
      if (repaired) n.setXYZ(i, ...repaired);
    }
  }
  const offset = positions.length / 3,
    start = indices.length;
  positions.push(...g.attributes.position.array);
  normals.push(...g.attributes.normal.array);
  const outer = [],
    inner = [],
    face = new THREE.Triangle(),
    normal = new THREE.Vector3(),
    center = new THREE.Vector3();
  for (let i = 0; i < g.index.count; i += 3) {
    const ids = [0, 1, 2].map((j) => g.index.getX(i + j));
    [face.a, face.b, face.c].forEach((v, j) =>
      v.fromBufferAttribute(g.attributes.position, ids[j]),
    );
    face.getNormal(normal);
    face.getMidpoint(center);
    center.y -= 0.015;
    const inward = normal.dot(center.normalize()) < -0.18;
    (inward ? inner : outer).push(...ids.map((id) => id + offset));
  }
  indices.push(...outer, ...inner);
  groups.push({
    start,
    count: indices.length - start,
    material: 0,
    outerCount: outer.length,
  });
  parts.push({ file, before, after: indices.length / 3 - start / 3 });
}
const p16 = new Int16Array(positions.map((v) => Math.round(v * 1e5))),
  n16 = new Int16Array(normals.map((v) => Math.round(v * 32767))),
  packed = Buffer.concat([
    Buffer.from(p16.buffer),
    Buffer.from(n16.buffer),
    Buffer.from(new Uint16Array(indices).buffer),
  ]);
if (packed.length > 95000 || positions.length / 3 > 65535)
  throw Error('Asset budget');
const asset = {
  vertices: positions.length / 3,
  indices: indices.length,
  groups,
  data: packed.toString('base64'),
};
fs.writeFileSync(
  path.join(root, 'app/game/motocrossHelmetAsset.ts'),
  '// Generated from user-supplied Thor shell and peak by scripts/build-thor-helmet.mjs.\nexport const MOTOCROSS_HELMET_ASSET = ' +
    JSON.stringify(asset) +
    ' as const;\n',
);
fs.writeFileSync(
  path.join(root, 'outputs/thor-helmet-preview.json'),
  JSON.stringify({ positions, normals, indices, groups }),
);
const report = {
  parts,
  vertices: asset.vertices,
  triangles: indices.length / 3,
  bytes: packed.length,
};
fs.writeFileSync(
  path.join(root, 'outputs/thor-helmet-export.json'),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
