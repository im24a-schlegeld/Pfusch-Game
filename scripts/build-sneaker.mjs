/** Offline only: node scripts/build-sneaker.mjs <Unbranded_white_Sneaker.usdz>.
 * Retains the supplied upper, sole and laces; omits hidden insole, dense eyelets
 * and every texture (including the leather normal map). No USD loader ships.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadMotorcycleSource } from './build-motorcycle-asset.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = fs.existsSync(path.join(root, '.build-check/node_modules/meshoptimizer')) ? '.build-check' : '.';
const require = createRequire(path.join(root, runtime, 'package.json'));
const THREE = require('three');
const threeRoot = path.resolve(path.dirname(require.resolve('three')), '..');
const { mergeVertices } = await import(pathToFileURL(path.join(threeRoot, 'examples/jsm/utils/BufferGeometryUtils.js')).href);
const { MeshoptSimplifier } = await import(pathToFileURL(require.resolve('meshoptimizer/simplifier')).href);
await MeshoptSimplifier.ready;
let id = 0;
const source = loadMotorcycleSource(process.argv[2], (mesh) => {
  // The USD contains two distinct upper meshes with the same name.
  mesh.name += `_${id++}`;
  return !/metal|Insole/.test(mesh.name);
});
const box = source.sourceBounds, center = box.getCenter(new THREE.Vector3());
const scale = 0.30 / (box.max.x - box.min.x);
const positions = [], normals = [], indices = [], groups = [], audit = [];
for (const mesh of source.meshes) {
  const src = source.worldPositions.get(mesh.name), sn = source.worldNormals.get(mesh.name);
  const p = new Float32Array(src.length), n = new Float32Array(sn.length);
  for (let i = 0; i < p.length; i += 3) {
    // The supplied low toe points -X (the tall heel/collar is +X).
    // Preserve the existing packed +Z toe frame; createSneaker rotates its
    // positions and normals 180° around Y once to motorcycle forward -Z.
    p[i] = (src[i + 2] - center.z) * scale;
    p[i + 1] = (src[i + 1] - box.min.y) * scale;
    p[i + 2] = -(src[i] - center.x) * scale;
    n[i] = sn[i + 2]; n[i + 1] = sn[i + 1]; n[i + 2] = -sn[i];
  }
  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(p, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  geometry = mergeVertices(geometry, 0.00002);
  const gp = geometry.attributes.position.array, gn = geometry.attributes.normal.array;
  const slot = /WhiteSole|Normal/.test(mesh.name) ? 1 : /Satin/.test(mesh.name) ? 2 : 0;
  const budget = slot === 1 ? 220 : slot === 2 ? 160 : 350;
  const [simple] = MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(geometry.index.array),
    gp, 3, gn, 3, [0.035, 0.035, 0.035], null, budget * 3, 0.07, ['Permissive']);
  const [remap, count] = MeshoptSimplifier.compactMesh(simple);
  const cp = new Float32Array(count * 3), cn = new Float32Array(count * 3);
  for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) {
    cp.set(gp.subarray(i * 3, i * 3 + 3), remap[i] * 3);
    cn.set(gn.subarray(i * 3, i * 3 + 3), remap[i] * 3);
  }
  const offset = positions.length / 3;
  groups.push({ start: indices.length, count: simple.length, material: slot });
  positions.push(...cp); normals.push(...cn); indices.push(...Array.from(simple, i => i + offset));
  audit.push({ part: mesh.name, sourceTriangles: src.length / 9, triangles: simple.length / 3 });
  geometry.dispose();
}
if (positions.length / 3 > 65535) throw new Error('Sneaker exceeds packed vertex budget');
// Consolidate source pieces into three material draws, not eight per foot.
const groupedIndices = [], materialGroups = [];
for (const material of [0, 1, 2]) {
  const start = groupedIndices.length;
  for (const group of groups) if (group.material === material)
    groupedIndices.push(...indices.slice(group.start, group.start + group.count));
  materialGroups.push({ start, count: groupedIndices.length - start, material });
}
const packedPosition = new Int16Array(positions.map(v => Math.round(v * 100000)));
const packedNormal = new Int16Array(normals.map(v => Math.round(Math.max(-1, Math.min(1, v)) * 32767)));
const packedIndex = new Uint16Array(groupedIndices);
const data = Buffer.concat([Buffer.from(packedPosition.buffer), Buffer.from(packedNormal.buffer), Buffer.from(packedIndex.buffer)]).toString('base64');
const asset = { vertices: positions.length / 3, indices: indices.length, groups: materialGroups, data };
fs.writeFileSync(path.join(root, 'app/game/sneakerAsset.ts'),
  '// Generated from the supplied Unbranded_white_Sneaker.usdz by scripts/build-sneaker.mjs. No textures.\n' +
  'export const SNEAKER_ASSET = ' + JSON.stringify(asset) + ' as const;\n');
fs.mkdirSync(path.join(root, 'outputs/sneaker'), { recursive: true });
fs.writeFileSync(path.join(root, 'outputs/sneaker/conversion.json'), JSON.stringify(audit, null, 2));
console.log(JSON.stringify({ sourceTriangles: audit.reduce((n, p) => n + p.sourceTriangles, 0), triangles: indices.length / 3, vertices: asset.vertices, geometryBytes: data.length * 0.75, audit }, null, 2));
