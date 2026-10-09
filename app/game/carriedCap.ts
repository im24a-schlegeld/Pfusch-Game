import * as THREE from 'three';
import type { Player, Product } from '../domain/types';
import { accessoryMaterial } from './garmentTexture';
import { CARRIED_CAP_ASSET as asset } from './carriedCapAsset';

let cached: THREE.BufferGeometry | undefined;
function capGeometry() {
  if (!cached) {
    const binary = atob(asset.data), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const view = new DataView(bytes.buffer), count = asset.vertices * 3;
    const positions = new Float32Array(count), normals = new Float32Array(count);
    const uv = new Float32Array(asset.vertices * 2), indices = new Uint16Array(asset.indices);
    for (let i = 0; i < count; i++) {
      positions[i] = view.getInt16(i * 2, true) / 100000;
      normals[i] = view.getInt16((count + i) * 2, true) / 32767;
    }
    for (let i = 0; i < asset.vertices; i++) {
      // Original photo embroidery is centered over the actual front panels.
      // Cylindrical UVs preserve one continuous front without projecting onto the rear.
      uv[i * 2] = .75 - Math.atan2(positions[i * 3], -positions[i * 3 + 2]) / (2 * Math.PI);
      uv[i * 2 + 1] = positions[i * 3 + 1] / .144;
    }
    for (let i = 0; i < indices.length; i++) indices[i] = view.getUint16(count * 4 + i * 2, true);
    cached = new THREE.BufferGeometry();
    cached.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    cached.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    cached.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    cached.setIndex(new THREE.BufferAttribute(indices, 1));
    for (const group of asset.groups) cached.addGroup(group.start, group.count, group.material);
    cached.computeBoundingBox(); cached.computeBoundingSphere();
  }
  return cached.clone();
}

/** Supplied cap carried at the hip; the adult riding helmet remains equipped. */
export function createCarriedCap(product: Product, player: Player, color: string) {
  const crown = accessoryMaterial(product, player, color);
  crown.side = THREE.DoubleSide;
  const fabric = new THREE.MeshStandardMaterial({ color, roughness: .96, side: THREE.DoubleSide });
  const cap = new THREE.Mesh(capGeometry(), [crown, fabric]);
  cap.name = 'imported-cap-shell';
  cap.userData.sourceModel = 'user-supplied-cap-obj';
  cap.userData.productId = product.id;
  cap.castShadow = true; cap.receiveShadow = true;
  return cap;
}
