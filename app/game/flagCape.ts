import * as THREE from 'three';
import type { Product } from '../domain/types';
import { imagePath } from '../domain/preview';
import type { CarriedCapMotionInput } from './carriedCapMotion';
import { createFlagCloth } from './flagCloth';

export const FLAG_CAPE = Object.freeze({
  columns: 10, rows: 14, width: .626, length: 1.04,
  neckY: .565, neckZ: .125, collarRadiusX: .265, collarRadiusZ: .075,
  collarStart: -Math.PI / 2, collarEnd: Math.PI / 2,
});
type Artwork = NonNullable<NonNullable<Product['preview']>['artwork']>;
type TextureFactory = (url: string) => THREE.Texture;
const clamp = (value: number | undefined, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0;
const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const SIDE_FOLLOW = .8;
const SIDE_FORCE = .18;
const SIDE_RESPONSE = 1 - Math.exp(-1 / (60 * .18));
const MOTION_DAMPING = .92;
const windPressure = (speed: number) => Math.min(68, speed * speed * .055);
// The cloth's upper edge follows the rear shoulders below the folded hood.
// Only the light eyelet ties go around the neck; the fabric cannot climb
// into the helmet opening as a fully wrapped neck loop could.
const collarY = (angle: number) => FLAG_CAPE.neckY - .025 * (1 - Math.cos(angle));

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

/** Rasterize actual rear bodywork once. Cloth contacts never raycast the bike. */
function bikeClearance(torso: THREE.Object3D | null) {
  let body = torso;
  while (body && !body.userData.importedBike) body = body.parent;
  if (!body) return undefined;
  body.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().copy(body.matrixWorld).invert();
  const transform = new THREE.Matrix4(), bounds = new THREE.Box3(), point = new THREE.Vector3();
  const surfaceBounds = new THREE.Box3(), wheel = new THREE.Box3();
  const triangles: number[] = [];
  const tail = body.userData.tailContact as readonly number[] | undefined;
  const rearStart = tail ? tail[2] - 1.05 : -.3;
  body.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const name = String(object.userData.importedPart ?? '');
    const isWheel = object.userData.importedRig === 'rearWheel' || /rearWheel/i.test(name);
    const isBody = object.userData.importedRig === 'body' || /seat|saddle/i.test(name);
    if (!name || (!isWheel && !isBody)) return;
    const positions = object.geometry.getAttribute('position');
    if (!positions) return;
    // Imported part geometries can keep a shared position buffer while their
    // index selects only the seat or wheel triangles. Bounding every buffer
    // vertex makes a seat collider as tall as the complete motorcycle.
    const index = object.geometry.index;
    transform.multiplyMatrices(inverse, object.matrixWorld);
    bounds.makeEmpty();
    for (let vertex = 0, count = index?.count ?? positions.count; vertex < count; vertex++)
      bounds.expandByPoint(point.fromBufferAttribute(positions, index ? index.getX(vertex) : vertex).applyMatrix4(transform));
    if (bounds.isEmpty()) return;
    if (isWheel) { wheel.union(bounds); return; }
    if (bounds.max.z < rearStart) return;
    for (let vertex = 0, count = index?.count ?? positions.count; vertex + 2 < count; vertex += 3) {
      const start = triangles.length;
      let maximumZ = -Infinity;
      for (let corner = 0; corner < 3; corner++) {
        point.fromBufferAttribute(positions, index ? index.getX(vertex + corner) : vertex + corner).applyMatrix4(transform);
        triangles.push(point.x, point.y, point.z); maximumZ = Math.max(maximumZ, point.z);
      }
      if (maximumZ < rearStart) triangles.length = start;
      else for (let corner = 0; corner < 3; corner++) surfaceBounds.expandByPoint(point.fromArray(triangles, start + corner * 3));
    }
  });
  const columns = 48, rows = 96;
  const top = new Float32Array((columns + 1) * (rows + 1)).fill(-Infinity);
  const bottom = new Float32Array(top.length).fill(Infinity);
  if (!surfaceBounds.isEmpty()) {
    surfaceBounds.min.z = Math.max(surfaceBounds.min.z, rearStart);
    surfaceBounds.expandByScalar(.012);
    const dx = (surfaceBounds.max.x - surfaceBounds.min.x) / columns;
    const dz = (surfaceBounds.max.z - surfaceBounds.min.z) / rows;
    for (let i = 0; i < triangles.length; i += 9) {
      const ax = triangles[i], ay = triangles[i + 1], az = triangles[i + 2];
      const bx = triangles[i + 3], by = triangles[i + 4], bz = triangles[i + 5];
      const cx = triangles[i + 6], cy = triangles[i + 7], cz = triangles[i + 8];
      const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(denominator) < 1e-10) continue;
      const x0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - surfaceBounds.min.x) / dx));
      const x1 = Math.min(columns, Math.ceil((Math.max(ax, bx, cx) - surfaceBounds.min.x) / dx));
      const z0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - surfaceBounds.min.z) / dz));
      const z1 = Math.min(rows, Math.ceil((Math.max(az, bz, cz) - surfaceBounds.min.z) / dz));
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const px = surfaceBounds.min.x + x * dx, pz = surfaceBounds.min.z + z * dz;
        const a = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / denominator;
        const b = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / denominator;
        const c = 1 - a - b;
        if (Math.min(a, b, c) < -1e-5) continue;
        const y = a * ay + b * by + c * cy, index = z * (columns + 1) + x;
        top[index] = Math.max(top[index], y); bottom[index] = Math.min(bottom[index], y);
      }
    }
  }
  const wheelGroup = body.getObjectByName('rear-wheel');
  const wheelSize = wheel.getSize(new THREE.Vector3()), wheelOffset = wheel.getCenter(new THREE.Vector3());
  const wheelCenter = new THREE.Vector3();
  if (wheelGroup && !wheel.isEmpty()) {
    wheelGroup.getWorldPosition(wheelCenter).applyMatrix4(inverse);
    wheelOffset.sub(wheelCenter);
  }
  const refresh = () => {
    if (!wheelGroup || wheel.isEmpty()) return;
    inverse.copy(body.matrixWorld).invert();
    wheelGroup.updateWorldMatrix(true, false);
    wheelGroup.getWorldPosition(wheelCenter).applyMatrix4(inverse).add(wheelOffset);
    wheel.min.copy(wheelCenter).addScaledVector(wheelSize, -.5);
    wheel.max.copy(wheelCenter).addScaledVector(wheelSize, .5);
  };
  const project = (point: THREE.Vector3) => {
    let contact = false;
    if (!surfaceBounds.isEmpty() && point.x >= surfaceBounds.min.x && point.x < surfaceBounds.max.x
      && point.z >= surfaceBounds.min.z && point.z < surfaceBounds.max.z) {
      const x = (point.x - surfaceBounds.min.x) / (surfaceBounds.max.x - surfaceBounds.min.x) * columns;
      const z = (point.z - surfaceBounds.min.z) / (surfaceBounds.max.z - surfaceBounds.min.z) * rows;
      const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
      let height = 0, weight = 0, lower = Infinity;
      for (let nz = 0; nz < 2; nz++) for (let nx = 0; nx < 2; nx++) {
        const i = (iz + nz) * (columns + 1) + ix + nx;
        if (!Number.isFinite(top[i])) continue;
        const w = (nx ? fx : 1 - fx) * (nz ? fz : 1 - fz);
        height += top[i] * w; weight += w; lower = Math.min(lower, bottom[i]);
      }
      if (weight > .05 && point.y > lower - .04 && point.y < height / weight + .014) {
        point.y = height / weight + .014; contact = true;
      }
    }
    if (!wheel.isEmpty() && point.x > wheel.min.x - .012 && point.x < wheel.max.x + .012) {
      const cy = (wheel.min.y + wheel.max.y) / 2, cz = (wheel.min.z + wheel.max.z) / 2;
      const ry = (wheel.max.y - wheel.min.y) / 2 + .012, rz = (wheel.max.z - wheel.min.z) / 2 + .012;
      const dy = point.y - cy, dz = point.z - cz, radial = Math.hypot(dy / ry, dz / rz);
      if (radial < 1) {
        if (radial > 1e-7) { point.y = cy + dy / radial; point.z = cz + dz / radial; }
        else point.y = cy + ry;
        contact = true;
      }
    }
    return contact;
  };
  return { body, project, refresh };
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
export function createFlagCapeMotion(mesh: THREE.Mesh<THREE.BufferGeometry>, fitTie?: () => void) {
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
  const point = new THREE.Vector3(), sample = new THREE.Vector3(), correction = new THREE.Vector3();
  let seeded = false;
  let phase = 0, remainder = 0, hasWorld = false, hasBag = false, lastLanding = 0;
  let lateralAcceleration = 0;
  let hardwareFitted = false;
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
  const projectFace = (first: number, second: number, third: number) => {
    if (!clearance) return;
    sample.set((points[first * 3] + points[second * 3] + points[third * 3]) / 3,
      (points[first * 3 + 1] + points[second * 3 + 1] + points[third * 3 + 1]) / 3,
      (points[first * 3 + 2] + points[second * 3 + 2] + points[third * 3 + 2]) / 3);
    point.copy(sample).applyMatrix4(torsoToBike);
    if (!clearance.project(point)) return;
    correction.copy(point).applyMatrix4(bikeToTorso).sub(sample);
    const free = Number(!cloth.pinned[first]) + Number(!cloth.pinned[second]) + Number(!cloth.pinned[third]);
    if (!free) return;
    correction.multiplyScalar(3 / free);
    for (let corner = 0; corner < 3; corner++) {
      const index = corner === 0 ? first : corner === 1 ? second : third;
      if (cloth.pinned[index]) continue;
      points[index * 3] += correction.x; points[index * 3 + 1] += correction.y; points[index * 3 + 2] += correction.z;
    }
  };
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
      if (clearance.project(point)) {
        point.applyMatrix4(bikeToTorso);
        x = point.x; y = point.y; z = point.z;
      }
    }
    points[i] = x; points[i + 1] = y; points[i + 2] = z;
    // A coarse cloth triangle can straddle narrow rear plastics even though
    // all three vertices are clear. Its two cell centres use the same cheap
    // cached surface query; translating their free corners preserves the cloth.
    if (clearance && seeded && vertex > columns && vertex % (columns + 1) > 0) {
      const a = vertex - columns - 2, b = a + 1, c = vertex - 1;
      projectFace(a, c, b); projectFace(b, c, vertex);
    }
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
        // A rapid lane move is exaggerated game motion. Carry most of that
        // sideways translation with the rider instead of whipping the cloth
        // through the whole lane. Preserve rotation, jumps and forward inertia.
        const sideways = (lastWorld.elements[12] - world.elements[12]) * SIDE_FOLLOW;
        rebase.elements[12] -= inverse.elements[0] * sideways;
        rebase.elements[13] -= inverse.elements[1] * sideways;
        rebase.elements[14] -= inverse.elements[2] * sideways;
        for (let vertex = 0; vertex < points.length / 3; vertex++) {
          if (cloth.pinned[vertex]) continue;
          const i = vertex * 3;
          point.fromArray(points, i).applyMatrix4(rebase).toArray(points, i);
          point.fromArray(cloth.previous, i).applyMatrix4(rebase).toArray(cloth.previous, i);
        }
      }
      lastWorld.copy(world); hasWorld = true;
      if (clearance) {
        clearance.refresh();
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
    seeded = false;
    for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
      const u = column / columns, t = row / rows, spread = smooth(t / .30);
      const anchor = collarPoint(u), side = 2 * u - 1;
      const i = (row * (columns + 1) + column) * 3;
      points[i] = anchor.x * (1 - spread) + side * width / 2 * spread;
      points[i + 1] = anchor.y - length * t;
      points[i + 2] = anchor.z * (1 - spread) + (.165 + t * .08) * spread;
      if (!cloth.pinned[row * (columns + 1) + column]) {
        collide(row * (columns + 1) + column);
      }
    }
    seeded = true; cloth.reset();
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
    const wind = windPressure(speed);
    for (let step = 0; step < 90; step++) cloth.step(force.x, force.y, force.z, back.x * wind, back.y * wind, back.z * wind, 0, 0, .82, collide);
    cloth.previous.set(points);
  };
  const reset = () => {
    phase = remainder = lastLanding = lateralAcceleration = 0; hasWorld = false; reducedKey = ''; wasReduced = false;
    if (!frame(false)) return;
    seed(); settle(0); publish();
  };
  const update = (input: CarriedCapMotionInput, dt: number) => {
    if (input.paused || !Number.isFinite(dt) || dt <= 0) return;
    const reduced = input.reducedMotion === true, speed = clamp(input.speed, 0, 60);
    if (!frame(!reduced)) return;
    // Imported rider counter-scaling/initial IK finish after assembly. Fit the
    // rigid tie once in that final pose, never by raycasting during the ride.
    const needsHardwareFit = !hardwareFitted || scaleChanged;
    // Imported bikes finish applying their inverse rider scale after assembly.
    // That construction transform is not a physical movement or an impulse.
    if (scaleChanged) { if (!reduced) { seed(); settle(0); } reducedKey = ''; lateralAcceleration = 0; }
    if (reduced) {
      const key = [down.x, down.y, down.z, speed, hasBag ? 1 : 0, ...torsoToBike.elements].map(value => Math.round(value * 10000)).join(',');
      if (!wasReduced || key !== reducedKey) { seed(); settle(speed); publish(); reducedKey = key; }
      wasReduced = true; remainder = lateralAcceleration = 0; lastLanding = clamp(input.landing, 0, 1);
      if (needsHardwareFit) { fitTie?.(); hardwareFitted = true; }
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
    const wind = windPressure(speed);
    const lateralTarget = clamp(input.lateralAcceleration, -20, 20);
    const forwardForce = clamp(input.longitudinalAcceleration, -20, 20) * .6;
    // Visual cloth never catches up a long browser stall: at most two small
    // simulation steps per rendered frame, with fixed buffers and no new mesh.
    remainder += Math.min(dt, 1 / 30);
    while (remainder + 1e-10 >= 1 / 60) {
      remainder = Math.max(0, remainder - 1 / 60); phase += 1 / 60;
      // Filter inside the fixed cloth step, so render rate cannot change how
      // an acceleration spike or its release feeds the fabric.
      lateralAcceleration += (lateralTarget - lateralAcceleration) * SIDE_RESPONSE;
      point.set(-lateralAcceleration * SIDE_FORCE, 0, forwardForce);
      const acceleration = point.length();
      point.transformDirection(inverse);
      force.copy(down).multiplyScalar(9.81).addScaledVector(point, acceleration);
      cloth.step(force.x, force.y, force.z, back.x * wind, back.y * wind, back.z * wind, phase, speed / 60 * 2, MOTION_DAMPING, collide);
    }
    publish();
    if (needsHardwareFit) { fitTie?.(); hardwareFitted = true; }
  };
  reset();
  return { update, reset };
}


/** Physical eyelets and the tied cloth corners, outside the unchanged printed artwork. */
function addTiedEyelets(mesh: THREE.Mesh, torso: THREE.Group) {
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
  // The closed tie belongs around the collar base, not around the shoulders.
  // Short rear connections join that neck tie to the flag's original eyelets.
  const garment = torso.getObjectByName('tailored-garment');
  const sourceSurfaces: THREE.Mesh[] = [];
  for (const object of [garment, torso.getObjectByName('stand-collar'), torso.getObjectByName('folded-hood')])
    if (object instanceof THREE.Mesh) sourceSurfaces.push(object);
  const surfaces: THREE.Mesh[] = [];
  const rearSurfaces: THREE.Mesh[] = [];
  const shoulders = (torso.parent?.getObjectsByProperty('name', 'garment-sleeve') ?? [])
    .filter((object): object is THREE.SkinnedMesh => object instanceof THREE.SkinnedMesh);
  const ray = new THREE.Raycaster(), origin = new THREE.Vector3(), direction = new THREE.Vector3();
  const center = new THREE.Vector3();
  const onNeck = (angle: number) => {
    const y = .59;
    const outward = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    const point = outward.clone().multiplyScalar(.3); point.y = y;
    if (surfaces.length) {
      origin.copy(point); torso.localToWorld(origin);
      center.set(0, y, 0); torso.localToWorld(center);
      direction.subVectors(center, origin).normalize(); ray.set(origin, direction);
      const hit = ray.intersectObjects(surfaces, false)[0];
      if (hit) {
        return point.copy(torso.worldToLocal(hit.point)).addScaledVector(outward, .009);
      }
    }
    // Small isolated test/preview torsos may have no garment mesh.
    point.set(outward.x * .086, y, outward.z * .063);
    return point.addScaledVector(outward, .009);
  };
  const clearRear = (point: THREE.Vector3) => {
    origin.set(point.x, point.y, .55); torso.localToWorld(origin);
    direction.set(0, 0, -1).transformDirection(torso.matrixWorld); ray.set(origin, direction);
    const hit = ray.intersectObjects(rearSurfaces, false)[0];
    if (hit) point.z = Math.max(point.z, torso.worldToLocal(hit.point).z + .007);
    return point;
  };
  const path = (points: THREE.Vector3[]) => {
    const curve = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 1; i < points.length; i++) curve.add(new THREE.LineCurve3(points[i - 1], points[i]));
    return curve;
  };
  const tie = (name: string, points: THREE.Vector3[]) => {
    const cord = new THREE.Mesh(new THREE.TubeGeometry(path(points), Math.max(6, points.length * 2), .0025, 5, false), fabric);
    cord.name = name; hardware.add(cord); return cord;
  };
  const connecting = tie('flag-eyelet-connecting-tie', [left, right]);
  const necklace = tie('flag-neck-tie', [left, right]);
  const loop = tie('flag-tie-loop', [left, right]);
  const tail = tie('flag-tie-tail', [left, right]);
  const knotMesh = new THREE.Mesh(new THREE.SphereGeometry(.006, 8, 6), fabric);
  knotMesh.name = 'flag-cape-knot'; knotMesh.scale.set(1.3, .8, 1);
  hardware.add(knotMesh); mesh.add(hardware);
  const replace = (cord: THREE.Mesh, points: THREE.Vector3[]) => {
    cord.geometry.dispose(); cord.geometry = new THREE.TubeGeometry(path(points), Math.max(6, points.length * 2), .0025, 5, false);
  };
  const fit = () => {
    torso.parent?.updateMatrixWorld(true); torso.updateWorldMatrix(true, true);
    // Reuse actual rigid collar/hood triangles for the bounded assembly fit.
    // The cloth is included only after its first real pose exists.
    const inverseTorso = new THREE.Matrix4().copy(torso.matrixWorld).invert();
    const transform = new THREE.Matrix4(), vertex = new THREE.Vector3();
    const candidates = mesh.parent === torso ? [...sourceSurfaces, mesh, ...shoulders] : [...sourceSurfaces, ...shoulders];
    for (const source of candidates) {
      if (source instanceof THREE.SkinnedMesh) { source.updateMatrixWorld(true); source.skeleton.update(); }
      transform.multiplyMatrices(inverseTorso, source.matrixWorld);
      const position = source.geometry.getAttribute('position');
      const geometry = new THREE.BufferGeometry();
      const points = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) source.getVertexPosition(i, vertex).applyMatrix4(transform).toArray(points, i * 3);
      geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
      geometry.setIndex(source.geometry.index); geometry.computeBoundingSphere();
      const collider = new THREE.Mesh(geometry, source.material);
      collider.matrixAutoUpdate = false; collider.matrix.copy(torso.matrixWorld); collider.updateMatrixWorld(true);
      if (sourceSurfaces.includes(source)) surfaces.push(collider);
      rearSurfaces.push(collider);
    }
    let neckTie: THREE.Vector3[] = [];
    for (let sample = 0; sample <= 64; sample++) neckTie.push(onNeck(Math.PI * 2 * sample / 64));
    // The hood/neck union has a sharp silhouette at its sides. Split only
    // chords which enter that silhouette, keeping the closed line outside it.
    for (let pass = 0; pass < 3; pass++) {
      const fitted: THREE.Vector3[] = [neckTie[0]];
      for (let i = 1; i < neckTie.length; i++) {
        const middle = neckTie[i - 1].clone().add(neckTie[i]).multiplyScalar(.5);
        const shell = onNeck(Math.atan2(middle.x, middle.z));
        if (Math.hypot(middle.x, middle.z) < Math.hypot(shell.x, shell.z) - .001) fitted.push(shell);
        fitted.push(neckTie[i]);
      }
      neckTie = fitted;
    }
    const knot = neckTie[0]; knotMesh.position.copy(knot); replace(necklace, neckTie);
    const connection = (eye: THREE.Vector3) => {
      const points: THREE.Vector3[] = [];
      for (let sample = 0; sample <= 8; sample++) points.push(clearRear(eye.clone().lerp(knot, sample / 8)));
      return points;
    };
    replace(connecting, [...connection(left), ...connection(right).reverse().slice(1)]);
    replace(loop, [knot, clearRear(knot.clone().add(new THREE.Vector3(.02, .009, .008))),
      clearRear(knot.clone().add(new THREE.Vector3(.019, -.009, .009))), knot]);
    replace(tail, [knot, clearRear(knot.clone().add(new THREE.Vector3(-.003, -.024, .009))),
      clearRear(knot.clone().add(new THREE.Vector3(.009, -.04, .012)))]);
    for (const surface of rearSurfaces) surface.geometry.dispose();
    surfaces.length = rearSurfaces.length = 0;
  };
  fit(); return fit;
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
  // An open, double-sided sheet has no dependable backface-shell silhouette.
  // Ink its four material edges in the existing pass. Raw cloth UVs follow
  // every fold and stay independent of the photograph's cropped map transform.
  const outlineWidth = { value: 1.15 };
  material.onBeforeCompile = shader => {
    shader.uniforms.flagCapeOutlineWidth = outlineWidth;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFlagCapeUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlagCapeUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFlagCapeUv;\nuniform float flagCapeOutlineWidth;')
      .replace('#include <colorspace_fragment>', `#include <colorspace_fragment>
        vec2 flagCapeEdge = min(vFlagCapeUv, 1.0 - vFlagCapeUv);
        vec2 flagCapePixels = flagCapeEdge / max(fwidth(vFlagCapeUv), vec2(0.000001));
        float flagCapeInk = 1.0 - smoothstep(flagCapeOutlineWidth - 0.5, flagCapeOutlineWidth + 0.5,
          min(flagCapePixels.x, flagCapePixels.y));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.008, 0.010, 0.014), flagCapeInk);
      `);
  };
  material.customProgramCacheKey = () => 'pfusch-flag-cape-outline-v1';
  // Derivatives use physical pixels; match the hero outline's CSS-pixel width
  // on high-DPI phones without changing cloth buffers or adding another draw.
  mesh.onBeforeRender = renderer => { outlineWidth.value = 1.15 * renderer.getPixelRatio(); };
  mesh.name = 'pfusch-flag-cape'; mesh.userData.productId = product.id;
  mesh.castShadow = false; mesh.receiveShadow = false;
  const fitTie = addTiedEyelets(mesh, torso);
  torso.add(mesh);
  return { mesh, ...createFlagCapeMotion(mesh, fitTie) };
}
