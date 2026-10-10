import * as THREE from 'three';
import type { Product } from '../domain/types';
import { imagePath } from '../domain/preview';
import type { CarriedCapMotionInput } from './carriedCapMotion';
import { createFlagCloth } from './flagCloth';

export const FLAG_CAPE = Object.freeze({
  columns: 10, rows: 14, width: .626, length: 1.04,
  neckY: .637, neckZ: .040, collarRadiusX: .095, collarRadiusZ: .120,
  collarStart: -Math.PI + .075, collarEnd: Math.PI - .075,
});
type Artwork = NonNullable<NonNullable<Product['preview']>['artwork']>;
type TextureFactory = (url: string) => THREE.Texture;
const clamp = (value: number | undefined, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0;
const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
// The rear edge passes over the folded hood, below the helmet. The side
// supports sit on the narrow neck; the original eyelets meet over the chest.
const collarY = (angle: number) => FLAG_CAPE.neckY - .017 * Math.cos(angle) ** 2 - .010 * smooth(-Math.cos(angle));

function collarPoint(u: number) {
  const { collarStart, collarEnd, collarRadiusX, collarRadiusZ, neckZ } = FLAG_CAPE;
  const angle = collarStart + (collarEnd - collarStart) * u;
  return new THREE.Vector3(Math.sin(angle) * collarRadiusX, collarY(angle), neckZ + Math.cos(angle) * collarRadiusZ);
}

/** Sample the actual hood loft once, including its rounded intermediate rings. */
function hoodClearance(torso: THREE.Object3D | null) {
  const hood = torso?.getObjectByName('folded-hood');
  if (!(hood instanceof THREE.Mesh)) return [];
  const positions = hood.geometry.getAttribute('position') as THREE.BufferAttribute;
  const rings = new Map<number, number[]>();
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const y = positions.getY(vertex), x = Math.abs(positions.getX(vertex)), z = positions.getZ(vertex);
    const ring = rings.get(y);
    if (ring) { ring[1] = Math.max(ring[1], x); ring[2] = Math.min(ring[2], z); ring[3] = Math.max(ring[3], z); }
    else rings.set(y, [y, x, z, z]);
  }
  return [...rings.values()].sort((a, b) => a[0] - b[0])
    .map(([y, x, front, rear]) => [y, x + .006, (rear - front) / 2 + .008, (rear + front) / 2]);
}

/** Finite seat/tail and rear-wheel volumes, in the actual bike's frame. */
function bikeClearance(torso: THREE.Object3D | null) {
  let body = torso;
  while (body && !body.userData.importedBike) body = body.parent;
  if (!body) return undefined;
  body.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().copy(body.matrixWorld).invert();
  const transform = new THREE.Matrix4(), bounds = new THREE.Box3();
  const seat = new THREE.Box3(), wheel = new THREE.Box3();
  body.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const name = String(object.userData.importedPart ?? '');
    const target = /seat|saddle/i.test(name) ? seat : /rearWheel/i.test(name) ? wheel : undefined;
    if (!target) return;
    object.geometry.computeBoundingBox();
    if (!object.geometry.boundingBox) return;
    transform.multiplyMatrices(inverse, object.matrixWorld);
    bounds.copy(object.geometry.boundingBox).applyMatrix4(transform);
    target.union(bounds);
  });
  const tail = body.userData.tailContact as readonly number[] | undefined;
  if (tail) {
    seat.expandByPoint(new THREE.Vector3(tail[0] - .12, tail[1] - .045, tail[2] - .10));
    seat.expandByPoint(new THREE.Vector3(tail[0] + .12, tail[1] + .015, tail[2] + .10));
  }
  return { body, boxes: [seat, wheel].filter(box => !box.isEmpty()).map(box => box.expandByScalar(.025)) };
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
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-1.2, -.65, -1.1), new THREE.Vector3(1.2, 1.9, 1.3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, .64, .012), 1.35);
  return geometry;
}

/** Fixed material lengths, gravity and inertia; only the neck supports follow the rider. */
export function createFlagCapeMotion(mesh: THREE.Mesh<THREE.BufferGeometry>) {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const points = position.array as Float32Array;
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const normals = normal.array as Float32Array, indices = geometry.index!.array;
  const { columns, rows, width, length } = FLAG_CAPE;
  const cloth = createFlagCloth(columns, rows, width, length, points);
  const clearance = bikeClearance(mesh.parent);
  const inverse = new THREE.Matrix4(), lastWorld = new THREE.Matrix4(), rebase = new THREE.Matrix4();
  const torsoToBike = new THREE.Matrix4(), bikeToTorso = new THREE.Matrix4();
  const down = new THREE.Vector3(), back = new THREE.Vector3(), force = new THREE.Vector3();
  const point = new THREE.Vector3();
  let phase = 0, remainder = 0, hasWorld = false, hasBag = false, lastLanding = 0;
  let scaleChanged = false;
  let reducedKey = '', wasReduced = false;
  // A conservative fit around the real garment loft, not an oversized bubble
  // that pushes the flag away from the rider's back.
  const profile = [
    [-.10, .228, .150], [.18, .235, .144], [.37, .248, .151],
    [.52, .265, .132], [.568, .235, .108], [.588, .188, .096],
    [.607, .116, .074], [.631, .082, .065], [.65, .064, .064], [.80, .064, .064],
  ];
  const hoodProfile = hoodClearance(mesh.parent);
  const collide = (vertex: number) => {
    const i = vertex * 3;
    let x = points[i], y = points[i + 1], z = points[i + 2];
    if (y > profile[0][0] && y < profile[profile.length - 1][0]) {
      let row = 1;
      while (row < profile.length - 1 && y > profile[row][0]) row++;
      const a = profile[row - 1], b = profile[row], t = (y - a[0]) / (b[0] - a[0]);
      const rx = a[1] + (b[1] - a[1]) * t, rz = a[2] + (b[2] - a[2]) * t;
      const radialSquared = x * x / (rx * rx) + z * z / (rz * rz);
      if (radialSquared < 1) {
        const radial = Math.sqrt(radialSquared);
        if (radial > 1e-7) {
          // Follow the sloping shoulder/neck surface normal. A horizontal-only
          // push widens the collar instead of letting it slide up the neck.
          const nx = x / (rx * rx), nz = z / (rz * rz);
          const ny = -x * x * (b[1] - a[1]) / ((b[0] - a[0]) * rx ** 3)
            - z * z * (b[2] - a[2]) / ((b[0] - a[0]) * rz ** 3);
          const correction = (1 - radial) * radial / (nx * nx + ny * ny + nz * nz);
          x += nx * correction; y += ny * correction; z += nz * correction;
        } else z = rz;
      }
    }
    if (hoodProfile.length && y > hoodProfile[0][0] && y < hoodProfile[hoodProfile.length - 1][0]) {
      let row = 1;
      while (row < hoodProfile.length - 1 && y > hoodProfile[row][0]) row++;
      const a = hoodProfile[row - 1], b = hoodProfile[row], t = (y - a[0]) / (b[0] - a[0]);
      const rx = a[1] + (b[1] - a[1]) * t, rz = a[2] + (b[2] - a[2]) * t;
      const center = a[3] + (b[3] - a[3]) * t;
      if (Math.abs(x) < rx + .008 && z > center - .02)
        z = Math.max(z, center + rz * Math.sqrt(Math.max(0, 1 - x * x / (rx * rx))));
    }
    if (hasBag && z > .10) {
      const by = y - .16, bz = z - .18;
      const squared = x * x / .04 + by * by / .0484 + bz * bz / .0169;
      if (squared < 1 && squared > 1e-14) {
        const distance = Math.sqrt(squared);
        x /= distance; y = .16 + by / distance; z = .18 + bz / distance;
      }
    }
    if (clearance) {
      point.set(x, y, z).applyMatrix4(torsoToBike);
      let contact = false;
      for (const box of clearance.boxes) {
        if (!box.containsPoint(point)) continue;
        contact = true;
        // The finite volume lets the hem fall beside or behind the motorcycle.
        // Never stretch every lower vertex onto an infinite horizontal plane.
        let face = 0, nearest = point.x - box.min.x;
        const right = box.max.x - point.x, bottom = point.y - box.min.y;
        const top = box.max.y - point.y, front = point.z - box.min.z, rear = box.max.z - point.z;
        if (right < nearest) { face = 1; nearest = right; }
        if (bottom < nearest) { face = 2; nearest = bottom; }
        if (top < nearest) { face = 3; nearest = top; }
        if (front < nearest) { face = 4; nearest = front; }
        if (rear < nearest) face = 5;
        if (face === 0) point.x = box.min.x;
        else if (face === 1) point.x = box.max.x;
        else if (face === 2) point.y = box.min.y;
        else if (face === 3) point.y = box.max.y;
        else if (face === 4) point.z = box.min.z;
        else point.z = box.max.z;
      }
      if (contact) {
        point.applyMatrix4(bikeToTorso);
        x = point.x; y = point.y; z = point.z;
      }
    }
    points[i] = x; points[i + 1] = y; points[i + 2] = z;
  };
  const frame = (preserveInertia: boolean) => {
    scaleChanged = false;
    hasBag = false;
    for (const child of mesh.parent?.children ?? []) {
      if (child.name === 'crossbody-assembly-v43') hasBag = true;
    }
    if (mesh.parent) {
      for (let ancestor: THREE.Object3D | null = mesh.parent; ancestor; ancestor = ancestor.parent)
        ancestor.matrixWorldNeedsUpdate = true;
      mesh.parent.updateWorldMatrix(true, false);
      const world = mesh.parent.matrixWorld;
      if (!world.elements.every(Number.isFinite) || Math.abs(world.determinant()) < 1e-10) return false;
      inverse.copy(world).invert();
      if (hasWorld) {
        const old = lastWorld.elements, current = world.elements;
        scaleChanged = Math.abs(Math.hypot(old[0], old[1], old[2]) - Math.hypot(current[0], current[1], current[2])) > 1e-5;
      }
      if (hasWorld && preserveInertia && !scaleChanged) {
        rebase.multiplyMatrices(inverse, lastWorld);
        for (let vertex = 0; vertex < points.length / 3; vertex++) {
          if (cloth.pinned[vertex]) continue;
          const i = vertex * 3;
          point.fromArray(points, i).applyMatrix4(rebase).toArray(points, i);
          point.fromArray(cloth.previous, i).applyMatrix4(rebase).toArray(cloth.previous, i);
        }
      }
      lastWorld.copy(world); hasWorld = true;
      if (clearance) {
        bikeToTorso.multiplyMatrices(inverse, clearance.body.matrixWorld);
        torsoToBike.copy(bikeToTorso).invert();
      }
    } else inverse.identity();
    down.set(0, -1, 0).transformDirection(inverse);
    // Ride direction belongs to the motorcycle, including garage turntables.
    back.set(0, 0, 1);
    if (clearance) back.transformDirection(bikeToTorso);
    return true;
  };
  const seed = () => {
    for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
      const u = column / columns, t = row / rows, spread = smooth(t / .30);
      const anchor = collarPoint(u), side = 2 * u - 1;
      const i = (row * (columns + 1) + column) * 3;
      points[i] = anchor.x * (1 - spread) + side * width / 2 * spread;
      points[i + 1] = anchor.y - length * t;
      points[i + 2] = anchor.z * (1 - spread) + (.165 + t * .08) * spread;
      if (!cloth.pinned[row * (columns + 1) + column]) {
        if (clearance) {
          point.fromArray(points, i).applyMatrix4(torsoToBike);
          for (const box of clearance.boxes) if (point.x >= box.min.x && point.x <= box.max.x && point.z >= box.min.z && point.z <= box.max.z)
            point.y = Math.max(point.y, box.max.y + .005);
          point.applyMatrix4(bikeToTorso).toArray(points, i);
        }
        collide(row * (columns + 1) + column);
      }
    }
    cloth.reset();
  };
  const publish = () => {
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
      const size = Math.sqrt(normals[i] * normals[i] + normals[i + 1] * normals[i + 1] + normals[i + 2] * normals[i + 2]);
      if (size > 1e-10) { normals[i] /= size; normals[i + 1] /= size; normals[i + 2] /= size; }
      else { normals[i] = 0; normals[i + 1] = 0; normals[i + 2] = 1; }
    }
    position.needsUpdate = true; normal.needsUpdate = true;
  };
  const settle = (speed: number) => {
    force.copy(down).multiplyScalar(9.81);
    const wind = Math.min(24, speed * speed * .008);
    for (let step = 0; step < 90; step++) cloth.step(force.x, force.y, force.z, back.x * wind, back.y * wind, back.z * wind, 0, 0, .82, collide);
    cloth.previous.set(points);
  };
  const reset = () => {
    phase = remainder = lastLanding = 0; hasWorld = false; reducedKey = ''; wasReduced = false;
    if (!frame(false)) return;
    seed(); settle(0); publish();
  };
  const update = (input: CarriedCapMotionInput, dt: number) => {
    if (input.paused || !Number.isFinite(dt) || dt <= 0) return;
    const reduced = input.reducedMotion === true, speed = clamp(input.speed, 0, 60);
    if (!frame(!reduced)) return;
    // Imported bikes finish applying their inverse rider scale after assembly.
    // That construction transform is not a physical movement or an impulse.
    if (scaleChanged) { if (!reduced) { seed(); settle(0); } reducedKey = ''; }
    if (reduced) {
      const key = [down.x, down.y, down.z, speed, hasBag ? 1 : 0, ...torsoToBike.elements].map(value => Math.round(value * 10000)).join(',');
      if (!wasReduced || key !== reducedKey) { seed(); settle(speed); publish(); reducedKey = key; }
      wasReduced = true; remainder = 0; lastLanding = clamp(input.landing, 0, 1);
      return;
    }
    wasReduced = false;
    const landing = clamp(input.landing, 0, 1), impulse = Math.max(0, landing - lastLanding) * .012;
    lastLanding = landing;
    if (impulse) for (let vertex = 0; vertex < points.length / 3; vertex++) {
      if (cloth.pinned[vertex]) continue;
      const i = vertex * 3;
      cloth.previous[i] += down.x * impulse; cloth.previous[i + 1] += down.y * impulse; cloth.previous[i + 2] += down.z * impulse;
    }
    force.copy(down).multiplyScalar(9.81);
    const wind = Math.min(24, speed * speed * .008);
    point.set(-clamp(input.lateralAcceleration, -20, 20), 0, clamp(input.longitudinalAcceleration, -20, 20)).transformDirection(inverse);
    // Acceleration amplitudes must survive the coordinate transform.
    const acceleration = Math.hypot(clamp(input.lateralAcceleration, -20, 20), clamp(input.longitudinalAcceleration, -20, 20));
    force.addScaledVector(point, acceleration * .6);
    // Visual cloth never catches up a long browser stall: at most two small
    // simulation steps per rendered frame, with fixed buffers and no new mesh.
    remainder += Math.min(dt, 1 / 30);
    while (remainder + 1e-10 >= 1 / 60) {
      remainder = Math.max(0, remainder - 1 / 60); phase += 1 / 60;
      cloth.step(force.x, force.y, force.z, back.x * wind, back.y * wind, back.z * wind, phase, speed / 60 * 2, .96, collide);
    }
    publish();
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
