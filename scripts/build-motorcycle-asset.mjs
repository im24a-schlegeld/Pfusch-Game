/** Offline-only conversion. Usage: node scripts/build-fs450-asset.mjs <source.usdz>
 * Requires Three.js with USDLoader and meshoptimizer in node_modules or .build-check/node_modules.
 * The browser receives only a small static manifest, mesh buffer and color textures.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = fs.existsSync(path.join(root, '.build-check/node_modules/three/examples/jsm/loaders/usd/USDComposer.js'))
  ? path.join(root, '.build-check') : root;
const require = createRequire(path.join(runtime, 'package.json'));
const threeRoot = path.resolve(path.dirname(require.resolve('three')), '..');
const moduleAt = file => import(pathToFileURL(path.join(threeRoot, file)).href);
const THREE = await moduleAt('build/three.module.js');
const { unzipSync } = await moduleAt('examples/jsm/libs/fflate.module.js');
const { USDCParser } = await moduleAt('examples/jsm/loaders/usd/USDCParser.js');
const { USDAParser } = await moduleAt('examples/jsm/loaders/usd/USDAParser.js');
const { USDComposer } = await moduleAt('examples/jsm/loaders/usd/USDComposer.js');
const { mergeVertices } = await moduleAt('examples/jsm/utils/BufferGeometryUtils.js');
const { MeshoptSimplifier } = await import(pathToFileURL(require.resolve('meshoptimizer/simplifier')).href);
await MeshoptSimplifier.ready;

export async function buildMotorcycleAsset(config) {
const source = config.source;
if (!source) throw new Error('Pass the user-supplied USDZ path.');
const output = path.join(root, 'public/models', config.id);
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(path.join(output, 'textures'), { recursive: true });
const zip = unzipSync(new Uint8Array(fs.readFileSync(source)));
const bytes = zip[Object.keys(zip)[0]];
const data = new TextDecoder().decode(bytes.subarray(0, 8)) === 'PXR-USDC'
  ? new USDCParser().parseData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  : new USDAParser().parseData(new TextDecoder().decode(bytes));
class OfflineComposer extends USDComposer { _loadTexture() { return null; } }
const group = new OfflineComposer().compose(data);
group.updateMatrixWorld(true);
const specs = data.specsByPath;
const meshes = [];
group.traverse(object => {
  if (object.isMesh && (!config.includeMesh || config.includeMesh(object))) meshes.push(object);
});

const p = new THREE.Vector3();
const normal4 = new THREE.Vector4();
const normal = new THREE.Vector3();
const worldPositions = new Map();
const worldNormals = new Map();
const sourceBounds = new THREE.Box3();
for (const mesh of meshes) {
  const positions = new Float32Array(mesh.geometry.attributes.position.count * 3);
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < positions.length / 3; i++) {
    mesh.getVertexPosition(i, p).applyMatrix4(mesh.matrixWorld);
    p.toArray(positions, i * 3);
    sourceBounds.expandByPoint(p);
    normal.fromBufferAttribute(mesh.geometry.attributes.normal, i);
    normal4.set(normal.x, normal.y, normal.z, 0);
    if (mesh.isSkinnedMesh) mesh.applyBoneTransform(i, normal4);
    normal4.applyMatrix4(mesh.matrixWorld);
    normal.set(normal4.x, normal4.y, normal4.z).normalize().toArray(normals, i * 3);
  }
  worldPositions.set(mesh.name, positions);
  worldNormals.set(mesh.name, normals);
}
function meshBox(name) {
  return new THREE.Box3().setFromArray(worldPositions.get(name));
}
const { normalize, anchors, sourceTransform } = config.analyze({ meshes, meshBox, worldPositions, sourceBounds, THREE });
const normalizedOrigin = normalize([0, 0, 0]);
const rigFor = config.rigFor;
const materialByName = new Map();
const buckets = new Map();
for (const mesh of meshes) {
  // Parent transforms may have the same name as other meshes (the Nitro USDZ
  // contains Object_10/Object_8 alongside a different Object_10 mesh).
  const meshPath = Object.keys(specs).find(name => name.endsWith('/' + mesh.name)
    && specs[name]?.fields.typeName === 'Mesh');
  let materialPath = specs[meshPath + '.material:binding']?.fields.targetPaths?.[0];
  for (let parent = meshPath; !materialPath && parent.includes('/');) {
    parent = parent.slice(0, parent.lastIndexOf('/'));
    materialPath = specs[parent + '.material:binding']?.fields.targetPaths?.[0];
  }
  if (!materialPath) throw new Error('No material binding for mesh: ' + mesh.name);
  const materialName = materialPath.split('/').at(-1);
  const mat = mesh.material;
  if (!materialByName.has(materialName)) {
    const textureFile = specs[materialPath + '/tex_base.inputs:file']?.fields.default;
    const texturePath = textureFile ? 'textures/' + path.posix.basename(textureFile).replace(/\.[^.]+$/, '.jpg') : undefined;
    if (textureFile) {
      const sharp = (await import(pathToFileURL(require.resolve('sharp')).href)).default;
      const maxSize = /livery|bodywork|fairing/i.test(materialName) ? 1024 : 512;
      const input = Buffer.from(zip[textureFile]);
      await sharp(input).resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86 }).toFile(path.join(output, texturePath));
    }
    materialByName.set(materialName, {
      name: materialName, color: '#' + mat.color.getHexString(),
      metalness: Math.min(mat.metalness, .85), roughness: Math.max(mat.roughness, .35),
      ...(mat.opacity < 1 ? { opacity: mat.opacity, transparent: true } : {}),
      ...(texturePath ? { map: texturePath } : {}),
    });
  }
  const positions = worldPositions.get(mesh.name), normals = worldNormals.get(mesh.name);
  const uv = mesh.geometry.attributes.uv;
  for (let i = 0; i < positions.length / 3; i += 3) {
    if (config.includeTriangle && !config.includeTriangle(mesh, i)) continue;
    const rigs = [rigFor(mesh, i), rigFor(mesh, i + 1), rigFor(mesh, i + 2)];
    const rig = rigs[1] === rigs[2] ? rigs[1] : rigs[0];
    const override = config.materialFor?.(mesh, i, materialName);
    const bucketMaterial = override?.name ?? materialName;
    if (override && !materialByName.has(bucketMaterial)) materialByName.set(bucketMaterial, override);
    const key = bucketMaterial + ':' + rig;
    if (!buckets.has(key)) buckets.set(key, { name: key, rig, material: bucketMaterial, position: [], normal: [], uv: [], sources: new Set() });
    const bucket = buckets.get(key);
    bucket.sources.add(mesh.name);
    for (let corner = 0; corner < 3; corner++) {
      const v = i + corner;
      bucket.position.push(...normalize(positions.subarray(v * 3, v * 3 + 3)));
      const transformedNormal = normalize(normals.subarray(v * 3, v * 3 + 3));
      normal.set(...transformedNormal).sub(new THREE.Vector3(...normalizedOrigin)).normalize();
      bucket.normal.push(normal.x, normal.y, normal.z);
      bucket.uv.push(uv ? uv.getX(v) : 0, uv ? uv.getY(v) : 0);
    }
  }
}
const materialBudgets = config.materialBudgets;
const materialTotals = {};
for (const bucket of buckets.values()) materialTotals[bucket.material] = (materialTotals[bucket.material] || 0) + bucket.position.length / 9;
const chunks = [], parts = [], audit = [];
let byteOffset = 0;
function write(array, count) {
  const padding = (4 - byteOffset % 4) % 4;
  if (padding) { chunks.push(Buffer.alloc(padding)); byteOffset += padding; }
  const offset = byteOffset;
  const buffer = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  chunks.push(buffer); byteOffset += buffer.length;
  return { offset, count };
}
for (const bucket of buckets.values()) {
  let geometry = new THREE.BufferGeometry();
  for (const [attribute, itemSize] of [['position', 3], ['normal', 3], ['uv', 2]])
    geometry.setAttribute(attribute, new THREE.Float32BufferAttribute(bucket[attribute], itemSize));
  geometry = mergeVertices(geometry, 1e-5);
  const originalIndices = new Uint32Array(geometry.index.array);
  const originalTriangles = originalIndices.length / 3;
  const budget = materialBudgets[bucket.material] ?? materialTotals[bucket.material];
  const targetTriangles = Math.min(originalTriangles, Math.max(48, Math.round(budget * originalTriangles / materialTotals[bucket.material])));
  const positions = geometry.attributes.position.array;
  const normals = geometry.attributes.normal.array;
  const uvs = geometry.attributes.uv.array;
  const attributes = new Float32Array(positions.length / 3 * 5);
  for (let i = 0; i < positions.length / 3; i++) {
    attributes.set(normals.subarray(i * 3, i * 3 + 3), i * 5);
    attributes.set(uvs.subarray(i * 2, i * 2 + 2), i * 5 + 3);
  }
  const isBody = /livery|bodywork|fairing/i.test(bucket.material);
  const tuning = config.simplification?.(bucket) ?? {};
  const errorLimit = tuning.error ?? (isBody ? .007 : .03);
  const [indices, error] = targetTriangles < originalTriangles
    ? MeshoptSimplifier.simplifyWithAttributes(originalIndices, positions, 3, attributes, 5, tuning.weights ?? [.05, .05, .05, .15, .15], null, targetTriangles * 3, errorLimit, tuning.flags ?? ['Permissive'])
    : [originalIndices, 0];
  const [remap, vertexCount] = MeshoptSimplifier.compactMesh(indices);
  if (vertexCount > 65535) throw new Error('Part exceeds Uint16 vertex budget: ' + bucket.name);
  const compactPosition = new Float32Array(vertexCount * 3);
  const compactNormal = new Float32Array(vertexCount * 3);
  const compactUv = new Float32Array(vertexCount * 2);
  for (let old = 0; old < remap.length; old++) {
    const next = remap[old];
    if (next === 0xffffffff) continue;
    compactPosition.set(positions.subarray(old * 3, old * 3 + 3), next * 3);
    compactNormal.set(normals.subarray(old * 3, old * 3 + 3), next * 3);
    compactUv.set(uvs.subarray(old * 2, old * 2 + 2), next * 2);
  }
  parts.push({ name: bucket.name, rig: bucket.rig, material: bucket.material,
    position: write(compactPosition, vertexCount), normal: write(compactNormal, vertexCount),
    uv: write(compactUv, vertexCount), index: write(new Uint16Array(indices), indices.length) });
  audit.push({ name: bucket.name, originalTriangles, triangles: indices.length / 3, targetTriangles, error, vertices: vertexCount });
  console.log(bucket.name, originalTriangles + ' -> ' + indices.length / 3, 'error=' + error.toFixed(5));
}
const manifest = {
  version: 1, name: config.name, binary: 'model.bin',
  axes: '+Y up; -Z forward; metres; axle midpoint Z=0; lowest point Y=0',
  sourceTransform,
  anchors, parts, materials: [...materialByName.values()].filter(material => parts.some(part => part.material === material.name)),
  statistics: { sourceTriangles: audit.reduce((sum, part) => sum + part.originalTriangles, 0),
    triangles: audit.reduce((sum, part) => sum + part.triangles, 0), vertices: audit.reduce((sum, part) => sum + part.vertices, 0),
    geometryBytes: byteOffset, meshes: parts.length },
};
fs.writeFileSync(path.join(output, 'model.bin'), Buffer.concat(chunks));
fs.writeFileSync(path.join(output, 'model.json'), JSON.stringify(manifest, null, 2));
const reportPath = path.join(root, 'outputs/usdz-reference/' + config.id + '-export.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify({ ...manifest.statistics, anchors, audit }, null, 2));
console.log(JSON.stringify({ ...manifest.statistics, anchors }, null, 2));

return manifest;
}
