/** Offline FBX/3DS import. Texture maps are intentionally omitted, including all source lettering. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = fs.existsSync(path.join(root, '.build-check/node_modules/three')) ? path.join(root, '.build-check') : root;
const require = createRequire(path.join(runtime, 'package.json'));
const threeRoot = path.resolve(path.dirname(require.resolve('three')), '..');
const moduleAt = file => import(pathToFileURL(path.join(threeRoot, file)).href);
export const THREE = await moduleAt('build/three.module.js');
const { FBXLoader } = await moduleAt('examples/jsm/loaders/FBXLoader.js');
const { TDSLoader } = await moduleAt('examples/jsm/loaders/TDSLoader.js');
const { mergeVertices } = await moduleAt('examples/jsm/utils/BufferGeometryUtils.js');

export function loadPortableMotorcycleSource(filename, includeMesh) {
  const extension = path.extname(filename).toLowerCase();
  if (!['.fbx', '.3ds'].includes(extension)) throw new Error('Only supplied FBX or 3DS sources are supported.');
  const previousTextureLoad = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = function () { return new THREE.Texture(); };
  let group;
  try {
    const bytes = fs.readFileSync(filename);
    const Loader = extension === '.fbx' ? FBXLoader : TDSLoader;
    group = new Loader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  } finally { THREE.TextureLoader.prototype.load = previousTextureLoad; }
  group.updateMatrixWorld(true);
  const meshes = [], worldPositions = new Map(), worldNormals = new Map(), sourceBounds = new THREE.Box3();
  group.traverse(object => {
    if (!object.isMesh || includeMesh && !includeMesh(object)) return;
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, object.material);
    mesh.name = object.name;
    if (worldPositions.has(mesh.name)) throw new Error('Duplicate source mesh name: ' + mesh.name);
    const mat = Array.isArray(object.material) ? object.material[0] : object.material;
    // Export semantic materials override this neutral fallback. No UV artwork enters the asset.
    mesh.userData.exportMaterial = { name: `source_${mat?.name || 'plain'}`, color: '#bcbcbc', metalness: .15, roughness: .65 };
    mesh.userData.sourceMaterial = mat?.name ?? '';
    meshes.push(mesh);
    worldPositions.set(mesh.name, geometry.attributes.position.array);
    worldNormals.set(mesh.name, geometry.attributes.normal.array);
    geometry.computeBoundingBox(); sourceBounds.union(geometry.boundingBox);
  });
  return { meshes, worldPositions, worldNormals, sourceBounds, THREE, zip: {}, data: { specsByPath: {} },
    meshBox: name => new THREE.Box3().setFromArray(worldPositions.get(name)) };
}

/** Round existing airbox edges with a small bevel field; retain the supplied outline and location. */
export function roundSourceAirbox(source, name, radius) {
  const mesh = source.meshes.find(item => item.name === name);
  if (!mesh) throw new Error('Airbox source missing: ' + name);
  let positions = Array.from(source.worldPositions.get(name));
  for (let level = 0; level < 2; level++) {
    const next = [];
    for (let i = 0; i < positions.length; i += 9) {
      const a = positions.slice(i, i + 3), b = positions.slice(i + 3, i + 6), c = positions.slice(i + 6, i + 9);
      const ab = a.map((v, k) => (v + b[k]) / 2), bc = b.map((v, k) => (v + c[k]) / 2), ca = c.map((v, k) => (v + a[k]) / 2);
      next.push(...a, ...ab, ...ca, ...ab, ...b, ...bc, ...ca, ...bc, ...c, ...ab, ...bc, ...ca);
    }
    positions = next;
  }
  const box = source.meshBox(name), point = new THREE.Vector3(), nearest = new THREE.Vector3();
  const min = box.min.clone().addScalar(radius), max = box.max.clone().addScalar(-radius);
  for (let i = 0; i < positions.length; i += 3) {
    point.fromArray(positions, i); nearest.copy(point).clamp(min, max);
    const offset = point.clone().sub(nearest);
    if (offset.length() > radius) nearest.add(offset.setLength(radius)).toArray(positions, i);
  }
  let geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry = mergeVertices(geometry, 1e-5); geometry.computeVertexNormals(); geometry = geometry.toNonIndexed();
  mesh.geometry.dispose(); mesh.geometry = geometry;
  source.worldPositions.set(name, geometry.attributes.position.array);
  source.worldNormals.set(name, geometry.attributes.normal.array);
}
