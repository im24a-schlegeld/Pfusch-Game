import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import type { StickerPlacement } from '../domain/types';

let artwork: THREE.Texture | undefined;
export function stickerArtwork() {
  if (!artwork) {
    // Match the supplied nearly-square decal with deeply rounded corners.
    // Keep the official chrome wordmark smaller and centered on the black
    // 6 × 6 cm backing instead of stretching it to the sticker's silhouette.
    artwork = new THREE.TextureLoader().load(
      '/branding/pfusch-logo.webp',
      (texture: THREE.Texture) => {
        const print = texture.image as HTMLImageElement;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 512;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.fillStyle = '#111315';
        context.beginPath();
        context.roundRect(8, 8, 496, 496, 132);
        context.fill();
        const width = 292,
          height = (width * print.height) / print.width;
        context.drawImage(
          print,
          (512 - width) / 2,
          (512 - height) / 2,
          width,
          height,
        );
        texture.image = canvas;
        texture.needsUpdate = true;
      },
    );
    artwork.colorSpace = THREE.SRGBColorSpace;
  }
  return artwork;
}
export function stickerSurfaces(
  body: THREE.Object3D,
  rider: THREE.Object3D,
  paint: string,
) {
  const result = new Map<string, THREE.Mesh>();
  const color = new THREE.Color(paint);
  function visit(object: THREE.Object3D, path: string) {
    if (
      object === rider ||
      object.userData.bikeSticker ||
      /wheel|keychain|ignition|carried-cap/.test(object.name)
    )
      return;
    if (object instanceof THREE.Mesh) {
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      if (
        materials.some(
          (m) =>
            m instanceof THREE.MeshStandardMaterial && m.color.equals(color),
        ) ||
        /tank|fairing|shroud|apron|leg-shield|fender|tail-shell|open-back-fork-guard/.test(
          object.name,
        )
      )
        result.set(path, object);
    }
    object.children.forEach((child, index) =>
      visit(child, `${path}/${child.name || 'mesh'}:${index}`),
    );
  }
  visit(body, 'body');
  return result;
}
export function clearBikeStickers(body: THREE.Object3D) {
  const old: THREE.Mesh[] = [];
  body.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData.bikeSticker) old.push(o);
  });
  old.forEach((mesh) => {
    mesh.removeFromParent();
    mesh.geometry.dispose();
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(
      (m) => m.dispose(),
    );
  });
}
/** Some double-sided body panels have inward triangle winding. A saved face
 * normal still identifies the selected skin; the nearer opposite skin tells
 * us which direction points into the panel, without changing saved positions. */
function outwardNormal(
  source: THREE.Mesh,
  point: THREE.Vector3,
  normal: THREE.Vector3,
) {
  const probeMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const probe = new THREE.Mesh(source.geometry, probeMaterial);
  probe.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const distance = (direction: THREE.Vector3) => {
    ray.set(point.clone().addScaledVector(direction, 0.00001), direction);
    return ray.intersectObject(probe, false)[0]?.distance ?? Infinity;
  };
  const into = distance(normal),
    away = distance(normal.clone().negate());
  probeMaterial.dispose();
  return into < away ? normal.clone().negate() : normal.clone();
}
/** Added vehicle details can shift child indices without changing the selected
 * panel. Keep version-1 placements attached to that named panel and side. */
function savedSurface(
  surfaces: Map<string, THREE.Mesh>,
  placement: StickerPlacement,
) {
  const exact = surfaces.get(placement.surface);
  if (exact) return exact;
  const namedPath = (path: string) => path.replace(/:\d+(?=\/|$)/g, '');
  const target = namedPath(placement.surface);
  const point = new THREE.Vector3(...placement.point);
  let nearest: THREE.Mesh | undefined,
    distance = Infinity;
  for (const [path, mesh] of surfaces) {
    if (namedPath(path) !== target) continue;
    mesh.geometry.computeBoundingBox();
    const candidate = mesh.geometry.boundingBox!.distanceToPoint(point);
    if (candidate < distance) {
      nearest = mesh;
      distance = candidate;
    }
  }
  if (nearest) return nearest;

  // A saved placement can reference a panel whose name changed with a model
  // revision. Keep it visible on the closest current painted panel instead of
  // silently dropping the sticker.
  for (const mesh of surfaces.values()) {
    mesh.geometry.computeBoundingBox();
    const candidate = mesh.geometry.boundingBox!.distanceToPoint(point);
    if (candidate < distance) {
      nearest = mesh;
      distance = candidate;
    }
  }
  return nearest;
}

function projectedStickerGeometry(
  source: THREE.Mesh,
  point: THREE.Vector3,
  selectedNormal: THREE.Vector3,
  placement: StickerPlacement,
  recoveryFacing?: THREE.Vector3,
) {
  const normal = outwardNormal(source, point, selectedNormal);
  const up = Math.abs(normal.y) > 0.94
    ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const x = new THREE.Vector3().crossVectors(up, normal).normalize();
  const y = new THREE.Vector3().crossVectors(normal, x).normalize();
  const rotation = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(x, y, normal),
  );
  rotation.multiply(new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1), placement.rotation,
  ));
  const localSource = new THREE.Mesh(source.geometry, source.material);
  localSource.updateMatrixWorld(true);
  const geometry = new DecalGeometry(
    localSource, point, new THREE.Euler().setFromQuaternion(rotation),
    new THREE.Vector3(placement.size, placement.size, 0.035),
  );
  // Keep the clicked skin even when its winding points inward, then turn
  // only that skin outward so the print remains visible without mirroring.
  const normals = geometry.getAttribute('normal');
  if (!normals) {
    geometry.dispose();
    return undefined;
  }
  const indices: number[] = [], faceNormal = new THREE.Vector3();
  const face = new THREE.Triangle(), geometricNormal = new THREE.Vector3();
  const positions = geometry.getAttribute('position');
  const reverse = normal.dot(selectedNormal) < 0;
  for (let i = 0; i < normals.count; i += 3) {
    faceNormal.set(0, 0, 0);
    for (let j = 0; j < 3; j++)
      faceNormal.add(new THREE.Vector3().fromBufferAttribute(normals, i + j));
    if (recoveryFacing) {
      // Smoothed edge normals can face sideways even on a horizontal return.
      // Old stickers must recover onto a real face visible from their saved
      // side, rather than predominantly printing on a thin hidden underside.
      face.a.fromBufferAttribute(positions, i);
      face.b.fromBufferAttribute(positions, i + 1);
      face.c.fromBufferAttribute(positions, i + 2);
      face.getNormal(geometricNormal);
      if (Math.abs(geometricNormal.dot(recoveryFacing)) <= 0.15) continue;
    }
    if (faceNormal.dot(selectedNormal) > 0.15)
      indices.push(i, i + (reverse ? 2 : 1), i + (reverse ? 1 : 2));
  }
  if (reverse) for (let i = 0; i < normals.count; i++)
    normals.setXYZ(i, -normals.getX(i), -normals.getY(i), -normals.getZ(i));
  geometry.setIndex(indices);
  return geometry;
}

/** These Supermoto panels were reshaped without changing save schema 1.
 * Recover an empty old projection on the same real skin, only for rendering;
 * a valid current placement and the persisted point/normal stay untouched. */
function reshapedSurfacePoint(source: THREE.Mesh, point: THREE.Vector3, normal: THREE.Vector3) {
  if (!['radiator-shroud', 'supermoto-front-fender', 'supermoto-headlight-mask', 'supermoto-fuel-tank',
    'supermoto-side-cover', 'supermoto-tail-fender', 'open-back-fork-guard'].includes(source.name))
    return undefined;
  const positions = source.geometry.getAttribute('position'), index = source.geometry.getIndex();
  const triangle = new THREE.Triangle(), candidate = new THREE.Vector3(), faceNormal = new THREE.Vector3();
  let nearest: { point: THREE.Vector3; normal: THREE.Vector3 } | undefined, distance = Infinity;
  for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
    triangle.a.fromBufferAttribute(positions, index ? index.getX(i) : i);
    triangle.b.fromBufferAttribute(positions, index ? index.getX(i + 1) : i + 1);
    triangle.c.fromBufferAttribute(positions, index ? index.getX(i + 2) : i + 2);
    triangle.getNormal(faceNormal);
    if (faceNormal.dot(normal) <= 0.15 || triangle.getArea() < 1e-12) continue;
    triangle.closestPointToPoint(point, candidate);
    const gap = candidate.distanceToSquared(point);
    if (gap < distance) {
      distance = gap;
      nearest = { point: candidate.clone(), normal: faceNormal.clone() };
    }
  }
  return nearest;
}
/** Decal vertices live in the selected surface's space, so suspension stays attached. */
export function applyBikeStickers(
  body: THREE.Object3D,
  rider: THREE.Object3D,
  paint: string,
  placements: StickerPlacement[],
) {
  clearBikeStickers(body);
  if (!placements.length) return;
  const surfaces = stickerSurfaces(body, rider, paint);
  for (const placement of placements) {
    try {
      const source = savedSurface(surfaces, placement);
      if (!source) continue;
      const selectedNormal = new THREE.Vector3(...placement.normal).normalize();
      const point = new THREE.Vector3(...placement.point);
      source.geometry.computeBoundingBox();
      if (source.geometry.boundingBox)
        source.geometry.boundingBox.clampPoint(point, point);
      let geometry = projectedStickerGeometry(source, point, selectedNormal, placement);
      if (!geometry?.getIndex()?.count) {
        geometry?.dispose();
        const recovered = reshapedSurfacePoint(source, point, selectedNormal);
        if (!recovered) continue;
        geometry = projectedStickerGeometry(source, recovered.point, recovered.normal, placement, selectedNormal);
        if (!geometry?.getIndex()?.count) {
          geometry?.dispose();
          continue;
        }
      }
      // Chrome shading is already present in the supplied pixels. Lighting it a
      // second time washed the gray print into pale paint under the garage lights.
      const material = new THREE.MeshBasicMaterial({
        map: stickerArtwork(),
        toneMapped: false,
        transparent: true,
        alphaTest: 0.08,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `sticker-${placement.id}`;
      mesh.userData.bikeSticker = true;
      mesh.renderOrder = 3;
      source.add(mesh);
    } catch (error) {
      // One stale placement should not hide the valid placements or stop the
      // workshop render loop. The saved entry remains editable/removable.
      console.error(`Sticker ${placement.id} konnte nicht dargestellt werden.`, error);
    }
  }
}
