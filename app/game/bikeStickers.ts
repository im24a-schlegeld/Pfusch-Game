import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import type { StickerPlacement } from '../domain/types';

let artwork: THREE.Texture | undefined;
export function stickerArtwork() {
  if (!artwork) {
    // Match the supplied nearly-square decal with deeply rounded corners.
    // Keep the official chrome wordmark smaller and centered on the black
    // 6 × 6 cm backing instead of stretching it to the sticker's silhouette.
    artwork = new THREE.TextureLoader().load('/branding/pfusch-logo.webp', (texture: THREE.Texture) => {
      const print = texture.image as HTMLImageElement;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 512;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.fillStyle = '#111315';
      context.beginPath();
      context.roundRect(8, 8, 496, 496, 132);
      context.fill();
      const width = 292, height = width * print.height / print.width;
      context.drawImage(print, (512 - width) / 2, (512 - height) / 2, width, height);
      texture.image = canvas;
      texture.needsUpdate = true;
    });
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
/** Some double-sided body panels have inward triangle winding. A saved face
 * normal still identifies the selected skin; the nearer opposite skin tells
 * us which direction points into the panel, without changing saved positions. */
function outwardNormal(source: THREE.Mesh, point: THREE.Vector3, normal: THREE.Vector3) {
  const probeMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const probe = new THREE.Mesh(source.geometry, probeMaterial);
  probe.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const distance = (direction: THREE.Vector3) => {
    ray.set(point.clone().addScaledVector(direction, 0.00001), direction);
    return ray.intersectObject(probe, false)[0]?.distance ?? Infinity;
  };
  const into = distance(normal), away = distance(normal.clone().negate());
  probeMaterial.dispose();
  return into < away ? normal.clone().negate() : normal.clone();
}
/** Decal vertices live in the selected surface's space, so suspension stays attached. */
export function applyBikeStickers(body: THREE.Object3D, rider: THREE.Object3D, paint: string, placements: StickerPlacement[]) {
  clearBikeStickers(body);
  if (!placements.length) return;
  const surfaces = stickerSurfaces(body, rider, paint);
  for (const placement of placements) {
    const source = surfaces.get(placement.surface);
    if (!source) continue;
    const selectedNormal = new THREE.Vector3(...placement.normal).normalize();
    const point = new THREE.Vector3(...placement.point);
    const normal = outwardNormal(source, point, selectedNormal);
    const up = Math.abs(normal.y) > 0.94 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    const x = new THREE.Vector3().crossVectors(up, normal).normalize();
    const y = new THREE.Vector3().crossVectors(normal, x).normalize();
    const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, normal));
    rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), placement.rotation));
    const localSource = new THREE.Mesh(source.geometry, source.material);
    localSource.updateMatrixWorld(true);
    const geometry = new DecalGeometry(localSource, point, new THREE.Euler().setFromQuaternion(rotation), new THREE.Vector3(placement.size, placement.size, 0.035));
    // Keep the clicked skin even when its source winding points inward, then
    // turn that skin outward so the print is visible and reads the right way.
    const normals = geometry.getAttribute('normal'), indices: number[] = [];
    const faceNormal = new THREE.Vector3();
    const reverse = normal.dot(selectedNormal) < 0;
    for (let i = 0; i < normals.count; i += 3) {
      faceNormal.set(0, 0, 0);
      for (let j = 0; j < 3; j++) faceNormal.add(new THREE.Vector3().fromBufferAttribute(normals, i + j));
      if (faceNormal.dot(selectedNormal) > 0.15) indices.push(i, i + (reverse ? 2 : 1), i + (reverse ? 1 : 2));
    }
    if (reverse) for (let i = 0; i < normals.count; i++) normals.setXYZ(i, -normals.getX(i), -normals.getY(i), -normals.getZ(i));
    geometry.setIndex(indices);
    // Chrome shading is already present in the supplied pixels. Lighting it a
    // second time washed the gray print into pale paint under the garage lights.
    const material = new THREE.MeshBasicMaterial({ map: stickerArtwork(), toneMapped: false, transparent: true, alphaTest: 0.08, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `sticker-${placement.id}`; mesh.userData.bikeSticker = true; mesh.renderOrder = 3;
    source.add(mesh);
  }
}
