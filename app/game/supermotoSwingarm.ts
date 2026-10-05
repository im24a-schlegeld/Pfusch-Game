import * as THREE from 'three';
import { CHAIN_DRIVE } from './driveGeometry';
import { SUPERMOTO_CHASSIS } from './supermotoFit';
import { SUPERMOTO_REAR_PIVOT } from './supermotoRideHeight';

/** Authored in body coordinates. The hinge seats inside the original frame
 * pickup; the rear wheel axis, wheelbase and rolling radius stay unchanged. */
export const SUPERMOTO_SWINGARM = Object.freeze({
  pivotY: SUPERMOTO_REAR_PIVOT[1],
  pivotZ: SUPERMOTO_REAR_PIVOT[2],
  axleY: SUPERMOTO_CHASSIS.rearRadius,
  axleZ: SUPERMOTO_CHASSIS.rearAxle,
  frontZ: 0.1585,
  endZ: SUPERMOTO_CHASSIS.rearAxle + 0.036,
  pivotHalfWidth: 0.025,
  axleHalfWidth: 0.0185,
  pivotHalfHeight: 0.056,
  axleHalfHeight: 0.031,
  chamfer: 0.0035,
  pivotBoreRadius: 0.0177,
  axleSlotRadius: 0.0127,
  axleSlotHalfTravel: 0.009,
  forwardBridgeY: THREE.MathUtils.lerp(SUPERMOTO_REAR_PIVOT[1], SUPERMOTO_CHASSIS.rearRadius,
    (0.240 - SUPERMOTO_REAR_PIVOT[2]) / (SUPERMOTO_CHASSIS.rearAxle - SUPERMOTO_REAR_PIVOT[2])) - 0.02925,
  forwardBridgeZ: 0.240,
  // The lower shock attachment is a fixed casting datum, independent of the
  // outline's centre. A deeper beam must not move the suspension mount.
  shockBridgeY: THREE.MathUtils.lerp(SUPERMOTO_REAR_PIVOT[1], SUPERMOTO_CHASSIS.rearRadius,
    (0.315 - SUPERMOTO_REAR_PIVOT[2]) / (SUPERMOTO_CHASSIS.rearAxle - SUPERMOTO_REAR_PIVOT[2])) - 0.0255625,
  shockBridgeZ: 0.315,
});

/** The rotating roots sit inside the fixed outer frame cheeks. Rear arm and
 * wheel spacing stay unchanged; only the front bearing neck tucks inward. */
export const SUPERMOTO_PIVOT_BEARING = Object.freeze({
  rootCenterX: 0.047,
  rootHalfWidth: 0.014,
  flareStartZ: 0.220,
  flareEndZ: 0.640,
  widthShoulderZ: 0.440,
  frameCheekX: 0.133,
  frameCheekHalfWidth: 0.0025,
  pinRadius: 0.0100,
  raceInnerRadius: 0.0104,
  raceOuterRadius: 0.0174,
  raceInnerX: 0.0335,
  raceOuterX: 0.0605,
  spacerOuterX: 0.1306,
});

type Point = THREE.Vector2;
const dimensions = SUPERMOTO_SWINGARM;
const fraction = (z: number) =>
  (z - dimensions.pivotZ) / (dimensions.axleZ - dimensions.pivotZ);
const originalWidthAt = (z: number) => THREE.MathUtils.lerp(
    dimensions.pivotHalfWidth,
    dimensions.axleHalfWidth,
    fraction(z),
  );
const rootBlend = (z: number) => THREE.MathUtils.smoothstep(
  z, SUPERMOTO_PIVOT_BEARING.flareStartZ, SUPERMOTO_PIVOT_BEARING.flareEndZ);
// Fine casting stations give the long lateral sweep continuous-looking
// tangents; both endpoints become parallel without the former hard dogleg.
const flareStations = Array.from({ length: 13 }, (_, i) => THREE.MathUtils.lerp(
  SUPERMOTO_PIVOT_BEARING.flareStartZ, SUPERMOTO_PIVOT_BEARING.flareEndZ, i / 12));
const widthAt = (z: number) => z >= SUPERMOTO_PIVOT_BEARING.widthShoulderZ ? originalWidthAt(z)
  : THREE.MathUtils.lerp(SUPERMOTO_PIVOT_BEARING.rootHalfWidth,
    originalWidthAt(SUPERMOTO_PIVOT_BEARING.widthShoulderZ), THREE.MathUtils.clamp(
      (z - SUPERMOTO_PIVOT_BEARING.flareStartZ)
        / (SUPERMOTO_PIVOT_BEARING.widthShoulderZ - SUPERMOTO_PIVOT_BEARING.flareStartZ), 0, 1));
const lateralCenterAt = (z: number) => THREE.MathUtils.lerp(
  SUPERMOTO_PIVOT_BEARING.rootCenterX, CHAIN_DRIVE.rightSwingarmX, rootBlend(z));
const centerAt = (z: number) =>
  THREE.MathUtils.lerp(dimensions.pivotY, dimensions.axleY, fraction(z));

/** Crossmembers end in the actual forged beam, including its lateral inset. */
export function supermotoSwingarmSection(z: number) {
  const contour = outline(), heights: number[] = [];
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i], b = contour[(i + 1) % contour.length];
    if (z >= Math.min(a.x, b.x) && z <= Math.max(a.x, b.x) && Math.abs(b.x - a.x) > 1e-9)
      heights.push(THREE.MathUtils.lerp(a.y, b.y, (z - a.x) / (b.x - a.x)));
  }
  return { centerX: lateralCenterAt(z), halfWidth: widthAt(z),
    centerY: heights.length ? (Math.max(...heights) + Math.min(...heights)) / 2 : centerAt(z) };
}
/** The forged pivot shoulder widens into the box section, then the upper
 * ridge and lower load path converge toward the machined axle carrier.
 * The bearing and animation use one shared hinge; the wheel axle stays put. */
function outline(): Point[] {
  const start = dimensions.frontZ;
  const end = dimensions.endZ;
  const profile: [number, number][] = [
    [start, dimensions.pivotY - centerAt(start) + 0.002], [0.165, 0.034], [0.183, 0.043], [0.201, 0.043],
    [0.220, 0.032], [0.260, 0.028], [0.300, 0.025], [0.360, 0.020], [0.400, 0.035], [0.530, 0.039],
    [0.650, 0.025], [0.690, 0.020], [0.710, 0.026],
    [end - 0.010, 0.033], [end, dimensions.axleY - centerAt(end) + 0.025],
    [end, dimensions.axleY - centerAt(end) + dimensions.axleSlotRadius],
    ...Array.from({ length: 21 }, (_, i): [number, number] => {
      const angle = Math.PI / 2 + i / 20 * Math.PI;
      const z = dimensions.axleZ - dimensions.axleSlotHalfTravel + Math.cos(angle) * dimensions.axleSlotRadius;
      return [z, dimensions.axleY + Math.sin(angle) * dimensions.axleSlotRadius - centerAt(z)];
    }),
    [end, dimensions.axleY - centerAt(end) - dimensions.axleSlotRadius],
    [end, dimensions.axleY - centerAt(end) - 0.030], [end - 0.010, -0.035], [0.708, -0.033],
    [0.670, -0.029], [0.530, -0.040], [0.400, -0.051], [0.360, -0.073],
    [0.300, -0.076], [0.260, -0.0725], [0.220, -0.064],
    [0.201, -0.050], [0.183, -0.041], [0.165, -0.033], [start, dimensions.pivotY - centerAt(start) - 0.002],
  ];
  return profile.map(([z, offset]) => new THREE.Vector2(z, centerAt(z) + offset));
}

/** Deep inner casting pockets leave continuous top/bottom flanges and one
 * solid diagonal web. They remove mass without making the outer arms wider. */
function innerChannels(): Point[][] {
  return [
    [[0.399, 0.013], [0.430, 0.022], [0.521, 0.024],
      [0.533, -0.025], [0.431, -0.032], [0.399, -0.034]],
    [[0.551, 0.021], [0.630, 0.014], [0.683, 0.006],
      [0.680, -0.017], [0.628, -0.019], [0.542, -0.026]],
  ].map(channel => channel.map(([z, offset]) => new THREE.Vector2(z, centerAt(z) + offset)));
}

/** Shallow pressed channel in each outside face, not a painted stripe. */
function sideChannel(): Point[] {
  return [
    [0.412, 0.012], [0.452, 0.020],
    [0.548, 0.011], [0.649, -0.001], [0.623, -0.013],
    [0.450, -0.025], [0.412, -0.021],
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

/** One closed, faceted casting with a pivot bore and rear-opening axle fork.
 * Faces own their edge vertices so computeVertexNormals cannot round the
 * broad side panels or erase the small perimeter chamfer. Both arms use the
 * same section; mirroring changes their X centre only. No post-build scale. */
export function supermotoSwingarmGeometry(side: number) {
  if (side !== -1 && side !== 1)
    throw new RangeError('Swingarm side must be -1 or 1');
  const contour = outline();
  const faceContour = inset(contour, dimensions.chamfer);
  const holes = [pivotHole()];
  const outsideChannel = sideChannel();
  const insideChannels = innerChannels();
  const positions: number[] = [];
  const indices: number[] = [];
  const vertex = (point: Point, face: number, edge = false) =>
    new THREE.Vector3(
      face * (originalWidthAt(point.x) - (edge ? dimensions.chamfer : 0)),
      point.y,
      point.x,
    );
  const emitTriangle = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    outward: THREE.Vector3,
  ) => {
    const normal = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a));
    // Clipping can return a collinear fan at a shared cut vertex. Do not turn
    // that zero-area fan into a float32 sliver with an arbitrary normal.
    if (normal.lengthSq() < 1e-24) return;
    const base = positions.length / 3;
    positions.push(...a.toArray(), ...b.toArray(), ...c.toArray());
    if (normal.dot(outward) >= 0) indices.push(base, base + 1, base + 2);
    else indices.push(base, base + 2, base + 1);
  };
  const warp = (point: THREE.Vector3) => {
    const inner = lateralCenterAt(point.z) - widthAt(point.z);
    const outer = lateralCenterAt(point.z) + widthAt(point.z);
    const across = (point.x * side / originalWidthAt(point.z) + 1) / 2;
    return new THREE.Vector3(side * THREE.MathUtils.lerp(inner, outer, across), point.y, point.z);
  };
  // Split every surface at the neck/flare datums before deforming. Otherwise
  // a long side-face triangle would bridge across the constant-width root.
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, outward: THREE.Vector3) => {
    let polygons = [[a, b, c]];
    for (const cut of [...flareStations, SUPERMOTO_PIVOT_BEARING.widthShoulderZ].sort((a, b) => a - b)) {
      const clipped: THREE.Vector3[][] = [];
      for (const polygon of polygons) {
        if (polygon.every(p => p.z <= cut) || polygon.every(p => p.z >= cut)) { clipped.push(polygon); continue; }
        for (const direction of [-1, 1]) {
          const section: THREE.Vector3[] = [];
          polygon.forEach((p, i) => {
            const q = polygon[(i + 1) % polygon.length];
            if ((p.z - cut) * direction >= 0) section.push(p);
            if ((p.z - cut) * (q.z - cut) < 0) section.push(p.clone().lerp(q, (cut - p.z) / (q.z - p.z)));
          });
          if (section.length >= 3) clipped.push(section);
        }
      }
      polygons = clipped;
    }
    for (const polygon of polygons) for (let i = 1; i < polygon.length - 1; i++)
      emitTriangle(warp(polygon[0]), warp(polygon[i]), warp(polygon[i + 1]), outward);
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
    const channels = face === side ? [outsideChannel] : insideChannels;
    const faceHoles = [...holes, ...channels];
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
    const channelDepth = face === side ? 0.003 : 0.010;
    const floorVertex = (point: Point) => vertex(point, face)
      .add(new THREE.Vector3(-face * channelDepth, 0, 0));
    for (const channel of channels) {
      for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(channel, []))
        triangle(floorVertex(channel[a]), floorVertex(channel[b]), floorVertex(channel[c]), outward);
      for (let i = 0; i < channel.length; i++) {
        const next = (i + 1) % channel.length;
        const delta = channel[next].clone().sub(channel[i]);
        quad(vertex(channel[i], face), vertex(channel[next], face), floorVertex(channel[next]), floorVertex(channel[i]),
          new THREE.Vector3(0, -delta.x, delta.y));
      }
    }
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

/** Broad arched casting joins the twin arms ahead of the tyre. The scooped
 * trailing edge opens toward the wheel and leaves the shock clevis separate. */
export function supermotoSwingarmBridgeGeometry() {
  const plan = new THREE.Shape();
  const frontX = supermotoSwingarmSection(0.233).centerX + 0.007;
  const wingX = supermotoSwingarmSection(0.430).centerX + 0.014;
  plan.moveTo(-frontX, 0.233);
  plan.lineTo(frontX, 0.233);
  plan.lineTo(wingX, 0.430);
  plan.lineTo(0.079, 0.415);
  plan.quadraticCurveTo(0.055, 0.267, 0, 0.267);
  plan.quadraticCurveTo(-0.055, 0.267, -0.079, 0.415);
  plan.lineTo(-wingX, 0.430);
  plan.closePath();
  const geometry = new THREE.ExtrudeGeometry(plan, {
    depth: 0.030, bevelEnabled: true, bevelThickness: 0.001,
    bevelSize: 0.001, bevelSegments: 1, steps: 1, curveSegments: 8,
  });
  geometry.rotateX(Math.PI / 2);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++)
    position.setY(i, position.getY(i) + centerAt(position.getZ(i)) - 0.013);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function bearingRing(inner: number, outer: number, fromX: number, toX: number) {
  const a = Math.min(fromX, toX), b = Math.max(fromX, toX);
  const bevel = Math.min(0.0008, (b - a) / 4);
  const profile = [[inner, a], [outer - bevel, a], [outer, a + bevel],
    [outer, b - bevel], [outer - bevel, b], [inner, b], [inner, a]];
  const geometry = new THREE.LatheGeometry(profile.map(([r, x]) => new THREE.Vector2(r, x)), 40);
  geometry.rotateZ(-Math.PI / 2);
  geometry.translate(0, dimensions.pivotY, dimensions.pivotZ);
  return geometry;
}

/** Real shaft, rotating races and fixed spacers bridge the tucked roots to
 * the frame cheeks. Races are children of the arms, so existing rig motion
 * carries them rigidly without a second animation path. */
export function addSupermotoPivotConnection(body: THREE.Group, finish: THREE.MeshStandardMaterial) {
  const bearing = SUPERMOTO_PIVOT_BEARING;
  const steel = finish.clone(); steel.metalness = 0.62; steel.roughness = 0.34;
  const add = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, name: string) => {
    const part = new THREE.Mesh(geometry, steel); part.name = name;
    part.castShadow = part.receiveShadow = true; parent.add(part); return part;
  };
  const shaft = add(body, new THREE.CylinderGeometry(bearing.pinRadius, bearing.pinRadius, 0.281, 32), 'swingarm-pivot');
  shaft.rotation.z = Math.PI / 2; shaft.position.set(0, dimensions.pivotY, dimensions.pivotZ);
  const arms = body.getObjectsByProperty('name', 'box-section-swingarm') as THREE.Mesh[];
  for (const side of [-1, 1]) {
    const arm = arms.find(part => Math.sign(part.geometry.getAttribute('position').getX(0)) === side);
    if (!arm) throw new Error('Build both Supermoto arms before their pivot bearings');
    add(arm, bearingRing(bearing.raceInnerRadius, bearing.raceOuterRadius,
      side * bearing.raceInnerX, side * bearing.raceOuterX), 'supermoto-swingarm-pivot-race');
    add(body, bearingRing(bearing.raceInnerRadius, 0.0165,
      side * (bearing.raceOuterX - 0.0001), side * bearing.spacerOuterX), 'supermoto-pivot-bearing-spacer');
    add(body, bearingRing(bearing.raceInnerRadius, 0.020,
      side * 0.1354, side * 0.138), 'supermoto-pivot-retaining-washer');
    const head = add(body, new THREE.CylinderGeometry(0.0135, 0.0135, 0.005, 6), 'supermoto-pivot-pin-head');
    head.rotation.z = Math.PI / 2; head.position.set(side * 0.140, dimensions.pivotY, dimensions.pivotZ);
  }
}
