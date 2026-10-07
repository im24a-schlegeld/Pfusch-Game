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
const ease = (value, low, high) => { const t = Math.max(0, Math.min(1, (value - low) / (high - low))); return t * t * (3 - 2 * t); };
const slope = (value, low, high) => { const t = (value - low) / (high - low); return t > 0 && t < 1 ? 6 * t * (1 - t) / (high - low) : 0; };
function restyle(x, y, z) {
  // Subtle generic shaping, shared across adjoining shell/visor/vent surfaces.
  // A broader, shorter chin and a flatter rear air outlet soften the source profile.
  const chin = (1 - ease(y, .10, .25)) * (1 - ease(z, -.29, -.17));
  const rear = ease(z, .06, .17) * ease(y, .36, .52);
  // The reference exposes a very high rear neck cutout. Lower and round only
  // that continuous rear skirt, keeping the adult-size front/visor unchanged.
  const skirt = (1 - ease(y, .17, .32)) * ease(z, -.06, .15);
  return [(x - center.x) * (1 + .045 * chin - .04 * skirt) * scale,
    (y - center.y - .006 * rear - .14 * skirt) * scale + .0045,
    (z - center.z + .012 * chin - .020 * rear - .035 * skirt) * scale];
}
function restyleNormal(x, y, z, nx, ny, nz) {
  const chinY = 1 - ease(y, .10, .25), chinZ = 1 - ease(z, -.29, -.17);
  const chin = chinY * chinZ;
  const cy = -slope(y, .10, .25) * chinZ, cz = -chinY * slope(z, -.29, -.17);
  const ry = ease(z, .06, .17) * slope(y, .36, .52);
  const rz = slope(z, .06, .17) * ease(y, .36, .52);
  const skirtY = 1 - ease(y, .17, .32), skirtZ = ease(z, -.06, .15), skirt = skirtY * skirtZ;
  const sy = -slope(y, .17, .32) * skirtZ, sz = skirtY * slope(z, -.06, .15);
  // Inverse-transpose of the shared continuous deformation. Uniform scale
  // cancels after normalisation; translations do not affect the Jacobian.
  const a = 1 + .045 * chin - .04 * skirt, b = (x - center.x) * (.045 * cy - .04 * sy), c = (x - center.x) * (.045 * cz - .04 * sz);
  const d = 1 - .006 * ry - .14 * sy, e = -.006 * rz - .14 * sz;
  const f = .012 * cy - .020 * ry - .035 * sy, g = 1 + .012 * cz - .020 * rz - .035 * sz;
  const tx = nx / a, iy = ny - b * tx, iz = nz - c * tx, determinant = d * g - e * f;
  const ty = (g * iy - f * iz) / determinant, tz = (d * iz - e * iy) / determinant;
  const length = Math.hypot(tx, ty, tz) || 1;
  return [tx / length, ty / length, tz / length];
}
// Material slots preserve existing paint, visor and sticker behavior.
const selected = [
  ['Object_0', 0, 3600, .004], // continuous paint shell; original graphic atlas omitted
  ['Object_2', 1, 800, .004], // actual visor, not its separate logo strip (Object_13)
  ['Object_3', 2, 240, .012], // shallow brow intake
  ['Object_6', 2, 240, .016], // simple visor pivots
  ['Object_8', 2, 320, .012], // visible thin lower seal only
  ['Object_10', 2, 120, .035], // dense chin grille reduced to a plain dark recess
];
const groups = [], positions = [], normals = [], indices = [], audit = [];
for (const [name, material, budget, errorLimit] of selected) {
  const mesh = meshes.find(value => value.name === name);
  if (!mesh) throw new Error('Missing source helmet part: ' + name);
  const sourcePosition = worldPositions.get(name), sourceNormal = worldNormals.get(name);
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
// A thin, dark underside closes the empty shell without keeping hidden cheek
// pads, straps, buckles or the source's inner liner. It is not a second head.
const centerIndex = positions.length / 3, sides = 24;
positions.push(0, -.105, .012); normals.push(0, -1, 0);
for (let i = 0; i < sides; i++) {
  const angle = i * Math.PI * 2 / sides;
  positions.push(Math.sin(angle) * .103, -.105, .012 + Math.cos(angle) * .114);
  normals.push(0, -1, 0);
}
for (let i = 0; i < sides; i++) indices.push(centerIndex, centerIndex + 1 + (i + 1) % sides, centerIndex + 1 + i);
groups.at(-1).count += sides * 3;
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
