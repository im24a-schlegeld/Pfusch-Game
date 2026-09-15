import { expect, it } from 'vitest';
import {
  Box3,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import {
  CHAIN_DRIVE,
  MOPED_BELT,
  chainRoute,
  makeBeltDrive,
  makeDrive,
} from '../app/game/driveGeometry';
import { SPORT_GEOMETRY, roadTireGeometry } from '../app/game/sportGeometry';

/** Includes every plate/roller instance, rather than only their base geometry. */
function vertexBounds(object: Mesh) {
  object.updateWorldMatrix(true, false);
  const vertices = object.geometry.getAttribute('position'),
    bounds = new Box3(),
    transform = new Matrix4(),
    point = new Vector3();
  const instances = object instanceof InstancedMesh ? object.count : 1;
  for (let i = 0; i < instances; i++) {
    if (object instanceof InstancedMesh) {
      object.getMatrixAt(i, transform);
      transform.premultiply(object.matrixWorld);
    } else transform.copy(object.matrixWorld);
    for (let j = 0; j < vertices.count; j++)
      bounds.expandByPoint(
        point.fromBufferAttribute(vertices, j).applyMatrix4(transform),
      );
  }
  return bounds;
}

it('keeps both chain runs tangent, closes the loop and never cuts through either sprocket', () => {
  const front = new Vector2(0.08, 0.49),
    rear = new Vector2(0.76, 0.3119);
  const route = chainRoute(front, rear, 0.04, 0.12);
  expect(route.getPoint(0).distanceTo(route.getPoint(1))).toBeLessThan(1e-6);
  const upper = route.curves[0];
  const contact = upper.getPoint(0);
  const normal = contact.clone().sub(new Vector3(0, front.y, front.x));
  expect(Math.abs(normal.dot(upper.getTangent(0)))).toBeLessThan(1e-8);
  for (let i = 0; i < 1000; i++) {
    const p = route.getPointAt(i / 1000);
    expect(Math.hypot(p.z - front.x, p.y - front.y)).toBeGreaterThan(0.0398);
    expect(Math.hypot(p.z - rear.x, p.y - rear.y)).toBeGreaterThan(0.1198);
    expect(p.x).toBe(0);
  }
});

it.each([
  ['supermoto', 0.76, 0.3119, 0.16],
  [
    'sport',
    SPORT_GEOMETRY.rearAxle,
    SPORT_GEOMETRY.rearRadius,
    SPORT_GEOMETRY.rearWidth,
  ],
] as const)(
  'keeps the complete %s chain inside the left beam and clear of the actual tire',
  (_, rearZ, rearY, tireWidth) => {
    const body = new Group(),
      wheel = new Group(),
      metal = new MeshStandardMaterial();
    wheel.position.set(0, rearY, rearZ);
    body.add(wheel);
    const tire = new Mesh(roadTireGeometry(rearY, tireWidth), metal);
    wheel.add(tire);
    makeDrive(body, wheel, 0.08, 0.49, metal);
    const tireBounds = vertexBounds(tire);
    expect(tireBounds.min.x).toBeGreaterThanOrEqual(
      -CHAIN_DRIVE.maxRearTireHalfWidth,
    );
    expect(tireBounds.max.x).toBeLessThanOrEqual(
      CHAIN_DRIVE.maxRearTireHalfWidth,
    );
    const beamInnerX =
      CHAIN_DRIVE.leftSwingarmX + CHAIN_DRIVE.maxSwingarmHalfWidth;
    for (const name of ['left-drive-chain', 'chain-rollers']) {
      const bounds = vertexBounds(body.getObjectByName(name) as Mesh);
      expect(bounds.min.x - beamInnerX).toBeGreaterThan(0.007);
      expect(tireBounds.min.x - bounds.max.x).toBeGreaterThan(0.005);
      expect(tireBounds.min.x - bounds.max.x).toBeLessThan(0.03);
      expect(bounds.min.x).toBeGreaterThanOrEqual(
        CHAIN_DRIVE.planeX - CHAIN_DRIVE.chainHalfWidth - 1e-8,
      );
      expect(bounds.max.x).toBeLessThanOrEqual(
        CHAIN_DRIVE.planeX + CHAIN_DRIVE.chainHalfWidth + 1e-8,
      );
      // Both sides of the axle are reached, so a missing lower/outer wrap cannot pass.
      expect(bounds.min.y).toBeLessThan(rearY - 0.115);
      expect(bounds.max.z).toBeGreaterThan(rearZ + 0.115);
    }
    const sprockets: Mesh[] = [];
    body.traverse((object) => {
      if (object.name === 'drive-sprocket') sprockets.push(object as Mesh);
    });
    expect(sprockets).toHaveLength(2);
    for (const sprocket of sprockets) {
      const bounds = vertexBounds(sprocket);
      expect(bounds.min.x).toBeGreaterThan(beamInnerX);
      expect(bounds.max.x).toBeLessThan(tireBounds.min.x);
    }
    const carrier = vertexBounds(
      wheel.getObjectByName('rear-sprocket-carrier') as Mesh,
    );
    expect(carrier.min.x).toBeCloseTo(CHAIN_DRIVE.planeX, 7);
    expect(carrier.max.x).toBeCloseTo(CHAIN_DRIVE.hubFaceX, 7);
  },
);

it('gives the moped a continuous rubber belt with smooth pulleys and no chain hardware', () => {
  const body = new Group(),
    wheel = new Group(),
    metal = new MeshStandardMaterial(),
    rubber = new MeshStandardMaterial();
  wheel.position.set(0, 0.305, 0.55);
  body.add(wheel);
  const { front, rear, belt } = makeBeltDrive(body, wheel, metal, rubber);
  const names: string[] = [];
  body.traverse((object) => names.push(object.name));
  expect(names.filter((name) => name === 'smooth-belt-pulley')).toHaveLength(2);
  expect(names.some((name) => /chain|sprocket|roller/.test(name))).toBe(false);
  expect(rear.parent).toBe(wheel);
  expect(front.position.x).toBe(rear.position.x);
  expect(belt.material).toBe(rubber);

  const tire = new Mesh(new TorusGeometry(0.271, 0.034, 12, 48), rubber);
  tire.rotation.y = Math.PI / 2;
  wheel.add(tire);
  const tireBounds = vertexBounds(tire);
  for (const part of [front, rear, belt]) {
    const bounds = vertexBounds(part);
    expect(bounds.min.x - MOPED_BELT.leftStayInnerX).toBeGreaterThan(0.0029);
    expect(tireBounds.min.x - bounds.max.x).toBeGreaterThan(0.0199);
  }

  const positions = belt.geometry.getAttribute('position');
  for (let corner = 0; corner < 4; corner++) {
    const start = new Vector3().fromBufferAttribute(positions, corner),
      end = new Vector3().fromBufferAttribute(
        positions,
        positions.count - 4 + corner,
      );
    expect(start.distanceTo(end)).toBe(0);
  }
  // Check the rendered solid, including its inner contact face, around both pulleys.
  for (let i = 0; i < positions.count; i++) {
    const p = new Vector3().fromBufferAttribute(positions, i);
    expect(
      Math.hypot(p.z - MOPED_BELT.frontZ, p.y - MOPED_BELT.frontY),
    ).toBeGreaterThan(MOPED_BELT.frontRadius - 0.0002);
    expect(
      Math.hypot(p.z - wheel.position.z, p.y - wheel.position.y),
    ).toBeGreaterThan(MOPED_BELT.rearRadius - 0.0002);
  }
  // The outer ribbon faces outward, otherwise the default material hides the belt.
  const indices = belt.geometry.getIndex()!;
  const a = new Vector3().fromBufferAttribute(positions, indices.getX(0)),
    b = new Vector3().fromBufferAttribute(positions, indices.getX(1)),
    c = new Vector3().fromBufferAttribute(positions, indices.getX(2));
  expect(b.sub(a).cross(c.sub(a)).y).toBeGreaterThan(0);
});

it('keeps the moped belt tangent to both pulleys and closes its route', () => {
  const front = new Vector2(MOPED_BELT.frontZ, MOPED_BELT.frontY),
    rear = new Vector2(0.55, 0.305),
    route = chainRoute(
      front,
      rear,
      MOPED_BELT.frontRadius + MOPED_BELT.thickness / 2,
      MOPED_BELT.rearRadius + MOPED_BELT.thickness / 2,
    );
  expect(route.getPoint(0).distanceTo(route.getPoint(1))).toBeLessThan(1e-8);
  for (const index of [0, 49]) {
    const run = route.curves[index];
    for (const [t, center] of index === 0
      ? ([
          [0, front],
          [1, rear],
        ] as const)
      : ([
          [0, rear],
          [1, front],
        ] as const)) {
      const radius = run.getPoint(t).sub(new Vector3(0, center.y, center.x));
      expect(Math.abs(radius.dot(run.getTangent(t)))).toBeLessThan(1e-8);
    }
  }
});
