import * as THREE from 'three';

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
  const x = -0.185,
    small = 0.04,
    large = 0.12;
  const front = sprocket(small, 14, material);
  front.position.set(x, frontY, frontZ);
  parent.add(front);
  const rear = sprocket(large, 42, material);
  rear.position.x = x;
  rearWheel.add(rear);
  // Carrier connects the rear sprocket to the rotating hub.
  const carrier = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 0.14, 24),
    material,
  );
  carrier.rotation.z = Math.PI / 2;
  carrier.position.x = -0.115;
  rearWheel.add(carrier);
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI * 2) / 5;
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.007, 0.014, 0.105),
      material,
    );
    arm.position.set(x, Math.sin(a) * 0.059, Math.cos(a) * 0.059);
    arm.rotation.x = -a;
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
