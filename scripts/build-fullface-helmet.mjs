/** Offline plain racing helmet: node scripts/build-fullface-helmet.mjs <source.usdz>.
 * Keeps the supplied outer shell/visor, removes decals, straps and hidden lining.
 * The browser receives one compact, synchronous geometry payload and no textures.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadMotorcycleSource } from './build-motorcycle-asset.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = fs.existsSync(path.join(root, '.build-check/node_modules/meshoptimizer')) ? path.join(root, '.build-check') : root;
const require = createRequire(path.join(runtime, 'package.json'));
const threeRoot = path.resolve(path.dirname(require.resolve('three')), '..');
const { mergeVertices } = await import(pathToFileURL(path.join(threeRoot, 'examples/jsm/utils/BufferGeometryUtils.js')).href);
const { MeshoptSimplifier } = await import(pathToFileURL(require.resolve('meshoptimizer/simplifier')).href);
await MeshoptSimplifier.ready;
const source = loadMotorcycleSource(process.argv[2]);
const { THREE, meshes, worldPositions, worldNormals } = source;
const shellBounds = source.meshBox('Object_0');
const scale = .299 / (shellBounds.max.y - shellBounds.min.y);
const center = shellBounds.getCenter(new THREE.Vector3());
const visorBounds = source.meshBox('Object_2');
const ease = (value, low, high) => { const t = Math.max(0, Math.min(1, (value - low) / (high - low))); return t * t * (3 - 2 * t); };
const slope = (value, low, high) => { const t = (value - low) / (high - low); return t > 0 && t < 1 ? 6 * t * (1 - t) / (high - low) : 0; };
const edgeLow = shellBounds.min.y + .010, edgeHigh = shellBounds.min.y + .040;
function visorLift(y, z) {
  // Raise only the upper visor and its adjoining brow, blending back into the
  // original shell within 3 cm. The crown, rear, chin and shell width stay intact.
  const rise = ease(y, visorBounds.min.y, visorBounds.max.y);
  const fall = 1 - ease(y, visorBounds.max.y, visorBounds.max.y + .055);
  const front = 1 - ease(z, visorBounds.max.z, visorBounds.max.z + .04);
  return { amount: .008 * rise * fall * front,
    dy: .008 * (slope(y, visorBounds.min.y, visorBounds.max.y) * fall
      - rise * slope(y, visorBounds.max.y, visorBounds.max.y + .055)) * front,
    dz: -.008 * rise * fall * slope(z, visorBounds.max.z, visorBounds.max.z + .04) };
}
function restyle(x, y, z) {
  // Preserve the supplied shell, chin and rear opening silhouettes.
  // Only tuck the very bottom front edge inward by at most 1.1 mm at game scale.
  const edge = (1 - ease(y, edgeLow, edgeHigh)) * (1 - ease(z, -.10, .06));
  return [(x - center.x) * scale,
    (y - center.y + visorLift(y, z).amount) * scale + .0045,
    (z - center.z + .002 * edge) * scale];
}
function restyleNormal(x, y, z, nx, ny, nz) {
  const edgeY = 1 - ease(y, edgeLow, edgeHigh), edgeZ = 1 - ease(z, -.10, .06);
  const dy = -.002 * slope(y, edgeLow, edgeHigh) * edgeZ;
  const dz = 1 - .002 * edgeY * slope(z, -.10, .06);
  const lift = visorLift(y, z), yy = 1 + lift.dy;
  // Inverse-transpose keeps the small edge/visor adjustments naturally lit.
  const determinant = yy * dz - lift.dz * dy;
  const ty = (dz * ny - dy * nz) / determinant, tz = (yy * nz - lift.dz * ny) / determinant;
  const length = Math.hypot(nx, ty, tz) || 1;
  return [nx / length, ty / length, tz / length];
}
// Material slots preserve existing paint, visor and sticker behavior.
const selected = [
  ['Object_0', 0, 3600, .004], // continuous paint shell; original graphic atlas omitted
  ['Object_2', 1, 800, .004], // actual visor, not its separate logo strip (Object_13)
  ['Object_10', 2, 120, .035], // dense chin grille reduced to a plain dark recess
];
const groups = [], positions = [], normals = [], indices = [], audit = [];
// Seal only small openings formerly covered by the removed forehead intake
// and visor screws. Preserve the visor perimeter, neck opening and chin vents.
function closeRemovedMounts(name, sourcePosition, sourceNormal) {
  if (name !== 'Object_0' && name !== 'Object_2') return [sourcePosition, sourceNormal];
  const points = [], directions = [], ids = new Map(), edges = new Map(), triangleIds = [];
  for (let i = 0; i < sourcePosition.length; i += 3) {
    const p = Array.from(sourcePosition.subarray(i, i + 3));
    const key = p.map(value => Math.round(value * 1000000)).join(',');
    if (!ids.has(key)) { ids.set(key, points.length); points.push(p); directions.push(Array.from(sourceNormal.subarray(i, i + 3))); }
    triangleIds.push(ids.get(key));
  }
  for (let i = 0; i < triangleIds.length; i += 3) for (let side = 0; side < 3; side++) {
    const from = triangleIds[i + side], to = triangleIds[i + (side + 1) % 3];
    const key = from < to ? `${from}:${to}` : `${to}:${from}`;
    const edge = edges.get(key);
    if (edge) edge.count++; else edges.set(key, { from, to, count: 1 });
  }
  const boundary = new Map([...edges.values()].filter(edge => edge.count === 1).map(edge => [edge.from, edge.to]));
  const p = Array.from(sourcePosition), n = Array.from(sourceNormal);
  while (boundary.size) {
    const first = boundary.keys().next().value, loop = [];
    let next = first;
    while (boundary.has(next) && loop.length < 10000) {
      loop.push(next); const to = boundary.get(next); boundary.delete(next); next = to;
      if (next === first) break;
    }
    if (next !== first || loop.length < 3) continue;
    const box = new THREE.Box3().setFromArray(loop.flatMap(id => points[id]));
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    if (Math.max(size.x, size.y, size.z) > (name === 'Object_0' ? .05 : .07)) continue;
    if (name === 'Object_0' && (box.min.y < visorBounds.max.y - .005 || center.z >= 0)) continue;
    const mean = new THREE.Vector3(), normal = new THREE.Vector3();
    for (const id of loop) { mean.add(new THREE.Vector3(...points[id])); normal.add(new THREE.Vector3(...directions[id])); }
    mean.divideScalar(loop.length); normal.normalize();
    for (let i = 0; i < loop.length; i++) {
      const from = loop[i], to = loop[(i + 1) % loop.length];
      p.push(...mean.toArray(), ...points[to], ...points[from]);
      n.push(...normal.toArray(), ...directions[to], ...directions[from]);
    }
  }
  return [new Float32Array(p), new Float32Array(n)];
}
for (const [name, material, budget, errorLimit] of selected) {
  const mesh = meshes.find(value => value.name === name);
  if (!mesh) throw new Error('Missing source helmet part: ' + name);
  const [sourcePosition, sourceNormal] = closeRemovedMounts(name, worldPositions.get(name), worldNormals.get(name));
  const transformed = new Float32Array(sourcePosition.length);
  const transformedNormals = new Float32Array(sourceNormal.length);
  for (let vertex = 0; vertex < sourcePosition.length; vertex += 3) {
    transformed.set(restyle(...sourcePosition.subarray(vertex, vertex + 3)), vertex);
    transformedNormals.set(restyleNormal(...sourcePosition.subarray(vertex, vertex + 3), ...sourceNormal.subarray(vertex, vertex + 3)), vertex);
  }
  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(transformed, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(transformedNormals, 3));
  geometry = mergeVertices(geometry, .00002);
  const p = geometry.getAttribute('position').array, n = geometry.getAttribute('normal').array;
  const input = new Uint32Array(geometry.getIndex().array);
  const [simplified, error] = MeshoptSimplifier.simplifyWithAttributes(input, p, 3, n, 3,
    [.15, .15, .15], null, Math.min(input.length, budget * 3), errorLimit, ['Permissive']);
  const [remap, count] = MeshoptSimplifier.compactMesh(simplified);
  const packedPosition = new Float32Array(count * 3), packedNormal = new Float32Array(count * 3);
  for (let old = 0; old < remap.length; old++) {
    if (remap[old] === 0xffffffff) continue;
    packedPosition.set(p.subarray(old * 3, old * 3 + 3), remap[old] * 3);
    packedNormal.set(n.subarray(old * 3, old * 3 + 3), remap[old] * 3);
  }
  const base = positions.length / 3;
  const previous = groups.at(-1);
  if (previous?.material === material) previous.count += simplified.length;
  else groups.push({ start: indices.length, count: simplified.length, material });
  positions.push(...packedPosition); normals.push(...packedNormal);
  for (const index of simplified) indices.push(base + index);
  audit.push({ name, material, before: input.length / 3, after: simplified.length / 3, error });
}
// Fit the complete shell slightly forward around the unchanged adult head.
// Bake the offset so all riding poses retain it without moving the skeleton.
for (let i = 2; i < positions.length; i += 3) positions[i] -= .012;
const vertexCount = positions.length / 3;
if (vertexCount > 65535) throw new Error('Helmet exceeds compact vertex budget');
const positionData = Int16Array.from(positions, value => Math.round(value * 100000));
const normalData = Int16Array.from(normals, value => Math.round(Math.max(-1, Math.min(1, value)) * 32767));
const indexData = Uint16Array.from(indices);
const bytes = Buffer.concat([Buffer.from(positionData.buffer), Buffer.from(normalData.buffer), Buffer.from(indexData.buffer)]);
const report = { sourceTriangles: meshes.reduce((total, mesh) => total + mesh.geometry.attributes.position.count / 3, 0),
  triangles: indices.length / 3, vertices: vertexCount, geometryBytes: bytes.length, sourceHeight: shellBounds.max.y - shellBounds.min.y,
  finalBounds: { min: new THREE.Box3().setFromArray(positions).min.toArray(), max: new THREE.Box3().setFromArray(positions).max.toArray() },
  removed: meshes.filter(mesh => !selected.some(([name]) => mesh.name === name)).map(mesh => mesh.name), audit };
if (report.triangles > 10000) throw new Error('Helmet triangle budget exceeded: ' + report.triangles);
const code = `// Generated by scripts/build-fullface-helmet.mjs from the user-supplied racing helmet.\n// No source image textures, logos, straps or hidden padding are shipped.\nexport const FULLFACE_HELMET_ASSET = { vertices: ${vertexCount}, indices: ${indices.length}, groups: ${JSON.stringify(groups)}, data: '${bytes.toString('base64')}' } as const;\n`;
fs.writeFileSync(path.join(root, 'app/game/fullfaceHelmetAsset.ts'), code);
fs.mkdirSync(path.join(root, 'outputs/usdz-reference'), { recursive: true });
fs.writeFileSync(path.join(root, 'outputs/usdz-reference/fullface-helmet-export.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(root, 'outputs/fullface-helmet-preview.json'), JSON.stringify({ positions, normals, indices, groups }));
console.log(JSON.stringify(report, null, 2));
