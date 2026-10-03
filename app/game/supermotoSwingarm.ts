import * as THREE from 'three';
import { CHAIN_DRIVE } from './driveGeometry';
import { SUPERMOTO_CHASSIS } from './supermotoFit';

/** Authored in body coordinates. Pivot and axle are the existing suspension
 * anchors; section dimensions do not alter the wheelbase or rolling radius. */
export const SUPERMOTO_SWINGARM = Object.freeze({
  pivotY: 0.5,
  pivotZ: 0.1,
  axleY: SUPERMOTO_CHASSIS.rearRadius,
  axleZ: SUPERMOTO_CHASSIS.rearAxle,
  frontZ: 0.061,
  endZ: SUPERMOTO_CHASSIS.rearAxle + 0.036,
  pivotHalfWidth: 0.025,
  axleHalfWidth: 0.0185,
  pivotHalfHeight: 0.056,
  axleHalfHeight: 0.031,
  chamfer: 0.0035,
  pivotBoreRadius: 0.0337,
  axleSlotRadius: 0.0127,
  axleSlotHalfTravel: 0.009,
  forwardBridgeY: 0.46,
  forwardBridgeZ: 0.22,
});

type Point = THREE.Vector2;
const dimensions = SUPERMOTO_SWINGARM;
const fraction = (z: number) =>
  (z - dimensions.pivotZ) / (dimensions.axleZ - dimensions.pivotZ);
const widthAt = (z: number) =>
  THREE.MathUtils.lerp(
    dimensions.pivotHalfWidth,
    dimensions.axleHalfWidth,
    fraction(z),
  );
const centerAt = (z: number) =>
  THREE.MathUtils.lerp(dimensions.pivotY, dimensions.axleY, fraction(z));
/** The forged pivot shoulder widens into the box section, then the upper
 * ridge and lower load path converge toward the machined axle carrier.
 * Offsets are presentation datums; both bearing axes remain unchanged. */
function outline(): Point[] {
  const start = dimensions.frontZ;
  const end = dimensions.endZ;
  const profile: [number, number][] = [
    [start, 0.035], [0.080, 0.055], [0.130, 0.062],
    [0.230, 0.058], [0.380, 0.048], [0.530, 0.039],
    [0.650, 0.025], [0.690, 0.020], [0.710, 0.026],
    [end - 0.010, 0.028], [end, 0.018],
    [end, -0.018], [end - 0.010, -0.030], [0.708, -0.033],
    [0.670, -0.029], [0.530, -0.040], [0.380, -0.052],
    [0.230, -0.061], [0.130, -0.055], [0.080, -0.046],
    [start, -0.028],
  ];
  return profile.map(([z, offset]) => new THREE.Vector2(z, centerAt(z) + offset));
}

/** Shallow pressed channel in each outside face, not a painted stripe. */
function sideChannel(): Point[] {
  return [
    [0.177, 0.016], [0.208, 0.027], [0.370, 0.020],
    [0.548, 0.011], [0.649, -0.001], [0.623, -0.013],
    [0.380, -0.025], [0.205, -0.030], [0.177, -0.019],
  ].map(([z, offset]) => new THREE.Vector2(z, centerAt(z) + offset));
}

const cross2 = (a: Point, b: Point) => a.x * b.y - a.y * b.x;

/** Intersect inward-offset edge lines, retaining the exact planar facets. */
function inset(contour: readonly Point[], amount: number) {
  return contour.map((point, index) => {
    const previous = contour[(index + contour.length - 1) % contour.length];
    const next = contour[(index + 1) % contour.length];
    const before = point.clone().sub(previous).normalize();
    const after = next.clone().sub(point).normalize();
    const a = point
      .clone()
      .add(new THREE.Vector2(before.y, -before.x).multiplyScalar(amount));
    const b = point
      .clone()
      .add(new THREE.Vector2(after.y, -after.x).multiplyScalar(amount));
    const along = cross2(b.clone().sub(a), after) / cross2(before, after);
    return a.addScaledVector(before, along);
  });
}

function pivotHole() {
  return Array.from({ length: 40 }, (_, index) => {
    const angle = (index / 40) * Math.PI * 2;
    return new THREE.Vector2(
      dimensions.pivotZ + Math.cos(angle) * dimensions.pivotBoreRadius,
      dimensions.pivotY + Math.sin(angle) * dimensions.pivotBoreRadius,
    );
  });
}

function axleSlot() {
  const points: Point[] = [];
  for (const end of [1, -1])
    for (let index = 0; index <= 16; index++) {
      const angle =
        -Math.PI / 2 + (index / 16) * Math.PI + (end < 0 ? Math.PI : 0);
      points.push(
        new THREE.Vector2(
          dimensions.axleZ +
            end * dimensions.axleSlotHalfTravel +
            Math.cos(angle) * dimensions.axleSlotRadius,
          dimensions.axleY + Math.sin(angle) * dimensions.axleSlotRadius,
        ),
      );
    }
  return points;
}

/** One closed, faceted box spar with real pivot bore and axle adjustment slot.
 * Faces own their edge vertices so computeVertexNormals cannot round the
 * broad side panels or erase the small perimeter chamfer. Both arms use the
 * same section; mirroring changes their X centre only. No post-build scale. */
export function supermotoSwingarmGeometry(side: number) {
  if (side !== -1 && side !== 1)
    throw new RangeError('Swingarm side must be -1 or 1');
  const centerX =
    side < 0 ? CHAIN_DRIVE.leftSwingarmX : CHAIN_DRIVE.rightSwingarmX;
  const contour = outline();
  const faceContour = inset(contour, dimensions.chamfer);
  const holes = [pivotHole(), axleSlot()];
  const channel = sideChannel();
  const positions: number[] = [];
  const indices: number[] = [];
  const vertex = (point: Point, face: number, edge = false) =>
    new THREE.Vector3(
      centerX + face * (widthAt(point.x) - (edge ? dimensions.chamfer : 0)),
      point.y,
      point.x,
    );
  const triangle = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    outward: THREE.Vector3,
  ) => {
    const normal = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a));
    const base = positions.length / 3;
    positions.push(...a.toArray(), ...b.toArray(), ...c.toArray());
    if (normal.dot(outward) >= 0) indices.push(base, base + 1, base + 2);
    else indices.push(base, base + 2, base + 1);
  };
  const quad = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    outward: THREE.Vector3,
  ) => {
    triangle(a, b, c, outward);
    triangle(a, c, d, outward);
  };

  // Triangulation uses the true holes, never a black decal placed over metal.
  for (const face of [-1, 1]) {
    const faceHoles = face === side ? [...holes, channel] : holes;
    const facePoints = [...faceContour, ...faceHoles.flat()];
    const faces = THREE.ShapeUtils.triangulateShape(faceContour, faceHoles);
    const outward = new THREE.Vector3(face, 0, 0);
    for (const [a, b, c] of faces)
      triangle(
        vertex(facePoints[a], face),
        vertex(facePoints[b], face),
        vertex(facePoints[c], face),
        outward,
      );
  }
  const channelDepth = 0.003;
  const floorVertex = (point: Point) => vertex(point, side)
    .add(new THREE.Vector3(-side * channelDepth, 0, 0));
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(channel, []))
    triangle(floorVertex(channel[a]), floorVertex(channel[b]), floorVertex(channel[c]),
      new THREE.Vector3(side, 0, 0));
  for (let i = 0; i < channel.length; i++) {
    const next = (i + 1) % channel.length;
    const delta = channel[next].clone().sub(channel[i]);
    quad(vertex(channel[i], side), vertex(channel[next], side), floorVertex(channel[next]), floorVertex(channel[i]),
      new THREE.Vector3(0, -delta.x, delta.y));
  }
  for (let index = 0; index < contour.length; index++) {
    const next = (index + 1) % contour.length;
    const delta = contour[next].clone().sub(contour[index]);
    const outward = new THREE.Vector3(0, delta.x, -delta.y).normalize();
    quad(
      vertex(contour[index], -1, true),
      vertex(contour[next], -1, true),
      vertex(contour[next], 1, true),
      vertex(contour[index], 1, true),
      outward,
    );
    for (const face of [-1, 1]) {
      const bevelNormal = outward.clone().add(new THREE.Vector3(face, 0, 0));
      quad(
        vertex(faceContour[index], face),
        vertex(faceContour[next], face),
        vertex(contour[next], face, true),
        vertex(contour[index], face, true),
        bevelNormal,
      );
    }
  }
  for (const [holeIndex, hole] of holes.entries()) {
    const centerZ = holeIndex === 0 ? dimensions.pivotZ : dimensions.axleZ;
    const centerY = holeIndex === 0 ? dimensions.pivotY : dimensions.axleY;
    for (let index = 0; index < hole.length; index++) {
      const next = (index + 1) % hole.length;
      const middle = hole[index].clone().add(hole[next]).multiplyScalar(0.5);
      const inward = new THREE.Vector3(
        0,
        centerY - middle.y,
        centerZ - middle.x,
      );
      quad(
        vertex(hole[index], -1),
        vertex(hole[next], -1),
        vertex(hole[next], 1),
        vertex(hole[index], 1),
        inward,
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
