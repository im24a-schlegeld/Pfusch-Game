import * as THREE from 'three';
import { MOTOCROSS_HELMET_ASSET as asset } from './motocrossHelmetAsset';

let cached: THREE.BufferGeometry[] | undefined;
/** Small synchronous equipment asset. Each instance owns disposable GPU buffers. */
export function importedGeometry(part: 0 | 1) {
  if (!cached) {
    const raw = atob(asset.data), bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const view = new DataView(bytes.buffer), count = asset.vertices * 3;
    cached = asset.groups.map(group => {
      const positions: number[] = [], normals: number[] = [], indices: number[] = [];
      const remap = new Map<number, number>();
      for (let i = group.start; i < group.start + group.count; i++) {
        const source = view.getUint16(count * 4 + i * 2, true);
        if (!remap.has(source)) {
          remap.set(source, positions.length / 3);
          for (let axis = 0; axis < 3; axis++) {
            positions.push(view.getInt16((source * 3 + axis) * 2, true) / 100000);
            normals.push(view.getInt16((count + source * 3 + axis) * 2, true) / 32767);
          }
        }
        indices.push(remap.get(source)!);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geometry.setIndex(indices);
      geometry.addGroup(0, group.outerCount, 0);
      geometry.addGroup(group.outerCount, indices.length - group.outerCount, 1);
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      return geometry;
    });
  }
  return cached[part].clone();
}
