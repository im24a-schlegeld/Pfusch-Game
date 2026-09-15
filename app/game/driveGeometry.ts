import * as THREE from 'three';

/** Shared lateral envelope: the complete chain sits between tire and left beam. */
export const CHAIN_DRIVE = Object.freeze({
  planeX: -0.113,
  chainHalfWidth: 0.0105,
  frontRadius: 0.04,
  rearRadius: 0.12,
  leftSwingarmX: -0.164,
  rightSwingarmX: 0.164,
  maxSwingarmHalfWidth: 0.032,
  maxRearTireHalfWidth: 0.096,
  hubFaceX: -0.06,
});

/** Ciao-style engine belt, separate from the pedal mechanism. Units are metres. */
export const MOPED_BELT = Object.freeze({
  planeX: -0.064,
  frontZ: 0.03,
  frontY: 0.28,
  frontRadius: 0.035,
  rearRadius: 0.11,
  width: 0.014,
  thickness: 0.005,
  pulleyHalfWidth: 0.01,
  rearTireHalfWidth: 0.034,
  leftStayInnerX: -0.077,
});

export function brakeRotorGeometry(radius: number) {
  const face = new THREE.Shape();
  face.absarc(0, 0, radius, 0, Math.PI * 2, false);
  const hub = new THREE.Path();
  hub.absarc(0, 0, radius * 0.64, 0, Math.PI * 2, true);
  face.holes.push(hub);
  for (let i = 0; i < 20; i++) {
    const a = (i * Math.PI) / 10,
      hole = new THREE.Path();
    hole.absarc(
      Math.cos(a) * radius * 0.84,
      Math.sin(a) * radius * 0.84,
      radius * 0.024,
      0,
      Math.PI * 2,
      true,
    );
    face.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(face, {
    depth: 0.004,
    bevelEnabled: false,
    curveSegments: 48,
  });
  geometry.translate(0, 0, -0.002);
  geometry.rotateY(Math.PI / 2);
  return geometry;
}

function sprocket(radius: number, teeth: number, material: THREE.Material) {
  const shape = new THREE.Shape();
  for (let i = 0; i <= teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2;
    const r = radius + (i % 4 === 1 || i % 4 === 2 ? 0.004 : -0.004);
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const hole = new THREE.Path();
  hole.absarc(
    0,
    0,
    radius * (radius > 0.08 ? 0.76 : 0.48),
    0,
    Math.PI * 2,
    true,
  );
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.007,
    bevelEnabled: false,
  });
  geometry.translate(0, 0, -0.0035);
  geometry.rotateY(Math.PI / 2);
  const result = new THREE.Mesh(geometry, material);
  result.name = 'drive-sprocket';
  return result;
}

/** Straight external tangents joined by the outer wrap of each sprocket. */
export function chainRoute(
  front: THREE.Vector2,
  rear: THREE.Vector2,
  small: number,
  large: number,
) {
  const delta = rear.clone().sub(front),
    distance = delta.length();
  if (distance <= Math.abs(large - small))
    throw new RangeError('Overlapping chain sprockets');
  const axis = delta.divideScalar(distance),
    perp = new THREE.Vector2(-axis.y, axis.x);
  const k = (small - large) / distance;
  const upper = axis
    .clone()
    .multiplyScalar(k)
    .addScaledVector(perp, Math.sqrt(1 - k * k));
  const lower = axis
    .clone()
    .multiplyScalar(k)
    .addScaledVector(perp, -Math.sqrt(1 - k * k));
  const route = new THREE.CurvePath<THREE.Vector3>();
  const point = (c: THREE.Vector2, r: number, n: THREE.Vector2) =>
    new THREE.Vector3(0, c.y + r * n.y, c.x + r * n.x);
  const line = (a: THREE.Vector3, b: THREE.Vector3) =>
    route.add(new THREE.LineCurve3(a, b));
  const arc = (
    c: THREE.Vector2,
    r: number,
    start: THREE.Vector2,
    end: THREE.Vector2,
  ) => {
    const a = Math.atan2(start.y, start.x);
    let b = Math.atan2(end.y, end.x);
    while (b >= a) b -= Math.PI * 2;
    let previous = point(c, r, start);
    for (let i = 1; i <= 48; i++) {
      const angle = THREE.MathUtils.lerp(a, b, i / 48);
      const next = point(
        c,
        r,
        new THREE.Vector2(Math.cos(angle), Math.sin(angle)),
      );
      line(previous, next);
      previous = next;
    }
  };
  line(point(front, small, upper), point(rear, large, upper));
  arc(rear, large, upper, lower);
  line(point(rear, large, lower), point(front, small, lower));
  arc(front, small, lower, upper);
  return route;
}

export function makeDrive(
  parent: THREE.Group,
  rearWheel: THREE.Group,
  frontZ: number,
  frontY: number,
  material: THREE.MeshStandardMaterial,
) {
  const x = CHAIN_DRIVE.planeX,
    small = CHAIN_DRIVE.frontRadius,
    large = CHAIN_DRIVE.rearRadius;
  const front = sprocket(small, 14, material);
  front.position.set(x, frontY, frontZ);
  parent.add(front);
  const rear = sprocket(large, 42, material);
  rear.position.x = x;
  rearWheel.add(rear);
  // Connect only the sprocket plane to the existing hub's left face.
  const carrier = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, CHAIN_DRIVE.hubFaceX - x, 24),
    material,
  );
  carrier.rotation.z = Math.PI / 2;
  carrier.position.x = (x + CHAIN_DRIVE.hubFaceX) / 2;
  carrier.name = 'rear-sprocket-carrier';
  rearWheel.add(carrier);
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI * 2) / 5;
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.007, 0.014, 0.105),
      material,
    );
    arm.position.set(x, Math.sin(a) * 0.059, Math.cos(a) * 0.059);
    arm.rotation.x = -a;
    arm.name = 'sprocket-carrier-spoke';
    rearWheel.add(arm);
  }
  const path = chainRoute(
    new THREE.Vector2(frontZ, frontY),
    new THREE.Vector2(rearWheel.position.z, rearWheel.position.y),
    small,
    large,
  );
  const count = Math.ceil(path.getLength() / 0.016);
  const plates = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.003, 0.009, 0.014),
    material,
    count * 2,
  );
  const rollerGeometry = new THREE.CylinderGeometry(0.0034, 0.0034, 0.015, 6);
  rollerGeometry.rotateZ(Math.PI / 2);
  const rollers = new THREE.InstancedMesh(rollerGeometry, material, count);
  const matrix = new THREE.Matrix4(),
    rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1),
    forward = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < count; i++) {
    const p = path.getPointAt(i / count),
      tangent = path.getTangentAt(i / count);
    rotation.setFromUnitVectors(forward, tangent);
    p.x = x;
    matrix.compose(p, rotation, scale);
    rollers.setMatrixAt(i, matrix);
    for (const side of [-1, 1]) {
      p.x = x + side * (i % 2 ? 0.009 : 0.006);
      matrix.compose(p, rotation, scale);
      plates.setMatrixAt(i * 2 + (side + 1) / 2, matrix);
    }
  }
  plates.name = 'left-drive-chain';
  rollers.name = 'chain-rollers';
  parent.add(plates, rollers);
}

/** Smooth V-groove pulley; no chain teeth or links on the moped power drive. */
function beltPulley(radius: number, material: THREE.Material) {
  const half = MOPED_BELT.pulleyHalfWidth;
  const hub = Math.min(radius * 0.35, 0.019);
  const profile = [
    [hub, -half],
    [radius - 0.008, -half],
    [radius + 0.005, -half + 0.001],
    [radius + 0.005, -0.0075],
    [radius, -0.005],
    [radius - 0.003, 0],
    [radius, 0.005],
    [radius + 0.005, 0.0075],
    [radius + 0.005, half - 0.001],
    [radius - 0.008, half],
    [hub, half],
    [hub, -half],
  ].map(([r, axial]) => new THREE.Vector2(r, axial));
  const geometry = new THREE.LatheGeometry(profile, 64);
  geometry.rotateZ(Math.PI / 2);
  const pulley = new THREE.Mesh(geometry, material);
  pulley.name = 'smooth-belt-pulley';
  return pulley;
}

/** A closed trapezoidal ribbon, including both sidewalls and the contact face. */
function beltGeometry(route: THREE.CurvePath<THREE.Vector3>) {
  const vertices: number[] = [],
    indices: number[] = [];
  const steps = 256,
    halfThickness = MOPED_BELT.thickness / 2;
  for (let i = 0; i <= steps; i++) {
    const t = i === steps ? 0 : i / steps;
    const point = route.getPointAt(t),
      tangent = route.getTangentAt(t),
      outward = new THREE.Vector3(0, tangent.z, -tangent.y).normalize();
    for (const [x, depth] of [
      [-MOPED_BELT.width / 2, halfThickness],
      [MOPED_BELT.width / 2, halfThickness],
      [0.005, -halfThickness],
      [-0.005, -halfThickness],
    ]) {
      vertices.push(
        MOPED_BELT.planeX + x,
        point.y + outward.y * depth,
        point.z + outward.z * depth,
      );
    }
  }
  for (let i = 0; i < steps; i++)
    for (let edge = 0; edge < 4; edge++) {
      const a = i * 4 + edge,
        b = i * 4 + ((edge + 1) % 4),
        c = a + 4,
        d = b + 4;
      indices.push(a, c, b, b, c, d);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function makeBeltDrive(
  parent: THREE.Group,
  rearWheel: THREE.Group,
  metal: THREE.MeshStandardMaterial,
  rubber: THREE.MeshStandardMaterial,
) {
  const front = beltPulley(MOPED_BELT.frontRadius, metal);
  front.position.set(MOPED_BELT.planeX, MOPED_BELT.frontY, MOPED_BELT.frontZ);
  parent.add(front);
  const rear = beltPulley(MOPED_BELT.rearRadius, metal);
  rear.position.x = MOPED_BELT.planeX;
  rearWheel.add(rear);
  const route = chainRoute(
    new THREE.Vector2(MOPED_BELT.frontZ, MOPED_BELT.frontY),
    new THREE.Vector2(rearWheel.position.z, rearWheel.position.y),
    MOPED_BELT.frontRadius + MOPED_BELT.thickness / 2,
    MOPED_BELT.rearRadius + MOPED_BELT.thickness / 2,
  );
  const belt = new THREE.Mesh(beltGeometry(route), rubber);
  belt.name = 'moped-drive-belt';
  parent.add(belt);
  return { front, rear, belt };
}
