import * as THREE from 'three';
import { SNEAKER_ASSET as asset } from './sneakerAsset';

let decoded: { positions: Float32Array; normals: Float32Array; indices: Uint16Array } | undefined;

/** Supplied low-top sneaker: 30 cm adult length, fixed for every motorcycle.
 * Packed once; no leather/bump textures, texture fetches or USD runtime loader.
 */
export function createSneaker(color: string, side: number) {
  if (!decoded) {
    const binary = atob(asset.data), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const view = new DataView(bytes.buffer), count = asset.vertices * 3;
    const positions = new Float32Array(count), normals = new Float32Array(count);
    const indices = new Uint16Array(asset.indices);
    for (let i = 0; i < count; i++) {
      positions[i] = view.getInt16(i * 2, true) / 100000;
      normals[i] = view.getInt16((count + i) * 2, true) / 32767;
    }
    for (let i = 0; i < indices.length; i++) indices[i] = view.getUint16(count * 4 + i * 2, true);
    decoded = { positions, normals, indices };
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(decoded.positions.slice(), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(decoded.normals.slice(), 3));
  geometry.setIndex(new THREE.BufferAttribute(decoded.indices.slice(), 1));
  // Mirror the supplied shoe, including winding, so both normals point out.
  if (side < 0) {
    geometry.scale(-1, 1, 1);
    const index = geometry.index!;
    for (let i = 0; i < index.count; i += 3) {
      const second = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2)); index.setX(i + 2, second);
    }
  }
  for (const group of asset.groups) geometry.addGroup(group.start, group.count, group.material);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const upper = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 });
  upper.userData.appearanceColorSlot = 'shoesColor';
  const sole = new THREE.MeshStandardMaterial({ color: '#d6d4cd', roughness: 1, metalness: 0 });
  const laces = new THREE.MeshStandardMaterial({ color: '#f2f0e9', roughness: 1, metalness: 0 });
  const sneaker = new THREE.Mesh(geometry, [upper, sole, laces]);
  sneaker.name = 'rider-boot';
  sneaker.userData.sourceModel = 'simplified-unbranded-sneaker';
  sneaker.castShadow = true;
  sneaker.receiveShadow = true;
  return sneaker;
}
