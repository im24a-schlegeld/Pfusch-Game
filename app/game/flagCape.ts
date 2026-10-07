import * as THREE from 'three';
import type { Product } from '../domain/types';
import { imagePath } from '../domain/preview';
import type { CarriedCapMotionInput } from './carriedCapMotion';

export const FLAG_CAPE = Object.freeze({
  columns: 20, rows: 24, width: .626, length: 1.04,
  neckY: .619, neckZ: .012, collarRadiusX: .15, collarRadiusZ: .14,
  collarStart: -Math.PI + .075, collarEnd: Math.PI - .075,
});
type Artwork = NonNullable<NonNullable<Product['preview']>['artwork']>;
type TextureFactory = (url: string) => THREE.Texture;
const clamp = (value: number | undefined, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0;
const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const collarY = (angle: number) => FLAG_CAPE.neckY - .012 * (1 + Math.cos(angle)) - .03 * smooth(-Math.cos(angle));

function collarPoint(u: number) {
  const { collarStart, collarEnd, collarRadiusX, collarRadiusZ, neckZ } = FLAG_CAPE;
  const angle = collarStart + (collarEnd - collarStart) * u;
  return new THREE.Vector3(Math.sin(angle) * collarRadiusX, collarY(angle), neckZ + Math.cos(angle) * collarRadiusZ);
}

/** One cached conservative surface above the actual saddle and rear bodywork. */
function bikeClearance(torso: THREE.Object3D | null) {
  let body = torso;
  while (body && !body.userData.importedBike) body = body.parent;
  if (!body) return undefined;
  const tail = body.userData.tailContact as readonly number[] | undefined;
  const contact = body.userData.riderSeatContact as { surfaceY: number } | undefined;
  let top = Math.max(tail?.[1] ?? -Infinity, contact?.surfaceY ?? -Infinity);
  body.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().copy(body.matrixWorld).invert();
  const transform = new THREE.Matrix4(), bounds = new THREE.Box3();
  body.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !/seat|saddle/i.test(object.userData.importedPart ?? '')) return;
    object.geometry.computeBoundingBox();
    if (!object.geometry.boundingBox) return;
    transform.multiplyMatrices(inverse, object.matrixWorld);
    bounds.copy(object.geometry.boundingBox).applyMatrix4(transform);
    top = Math.max(top, bounds.max.y);
  });
  return Number.isFinite(top) ? { body, top: top + .045 } : undefined;
}

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
    // A clockwise quarter-turn of the original flag, without mirroring its print:
    // original bottom-left -> collar start; original top-left -> collar end.
    // Both real eyelets are on this original LEFT (now collar) short edge.
    uv[vertex * 2] = row / rows;
    uv[vertex * 2 + 1] = column / columns;
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
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-.75, -.48, -.17), new THREE.Vector3(.75, 1.7, 1.3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, .6, .59), 1.55);
  return geometry;
}

/** The short eyelet edge wraps around the neck; its tied corners stay fixed. */
export function createFlagCapeMotion(mesh: THREE.Mesh<THREE.BufferGeometry>) {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const points = position.array as Float32Array, normals = normal.array as Float32Array;
  const indices = geometry.index!.array;
  const inverse = new THREE.Matrix4(), down = new THREE.Vector3(), back = new THREE.Vector3(), direction = new THREE.Vector3();
  const clearance = bikeClearance(mesh.parent);
  const torsoToBike = new THREE.Matrix4(), bikeToTorso = new THREE.Matrix4(), bikePoint = new THREE.Vector3();
  let phase = 0, wind = 0, sway = 0, impulse = 0, lastLanding = 0;
  const { rows, columns, length, width, neckZ, collarStart, collarEnd, collarRadiusX, collarRadiusZ } = FLAG_CAPE;

  const shape = (reducedMotion: boolean) => {
    down.set(0, -1, 0); back.set(0, 0, 1);
    if (mesh.parent) {
      mesh.parent.updateWorldMatrix(true, false);
      const world = mesh.parent.matrixWorld;
      const determinant = world.determinant();
      if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) return;
      inverse.copy(world).invert();
      down.transformDirection(inverse); back.transformDirection(inverse);
      if (clearance) {
        bikeToTorso.multiplyMatrices(inverse, clearance.body.matrixWorld);
        torsoToBike.copy(bikeToTorso).invert();
      }
    }
    direction.copy(down).multiplyScalar(1 - .90 * wind).addScaledVector(back, .13 + .97 * wind).normalize();
    for (let row = 0; row <= rows; row++) {
      const t = row / rows, spread = smooth(t / .31), shoulders = smooth(t / .10);
      const travel = length * t;
      // The idle cloth follows the back, then bends rearward over the seat.
      // Integrate a short circular bend instead of flattening the long hem at a Y clamp.
      const bendTravel = Math.max(0, travel - .46), bendAngle = Math.min(1.15, bendTravel / .25);
      const afterBend = Math.max(0, bendTravel - .25 * 1.15);
      const drop = Math.min(travel, .46) + .25 * Math.sin(bendAngle) + afterBend * Math.cos(1.15);
      const rear = .25 * (1 - Math.cos(bendAngle)) + afterBend * Math.sin(1.15);
      const centerX = (down.x * drop + back.x * rear) * (1 - wind) + direction.x * travel * wind;
      const centerY = (down.y * drop + back.y * rear) * (1 - wind) + direction.y * travel * wind;
      const centerZ = (down.z * drop + back.z * rear) * (1 - wind) + direction.z * travel * wind;
      for (let column = 0; column <= columns; column++) {
        const u = column / columns, side = u * 2 - 1;
        const collarAngle = collarStart + (collarEnd - collarStart) * u;
        const angle = collarAngle + (side * Math.PI / 2 - collarAngle) * spread;
        const radius = collarRadiusX + (width / 2 - collarRadiusX) * shoulders;
        const anchorY = collarY(collarAngle);
        const anchorZ = neckZ + Math.cos(collarAngle) * collarRadiusZ;
        const vertex = (row * (columns + 1) + column) * 3;
        if (row === 0) {
          points[vertex] = Math.sin(collarAngle) * collarRadiusX;
          points[vertex + 1] = anchorY;
          points[vertex + 2] = anchorZ;
          continue;
        }
        const folds = .016 * Math.sin(u * Math.PI * 6 + .6 * Math.sin(t * 5)) * (Math.sin(Math.PI * t) + .25 * t);
        const flutter = reducedMotion ? 0 : wind * t * (.027 * Math.sin(phase * (3 + 6 * wind) - t * 10 + u * 4.2)
          + .011 * Math.sin(phase * 13 - t * 17 - u * 7));
        const landing = reducedMotion ? 0 : impulse * t * Math.sin(phase * 11 - t * 8);
        // The collar first fans over both shoulders and then opens into the
        // narrower, long flag. The tied corners meet at the front centre.
        let x = Math.sin(angle) * radius * (1 - spread) + side * width / 2 * spread + centerX + sway * t * t;
        let y = anchorY + centerY + flutter * .4 + landing;
        let z = neckZ + Math.cos(angle) * (collarRadiusZ + .04 * shoulders) * (1 - spread)
          + .17 * spread + centerZ + .10 * t * t * (1 - wind) + folds * spread + flutter;
        // Smooth torso / bag clearance starts behind the shoulder wrap.
        y = Math.max(-.46, Math.min(1.65, y));
        const backClearance = .16 + .145 * Math.exp(-(((y - .10) / .25) ** 2)) + .18 * smooth(-y / .25);
        z = Math.max(z, anchorZ + (backClearance - anchorZ) * spread);
        // Garments remain wide above the skeleton's shoulder joint: their
        // neckline only narrows around Y .607. Keep the wrap outside that
        // sloping surface, including its sleeve seam, rather than through it.
        if (t < .36 && y > .36 && y < .65) {
          const neckline = smooth((y - .55) / .075);
          const shoulderX = .31 - .19 * neckline;
          const shoulderZ = .17 - .075 * neckline;
          const radialZ = z - neckZ;
          const outside = Math.hypot(x / shoulderX, radialZ / shoulderZ);
          if (outside < 1 && outside > 1e-7) {
            x /= outside; z = neckZ + radialZ / outside;
          }
        }
        if (clearance && t > .30) {
          // A bike-space surface follows the real chassis through wheelies.
          // Smoothly bend the drape above seat/tail instead of a flat Y clamp
          // in torso space, which allowed the hem to cut through the bike.
          bikePoint.set(x, y, z).applyMatrix4(torsoToBike);
          const gap = bikePoint.y - clearance.top;
          if (gap < .24) {
            bikePoint.y = clearance.top + .065 * Math.log1p(Math.exp(gap / .065));
            bikePoint.applyMatrix4(bikeToTorso);
            x = bikePoint.x; y = bikePoint.y; z = bikePoint.z;
          }
        }
        x = Math.max(-.70, Math.min(.70, x));
        points[vertex] = x; points[vertex + 1] = y; points[vertex + 2] = Math.min(1.28, z);
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

/** Physical eyelets and the tied cloth corners, outside the unchanged printed artwork. */
function addTiedEyelets(mesh: THREE.Mesh) {
  const hardware = new THREE.Group(); hardware.name = 'flag-cape-tied-eyelets';
  const metal = new THREE.MeshStandardMaterial({ color: '#aeb0ad', roughness: .4, metalness: .8 });
  const fabric = new THREE.MeshStandardMaterial({ color: '#292929', roughness: 1, metalness: 0 });
  const left = collarPoint(0), right = collarPoint(1);
  const eyes = [left, right];
  for (let i = 0; i < eyes.length; i++) {
    const eye = new THREE.Mesh(new THREE.TorusGeometry(.0115, .0025, 6, 16), metal);
    eye.name = i === 0 ? 'flag-original-bottom-left-eyelet' : 'flag-original-top-left-eyelet';
    eye.position.copy(eyes[i]); eye.position.y -= .008;
    // Let the metal sit on top of the folded fabric rather than coplanar with it.
    const angle = i === 0 ? FLAG_CAPE.collarStart : FLAG_CAPE.collarEnd;
    eye.position.x += Math.sin(angle) * .004;
    eye.position.z += Math.cos(angle) * .004;
    eye.rotation.y = i === 0 ? FLAG_CAPE.collarStart : FLAG_CAPE.collarEnd;
    hardware.add(eye);
    eyes[i].copy(eye.position);
  }
  const knot = left.clone().add(right).multiplyScalar(.5).add(new THREE.Vector3(0, -.008, -.01));
  const tie = (name: string, points: THREE.Vector3[]) => {
    const cord = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 14, .0045, 5, false), fabric);
    cord.name = name; hardware.add(cord);
  };
  tie('flag-eyelet-connecting-tie', [left, knot, right]);
  tie('flag-tie-loop', [knot, knot.clone().add(new THREE.Vector3(.02, .009, -.008)),
    knot.clone().add(new THREE.Vector3(.019, -.009, -.009)), knot]);
  tie('flag-tie-tail', [knot, knot.clone().add(new THREE.Vector3(-.003, -.024, -.004)),
    knot.clone().add(new THREE.Vector3(.009, -.04, .002))]);
  const center = new THREE.Mesh(new THREE.SphereGeometry(.008, 8, 6), fabric);
  center.name = 'flag-cape-knot'; center.position.copy(knot); center.scale.set(1.3, .8, 1);
  hardware.add(center); mesh.add(hardware);
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
  addTiedEyelets(mesh);
  torso.add(mesh);
  return { mesh, ...createFlagCapeMotion(mesh) };
}
