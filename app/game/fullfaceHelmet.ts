import * as THREE from 'three';
import { FULLFACE_HELMET_ASSET as asset } from './fullfaceHelmetAsset';

let decoded: { positions: Float32Array; normals: Float32Array; indices: Uint16Array } | undefined;

/** Decode once. Every fixed helmet uses the same immutable adult-size geometry. */
function geometry() {
  if (!decoded) {
    const binary = atob(asset.data), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const view = new DataView(bytes.buffer), count = asset.vertices * 3;
    const positions = new Float32Array(count), normals = new Float32Array(count), indices = new Uint16Array(asset.indices);
    for (let i = 0; i < count; i++) {
      positions[i] = view.getInt16(i * 2, true) / 100000;
      normals[i] = view.getInt16((count + i) * 2, true) / 32767;
    }
    // Small equipment-fit adjustment; the shared adult head joint stays fixed.
    for (let i = 2; i < count; i += 3) positions[i] -= .005;
    for (let i = 0; i < indices.length; i++) indices[i] = view.getUint16(count * 4 + i * 2, true);
    decoded = { positions, normals, indices };
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(decoded.positions, 3));
  result.setAttribute('normal', new THREE.BufferAttribute(decoded.normals, 3));
  result.setIndex(new THREE.BufferAttribute(decoded.indices, 1));
  for (const group of asset.groups) result.addGroup(group.start, group.count, group.material);
  result.computeBoundingBox(); result.computeBoundingSphere();
  return result;
}

/** Plain, simplified user-supplied racing shell. Slots 0/1 remain paint/visor. */
export function createFullfaceHelmet(color: string, visorColor: string) {
  const shell = new THREE.MeshStandardMaterial({ color, metalness: .14, roughness: .31 });
  const visor = new THREE.MeshStandardMaterial({ color: visorColor, metalness: .44, roughness: .14 });
  const trim = new THREE.MeshStandardMaterial({ color: '#202727', metalness: .1, roughness: .65 });
  const helmet = new THREE.Mesh(geometry(), [shell, visor, trim]);
  helmet.name = 'full-face-helmet';
  helmet.userData.helmetStyle = 'fullface';
  helmet.userData.sourceModel = 'simplified-racing-helmet';
  helmet.castShadow = true; helmet.receiveShadow = true;
  return helmet;
}
