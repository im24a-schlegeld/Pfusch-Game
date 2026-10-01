import * as THREE from 'three';
import { SUPERMOTO_SHOCK_BOTTOM } from './supermotoFit';
import { SUPERMOTO_SWINGARM } from './supermotoSwingarm';

type Point = readonly [number, number, number];
const bridgeZ = 0.315;
export const SUPERMOTO_LINKAGE = Object.freeze({
  frame: [0, 0.360, 0.190] as Point,
  pivot: [0, 0.377, 0.345] as Point,
  dogbone: [0, 0.302, 0.360] as Point,
  shock: SUPERMOTO_SHOCK_BOTTOM as Point,
  bridge: [0, THREE.MathUtils.lerp(SUPERMOTO_SWINGARM.pivotY, SUPERMOTO_SWINGARM.axleY,
    (bridgeZ - SUPERMOTO_SWINGARM.pivotZ) / (SUPERMOTO_SWINGARM.axleZ - SUPERMOTO_SWINGARM.pivotZ)), bridgeZ] as Point,
});
const v = (point: Point) => new THREE.Vector3(...point);
const frame = v(SUPERMOTO_LINKAGE.frame), pivot = v(SUPERMOTO_LINKAGE.pivot);
const dogbone = v(SUPERMOTO_LINKAGE.dogbone), shock = v(SUPERMOTO_LINKAGE.shock);
const rockerRadius = pivot.distanceTo(dogbone), dogboneLength = frame.distanceTo(dogbone);
const rockerRestAngle = Math.atan2(dogbone.z - pivot.z, dogbone.y - pivot.y);
const dogboneRestAngle = Math.atan2(dogbone.z - frame.z, dogbone.y - frame.y);
const shockY = shock.y - pivot.y, shockZ = shock.z - pivot.z;

export interface SupermotoLinkagePose {
  pivot: THREE.Vector3;
  dogbone: THREE.Vector3;
  shock: THREE.Vector3;
  rockerAngle: number;
  dogboneAngle: number;
}
export function createSupermotoLinkagePose(): SupermotoLinkagePose {
  return { pivot: new THREE.Vector3(), dogbone: new THREE.Vector3(), shock: new THREE.Vector3(), rockerAngle: 0, dogboneAngle: 0 };
}

/** Circle intersection closes the actual four-bar chain. Both dogbone and
 * triangular rocker remain rigid; only the shock changes axial length. */
export function solveSupermotoLinkage(rearMatrix: THREE.Matrix4, out = createSupermotoLinkagePose()) {
  out.pivot.copy(pivot).applyMatrix4(rearMatrix);
  const dy = frame.y - out.pivot.y, dz = frame.z - out.pivot.z;
  const distance = Math.hypot(dy, dz);
  const along = (rockerRadius ** 2 - dogboneLength ** 2 + distance ** 2) / (2 * distance);
  const square = rockerRadius ** 2 - along ** 2;
  if (distance < 1e-8 || square < -1e-10) throw new RangeError('Supermoto linkage cannot close at this swingarm angle');
  const height = Math.sqrt(Math.max(0, square));
  // The lower intersection is the assembly branch shown by the reference.
  out.dogbone.set(0, out.pivot.y + (dy * along + dz * height) / distance,
    out.pivot.z + (dz * along - dy * height) / distance);
  out.rockerAngle = Math.atan2(out.dogbone.z - out.pivot.z, out.dogbone.y - out.pivot.y) - rockerRestAngle;
  out.dogboneAngle = Math.atan2(out.dogbone.z - frame.z, out.dogbone.y - frame.y) - dogboneRestAngle;
  const cosine = Math.cos(out.rockerAngle), sine = Math.sin(out.rockerAngle);
  out.shock.set(0, out.pivot.y + shockY * cosine - shockZ * sine,
    out.pivot.z + shockY * sine + shockZ * cosine);
  return out;
}

function rockerGeometry(x: number) {
  const centers = [pivot, dogbone, shock].map(point => new THREE.Vector2(point.z, point.y));
  const outer: THREE.Vector2[] = [];
  centers.forEach((point, i) => {
    const before = point.clone().sub(centers[(i + 2) % 3]).normalize();
    const after = centers[(i + 1) % 3].clone().sub(point).normalize();
    const start = Math.atan2(-before.x, before.y);
    let end = Math.atan2(-after.x, after.y);
    while (end < start) end += Math.PI * 2;
    // Constant-radius ears avoid the long acute mitres of a triangle offset.
    for (let step = 0; step <= 8; step++) {
      const angle = THREE.MathUtils.lerp(start, end, step / 8);
      outer.push(point.clone().add(new THREE.Vector2(Math.cos(angle), Math.sin(angle)).multiplyScalar(0.0155)));
    }
  });
  const shape = new THREE.Shape();
  outer.forEach((point, i) => i ? shape.lineTo(-point.x, point.y) : shape.moveTo(-point.x, point.y));
  shape.closePath();
  for (const center of centers) {
    const hole = new THREE.Path();
    hole.absarc(-center.x, center.y, 0.0105, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.007, bevelEnabled: true,
    bevelThickness: 0.0007, bevelSize: 0.0012, bevelSegments: 1, steps: 1, curveSegments: 12 });
  geometry.rotateY(Math.PI / 2); geometry.translate(x - 0.0035, 0, 0);
  return geometry;
}

function dogboneGeometry(x: number) {
  const axis = dogbone.clone().sub(frame), length = axis.length();
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 0.014, Math.PI, Math.PI * 2, false);
  shape.lineTo(0.014, length);
  shape.absarc(0, length, 0.014, 0, Math.PI, false);
  shape.closePath();
  for (const y of [0, length]) {
    const hole = new THREE.Path(); hole.absarc(0, y, 0.009, 0, Math.PI * 2, true); shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.007, bevelEnabled: true,
    bevelThickness: 0.0007, bevelSize: 0.001, bevelSegments: 1, steps: 1, curveSegments: 12 });
  // Geometry lies in YZ, with its extrusion axis across the bike.
  geometry.rotateY(Math.PI / 2);
  geometry.rotateX(dogboneRestAngle);
  geometry.translate(x - 0.0035, frame.y, frame.z);
  return geometry;
}

/** Two machined rocker cheeks, paired dogbones, shared pins and real frame /
 * swingarm clevises. Added once; the animation only changes rigid matrices. */
export function addSupermotoLinkage(body: THREE.Group, alloy: THREE.Material, dark: THREE.Material) {
  const add = (geometry: THREE.BufferGeometry, name: string, finish = alloy) => {
    const part = new THREE.Mesh(geometry, finish); part.name = name;
    part.castShadow = part.receiveShadow = true; body.add(part); return part;
  };
  const rod = (a: Point, b: Point, radius: number, name: string, finish = alloy) => {
    const start = v(a), end = v(b), axis = end.clone().sub(start);
    const part = add(new THREE.CylinderGeometry(radius, radius, axis.length(), 16), name, finish);
    part.position.copy(start.add(end).multiplyScalar(0.5));
    part.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()); return part;
  };
  for (const side of [-1, 1]) {
    add(rockerGeometry(side * 0.028), 'supermoto-linkage-rocker');
    add(dogboneGeometry(side * 0.045), 'supermoto-linkage-dogbone');
    rod([side * 0.039, SUPERMOTO_LINKAGE.bridge[1], bridgeZ], [side * 0.039, pivot.y, pivot.z],
      0.012, 'shock-lower-link', dark);
    rod([side * 0.137, 0.390, 0.120], [side * 0.052, frame.y, frame.z],
      0.011, 'supermoto-linkage-frame-tab', dark);
  }
  for (const point of [pivot, dogbone, shock])
    rod([-0.055, point.y, point.z], [0.055, point.y, point.z], 0.010, 'supermoto-linkage-rocker-pin', dark);
  rod([-0.058, frame.y, frame.z], [0.058, frame.y, frame.z], 0.0085, 'supermoto-linkage-frame-pin', dark);
}

export function createSupermotoLinkage(body: THREE.Group) {
  const pose = createSupermotoLinkagePose();
  const retain = (names: string[]) => body.children.filter(part => names.includes(part.name)).map(part => {
    part.updateMatrix(); return { part, rest: part.matrix.clone() };
  });
  const rockerParts = retain(['supermoto-linkage-rocker', 'supermoto-linkage-rocker-pin']);
  const dogboneParts = retain(['supermoto-linkage-dogbone']);
  const rockerMatrix = new THREE.Matrix4(), dogboneMatrix = new THREE.Matrix4();
  const rotation = new THREE.Matrix4();
  const inversePivot = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
  const inverseFrame = new THREE.Matrix4().makeTranslation(-frame.x, -frame.y, -frame.z);
  return {
    pose,
    update(rearMatrix: THREE.Matrix4) {
      solveSupermotoLinkage(rearMatrix, pose);
      rockerMatrix.makeTranslation(pose.pivot.x, pose.pivot.y, pose.pivot.z)
        .multiply(rotation.makeRotationX(pose.rockerAngle)).multiply(inversePivot);
      dogboneMatrix.makeTranslation(frame.x, frame.y, frame.z)
        .multiply(rotation.makeRotationX(pose.dogboneAngle)).multiply(inverseFrame);
      for (const { part, rest } of rockerParts) {
        part.matrixAutoUpdate = false; part.matrix.multiplyMatrices(rockerMatrix, rest); part.matrixWorldNeedsUpdate = true;
      }
      for (const { part, rest } of dogboneParts) {
        part.matrixAutoUpdate = false; part.matrix.multiplyMatrices(dogboneMatrix, rest); part.matrixWorldNeedsUpdate = true;
      }
    },
  };
}
