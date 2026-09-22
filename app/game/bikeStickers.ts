import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import type { StickerPlacement } from '../domain/types';

let artwork: THREE.Texture | undefined;
export function stickerArtwork() {
  if (!artwork) {
    // Reuse the supplied transparent chrome artwork, never a product-photo rectangle.
    artwork = new THREE.TextureLoader().load('/branding/pfusch-logo.webp');
    artwork.colorSpace = THREE.SRGBColorSpace;
  }
  return artwork;
}
export function stickerSurfaces(body: THREE.Object3D, rider: THREE.Object3D, paint: string) {
  const result = new Map<string, THREE.Mesh>();
  const color = new THREE.Color(paint);
  function visit(object: THREE.Object3D, path: string) {
    if (object === rider || object.userData.bikeSticker || /wheel|keychain|ignition|carried-cap/.test(object.name)) return;
    if (object instanceof THREE.Mesh) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some((m) => m instanceof THREE.MeshStandardMaterial && m.color.equals(color)) ||
        /tank|fairing|shroud|apron|leg-shield|fender|tail-shell/.test(object.name)) result.set(path, object);
    }
    object.children.forEach((child, index) => visit(child, `${path}/${child.name || 'mesh'}:${index}`));
  }
  visit(body, 'body');
  return result;
}
export function clearBikeStickers(body: THREE.Object3D) {
  const old: THREE.Mesh[] = [];
  body.traverse((o) => { if (o instanceof THREE.Mesh && o.userData.bikeSticker) old.push(o); });
  old.forEach((mesh) => {
    mesh.removeFromParent(); mesh.geometry.dispose();
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => m.dispose());
  });
}
/** Decal vertices live in the selected surface's space, so suspension stays attached. */
export function applyBikeStickers(body: THREE.Object3D, rider: THREE.Object3D, paint: string, placements: StickerPlacement[]) {
  clearBikeStickers(body);
  if (!placements.length) return;
  const surfaces = stickerSurfaces(body, rider, paint);
  for (const placement of placements) {
    const source = surfaces.get(placement.surface);
    if (!source) continue;
    const normal = new THREE.Vector3(...placement.normal).normalize();
    const up = Math.abs(normal.y) > 0.94 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    const x = new THREE.Vector3().crossVectors(up, normal).normalize();
    const y = new THREE.Vector3().crossVectors(normal, x).normalize();
    const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, normal));
    rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), placement.rotation));
    const localSource = new THREE.Mesh(source.geometry, source.material);
    localSource.updateMatrixWorld(true);
    const geometry = new DecalGeometry(localSource, new THREE.Vector3(...placement.point), new THREE.Euler().setFromQuaternion(rotation), new THREE.Vector3(placement.size, placement.size * 1282 / 2090, 0.035));
    // Thin plastics have two skins; project only onto the outward-facing one.
    const normals = geometry.getAttribute('normal'), indices: number[] = [];
    const faceNormal = new THREE.Vector3();
    for (let i = 0; i < normals.count; i += 3) {
      faceNormal.set(0, 0, 0);
      for (let j = 0; j < 3; j++) faceNormal.add(new THREE.Vector3().fromBufferAttribute(normals, i + j));
      if (faceNormal.dot(normal) > 0.15) indices.push(i, i + 1, i + 2);
    }
    geometry.setIndex(indices);
    const material = new THREE.MeshStandardMaterial({ map: stickerArtwork(), transparent: true, alphaTest: 0.08, depthWrite: false, roughness: 0.3, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `sticker-${placement.id}`; mesh.userData.bikeSticker = true; mesh.renderOrder = 3;
    source.add(mesh);
  }
}
