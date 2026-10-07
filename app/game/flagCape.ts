import * as THREE from 'three';
import type { Product } from '../domain/types';
import { imagePath } from '../domain/preview';
import type { CarriedCapMotionInput } from './carriedCapMotion';

export const FLAG_CAPE = Object.freeze({ columns: 20, rows: 24, width: 1.04, length: .626, neckY: .603, neckZ: .104, attachmentWidth: .34 });
type Artwork = NonNullable<NonNullable<Product['preview']>['artwork']>;
type TextureFactory = (url: string) => THREE.Texture;
const clamp = (value: number | undefined, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0;

export function flagCapeUv(artwork: Artwork) {
  const { width, height, crop } = artwork;
  if (![width, height, crop.x, crop.y, crop.width, crop.height].every(Number.isFinite)
    || width <= 0 || height <= 0 || crop.width <= 0 || crop.height <= 0
    || crop.x < 0 || crop.y < 0 || crop.x + crop.width > width || crop.y + crop.height > height) return null;
  return { offset: [crop.x / width, 1 - (crop.y + crop.height) / height] as const,
    repeat: [crop.width / width, crop.height / height] as const };
}

export function createFlagCapeGeometry() {
  const { columns, rows } = FLAG_CAPE;
  const count = (columns + 1) * (rows + 1);
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  const indices = new Uint16Array(columns * rows * 6);
  let index = 0;
  for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
    const vertex = row * (columns + 1) + column;
    uv[vertex * 2] = column / columns;
    uv[vertex * 2 + 1] = 1 - row / rows;
    if (row === rows || column === columns) continue;
    const a = vertex, b = a + 1, c = a + columns + 1, d = c + 1;
    // +Z is the outside when hanging; the original artwork reads from behind.
    indices[index++] = a; indices[index++] = c; indices[index++] = b;
    indices[index++] = b; indices[index++] = c; indices[index++] = d;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-.75, -.15, .05), new THREE.Vector3(.75, 1.5, 1.2));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, .65, .6), 1.35);
  return geometry;
}

/** Fixed attachment row; bounded kinematic cloth, independent of rider anatomy. */
export function createFlagCapeMotion(mesh: THREE.Mesh<THREE.BufferGeometry>) {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const points = position.array as Float32Array, normals = normal.array as Float32Array;
  const indices = geometry.index!.array;
  const inverse = new THREE.Matrix4(), down = new THREE.Vector3(), back = new THREE.Vector3(), direction = new THREE.Vector3();
  let phase = 0, wind = 0, sway = 0, impulse = 0, lastLanding = 0;
  const { rows, columns, length, width, neckY, neckZ, attachmentWidth } = FLAG_CAPE;

  const shape = (reducedMotion: boolean) => {
    down.set(0, -1, 0); back.set(0, 0, 1);
    if (mesh.parent) {
      mesh.parent.updateWorldMatrix(true, false);
      const world = mesh.parent.matrixWorld;
      const determinant = world.determinant();
      if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) return;
      inverse.copy(world).invert();
      down.transformDirection(inverse); back.transformDirection(inverse);
    }
    direction.copy(down).multiplyScalar(1 - .90 * wind).addScaledVector(back, .13 + .97 * wind).normalize();
    for (let row = 0; row <= rows; row++) {
      const t = row / rows, free = Math.min(1, t / .24), spread = free * free * (3 - 2 * free);
      const rowWidth = attachmentWidth + (width - attachmentWidth) * spread;
      const travel = length * t;
      for (let column = 0; column <= columns; column++) {
        const u = column / columns, side = u * 2 - 1, edge = Math.abs(side);
        const anchorY = neckY - .035 * edge, anchorZ = neckZ + .016 * edge;
        const vertex = (row * (columns + 1) + column) * 3;
        if (row === 0) {
          points[vertex] = side * attachmentWidth / 2;
          points[vertex + 1] = anchorY;
          points[vertex + 2] = anchorZ;
          continue;
        }
        const folds = .013 * Math.sin(u * Math.PI * 6) * (Math.sin(Math.PI * t) + .25 * t);
        const flutter = reducedMotion ? 0 : wind * t * (.027 * Math.sin(phase * (3 + 6 * wind) - t * 10 + u * 4.2)
          + .011 * Math.sin(phase * 13 - t * 17 - u * 7));
        const landing = reducedMotion ? 0 : impulse * t * Math.sin(phase * 11 - t * 8);
        let x = side * rowWidth / 2 + direction.x * travel + sway * t * t;
        let y = anchorY + direction.y * travel + flutter * .4 + landing;
        let z = anchorZ + direction.z * travel + folds + flutter;
        // Torso and the coexisting lower-back bag form a smooth keep-out
        // envelope. It also keeps the idle hem above the seat/rear wheel.
        y = Math.max(-.065, Math.min(1.35, y));
        const backClearance = .16 + .145 * Math.exp(-(((y - .10) / .25) ** 2));
        const collarBlend = Math.min(1, t / .12);
        z = Math.max(z, anchorZ + (backClearance - anchorZ) * collarBlend);
        x = Math.max(-.70, Math.min(.70, x));
        points[vertex] = x; points[vertex + 1] = y; points[vertex + 2] = Math.min(1.15, z);
      }
    }
    // Reuse the existing buffers; no per-frame geometry/vector allocation.
    normals.fill(0);
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
      const ux = points[b] - points[a], uy = points[b + 1] - points[a + 1], uz = points[b + 2] - points[a + 2];
      const vx = points[c] - points[a], vy = points[c + 1] - points[a + 1], vz = points[c + 2] - points[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      normals[a] += nx; normals[a + 1] += ny; normals[a + 2] += nz;
      normals[b] += nx; normals[b + 1] += ny; normals[b + 2] += nz;
      normals[c] += nx; normals[c + 1] += ny; normals[c + 2] += nz;
    }
    for (let i = 0; i < normals.length; i += 3) {
      const size = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
      if (size > 1e-10) { normals[i] /= size; normals[i + 1] /= size; normals[i + 2] /= size; }
      else { normals[i] = 0; normals[i + 1] = 0; normals[i + 2] = 1; }
    }
    position.needsUpdate = true; normal.needsUpdate = true;
  };
  const reset = () => { phase = wind = sway = impulse = lastLanding = 0; shape(true); };
  const update = (input: CarriedCapMotionInput, dt: number) => {
    if (input.paused || !Number.isFinite(dt) || dt <= 0) return;
    const elapsed = Math.min(dt, 1 / 12), targetWind = Math.pow(clamp(input.speed, 0, 60) / 60, .7);
    const landing = clamp(input.landing, 0, 1);
    if (input.reducedMotion) {
      phase = sway = impulse = 0; wind = targetWind;
    } else {
      phase = (phase + elapsed) % 1000;
      wind += (targetWind - wind) * (1 - Math.exp(-elapsed * 5));
      sway += (-clamp(input.lateralAcceleration, -20, 20) * .004 - sway) * (1 - Math.exp(-elapsed * 7));
      impulse = Math.min(.065, impulse + Math.max(0, landing - lastLanding) * .055) * Math.exp(-elapsed * 6);
    }
    lastLanding = landing;
    shape(input.reducedMotion === true);
  };
  reset();
  return { update, reset };
}

/** Uses the central catalog image directly, never a replacement or recoloured print. */
export function addFlagCape(torso: THREE.Group, product: Product, loadTexture: TextureFactory = url => new THREE.TextureLoader().load(url)) {
  const artwork = product.preview?.artwork;
  if (product.category !== 'cape' || !artwork) return undefined;
  const uv = flagCapeUv(artwork);
  if (!uv || !(artwork.localImage || artwork.source)) return undefined;
  const map = loadTexture(imagePath(artwork.localImage || artwork.source));
  // Keep this same Texture on the material before loading completes. Native
  // TextureLoader increments its version on load, which createSceneInvalidation
  // already watches for idle garage redraws alongside all other garment maps.
  map.colorSpace = THREE.SRGBColorSpace; map.flipY = true;
  map.offset.set(...uv.offset); map.repeat.set(...uv.repeat);
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping; map.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', map, roughness: 1, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0 });
  material.addEventListener('dispose', () => map.dispose());
  const mesh = new THREE.Mesh(createFlagCapeGeometry(), material);
  mesh.name = 'pfusch-flag-cape'; mesh.userData.productId = product.id;
  mesh.castShadow = false; mesh.receiveShadow = false;
  torso.add(mesh);
  return { mesh, ...createFlagCapeMotion(mesh) };
}
