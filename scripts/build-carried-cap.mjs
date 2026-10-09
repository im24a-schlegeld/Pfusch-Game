/** Offline import: node scripts/build-carried-cap.mjs <obj.obj>.
 * One supplied cap, without duplicate copies, display stand or dense stitches.
 * Original embroidered PFUSCH catalog artwork is applied separately at runtime.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = fs.existsSync(
  path.join(root, '.build-check/node_modules/meshoptimizer'),
)
  ? '.build-check'
  : '.';
const require = createRequire(path.join(root, runtime, 'package.json'));
const THREE = require('three');
const threeRoot = path.resolve(path.dirname(require.resolve('three')), '..');
const { mergeVertices } = await import(
  pathToFileURL(
    path.join(threeRoot, 'examples/jsm/utils/BufferGeometryUtils.js'),
  ).href
);
const { MeshoptSimplifier } = await import(
  pathToFileURL(require.resolve('meshoptimizer/simplifier')).href
);
await MeshoptSimplifier.ready;
const selected = new Map([
  ['capSG1', [0, 2200]],
  ['cap_ncl1_1SG1', [0, 1200]], // complementary crown panels, not a duplicate/lining
  ['soportSG1', [1, 100]],
  ['broochFBXASC045backSG1', [1, 160]],
  ['broochSG1', [1, 220]],
  ['borderSG1', [1, 450]],
  ['visorSG1', [1, 700]],
]);
let vertices = [],
  normals = [],
  triangles = [],
  material = '',
  vertexCount = 0,
  normalCount = 0,
  vertexStart = 0,
  normalStart = 0;
const positions = [],
  packedNormals = [],
  indices = [],
  groups = [],
  audit = [];
const fx = 0.96365,
  fz = 0.26717,
  scale = 0.044;
function flush() {
  if (!selected.has(material) || !triangles.length) return;
  const [slot, budget] = selected.get(material),
    p = [],
    n = [];
  for (const [vi, ni] of triangles) {
    const [x, y, z] = vertices[vi - vertexStart - 1];
    const [nx, ny, nz] = normals[ni - normalStart - 1];
    p.push(
      (-fz * (x - 0.3563) + fx * (z + 1.0811)) * scale,
      (y - 5.010556) * scale,
      (-fx * (x - 0.3563) - fz * (z + 1.0811)) * scale,
    );
    n.push(-fz * nx + fx * nz, ny, -fx * nx - fz * nz);
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g = mergeVertices(g, 0.00001);
  const gp = g.getAttribute('position').array,
    gn = g.getAttribute('normal').array;
  const [simple] = MeshoptSimplifier.simplifyWithAttributes(
    new Uint32Array(g.index.array),
    gp,
    3,
    gn,
    3,
    [0.08, 0.08, 0.08],
    null,
    budget * 3,
    0.008,
    ['Permissive'],
  );
  const [remap, count] = MeshoptSimplifier.compactMesh(simple);
  const cp = new Float32Array(count * 3),
    cn = new Float32Array(count * 3);
  for (let i = 0; i < remap.length; i++)
    if (remap[i] !== 0xffffffff) {
      cp.set(gp.subarray(i * 3, i * 3 + 3), remap[i] * 3);
      cn.set(gn.subarray(i * 3, i * 3 + 3), remap[i] * 3);
    }
  const base = positions.length / 3;
  groups.push({ start: indices.length, count: simple.length, material: slot });
  positions.push(...cp);
  packedNormals.push(...cn);
  for (const i of simple) indices.push(base + i);
  audit.push({
    source: material,
    before: triangles.length / 3,
    after: simple.length / 3,
  });
}
// OBJ stores each part in its own contiguous block. Streaming avoids a 350 MB
// string and discards >1M stitch triangles before any geometry processing.
for await (const line of readline.createInterface({
  input: fs.createReadStream(process.argv[2]),
  crlfDelay: Infinity,
})) {
  if (line === 'g default') {
    flush();
    vertices = [];
    normals = [];
    triangles = [];
    material = '';
    vertexStart = vertexCount;
    normalStart = normalCount;
  } else if (line.startsWith('v ')) {
    vertices.push(line.slice(2).split(/\s+/).map(Number));
    vertexCount++;
  } else if (line.startsWith('vn ')) {
    normals.push(line.slice(3).split(/\s+/).map(Number));
    normalCount++;
  } else if (line.startsWith('usemtl ')) material = line.slice(7);
  else if (line.startsWith('f ') && selected.has(material)) {
    const face = line
      .slice(2)
      .split(/\s+/)
      .map((v) => {
        const [a, , c] = v.split('/');
        return [Number(a), Number(c)];
      });
    for (let i = 1; i < face.length - 1; i++)
      triangles.push(face[0], face[i], face[i + 1]);
  }
}
flush();
if (positions.length / 3 > 65535 || !indices.length)
  throw new Error('Invalid cap export');
const bytes = Buffer.alloc(positions.length * 4 + indices.length * 2);
positions.forEach((v, i) => bytes.writeInt16LE(Math.round(v * 100000), i * 2));
packedNormals.forEach((v, i) =>
  bytes.writeInt16LE(
    Math.max(-32767, Math.min(32767, Math.round(v * 32767))),
    (positions.length + i) * 2,
  ),
);
indices.forEach((v, i) => bytes.writeUInt16LE(v, positions.length * 4 + i * 2));
const asset = {
  vertices: positions.length / 3,
  indices: indices.length,
  groups,
  data: bytes.toString('base64'),
};
fs.writeFileSync(
  path.join(root, 'app/game/carriedCapAsset.ts'),
  '// Generated by scripts/build-carried-cap.mjs from the user-supplied cap OBJ.\nexport const CARRIED_CAP_ASSET = ' +
    JSON.stringify(asset) +
    ' as const;\n',
);
fs.writeFileSync(
  path.join(root, 'outputs/carried-cap-preview.json'),
  JSON.stringify({ positions, indices, groups }),
);
console.log(
  JSON.stringify(
    {
      vertices: asset.vertices,
      triangles: indices.length / 3,
      bytes: bytes.length,
      parts: audit,
    },
    null,
    2,
  ),
);
