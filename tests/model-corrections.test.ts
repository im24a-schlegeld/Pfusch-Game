import { expect, it, vi } from 'vitest';
import {
  Bone,
  Box3,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  SkinnedMesh,
  Vector3,
  type Object3D,
} from 'three';
import { makeBike } from '../app/game/vehicle';
import { newPlayer } from '../app/domain/progression';
import { TAIL_CONTACT } from '../app/game/tailContact';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

function vertices(mesh: Mesh, inverse?: Matrix4) {
  const points: Vector3[] = [];
  const matrix = new Matrix4(),
    instance = new Matrix4();
  const count = mesh instanceof InstancedMesh ? mesh.count : 1;
  for (let i = 0; i < count; i++) {
    if (mesh instanceof InstancedMesh) {
      mesh.getMatrixAt(i, instance);
      matrix.multiplyMatrices(mesh.matrixWorld, instance);
    } else matrix.copy(mesh.matrixWorld);
    if (inverse) matrix.premultiply(inverse);
    for (
      let vertex = 0;
      vertex < mesh.geometry.getAttribute('position').count;
      vertex++
    )
      points.push(
        mesh.getVertexPosition(vertex, new Vector3()).applyMatrix4(matrix),
      );
  }
  return points;
}

it.each(['125', 'scooter', '450', '701'] as const)(
  '%s scrapes at its earliest actual rear vertex, with the same adult bones',
  (id) => {
    const bike = makeBike({ ...newPlayer(), bike: id }, []);
    bike.root.updateMatrixWorld(true);
    const inverse = bike.body.matrixWorld.clone().invert();
    const radius = bike.wheelRadius / bike.body.scale.x;
    const pivot = bike.rearAxle / bike.body.scale.x;
    const contact = TAIL_CONTACT[id];
    expect(radius).toBeCloseTo(contact.rearRadius, 7);
    expect(pivot).toBeCloseTo(contact.rearPivotZ, 7);
    const contactPoints: { name: string; angle: number; point: number[] }[] =
      [];
    const scan = (object: Object3D) => {
      if (
        object === bike.rider ||
        bike.wheels.some((wheel) => wheel === object) ||
        object.name === 'front-suspension-axle'
      )
        return;
      if (object instanceof Mesh && !(object instanceof SkinnedMesh)) {
        let best = Infinity,
          bestPoint: Vector3 | undefined;
        for (const point of vertices(object, inverse)) {
          if (point.z < pivot + 0.04) continue;
          const y = point.y - radius,
            z = point.z - pivot;
          const distance = Math.hypot(y, z);
          if (distance < radius) continue;
          const angle = Math.acos(-radius / distance) - Math.atan2(z, y);
          if (angle > 0 && angle < best) {
            best = angle;
            bestPoint = point;
          }
        }
        if (bestPoint)
          contactPoints.push({
            name: object.name || object.geometry.type,
            angle: best,
            point: bestPoint.toArray(),
          });
      }
      for (const child of object.children) scan(child);
    };
    scan(bike.body);
    contactPoints.sort((a, b) => a.angle - b.angle);
    expect(contactPoints[0].angle).toBeCloseTo(contact.angle, 6);
    const target = new Vector3(...contact.point);
    expect(
      target.distanceTo(new Vector3(...contactPoints[0].point)),
    ).toBeLessThan(0.000001);
    const firstPart = bike.body.getObjectsByProperty(
      'name',
      contactPoints[0].name,
    ) as Mesh[];
    expect(firstPart.length).toBeGreaterThan(0);
    const bones: { bone: Bone; length: number; scale: number[] }[] = [];
    bike.rider.traverse((object) => {
      if (object instanceof Bone && object.parent instanceof Bone) {
        const length = object
          .getWorldPosition(new Vector3())
          .distanceTo(object.parent.getWorldPosition(new Vector3()));
        if (length > 1e-6)
          bones.push({ bone: object, length, scale: object.scale.toArray() });
      }
    });
    // Each of the four two-bone IK chains has one explicit parent/child link.
    expect(bones.length).toBe(4);
    bike.animateRider(
      { wheelie: contact.angle, steer: 0.3, launch: 0.6, landing: 0 },
      1 / 30,
    );
    bike.animateSuspension(contact.angle, 0);
    bike.root.updateMatrixWorld(true);
    for (const entry of bones) {
      const length = entry.bone
        .getWorldPosition(new Vector3())
        .distanceTo(entry.bone.parent!.getWorldPosition(new Vector3()));
      expect(length).toBeCloseTo(entry.length, 6);
      expect(entry.bone.scale.toArray()).toEqual(entry.scale);
    }
    const minimumY = Math.min(
      ...firstPart.flatMap((part) => vertices(part).map((point) => point.y)),
    );
    expect(Math.abs(minimumY)).toBeLessThan(0.000001);
    bike.animateSuspension(contact.angle - 0.03, 0);
    bike.root.updateMatrixWorld(true);
    expect(
      Math.min(
        ...firstPart.flatMap((part) => vertices(part).map((point) => point.y)),
      ),
    ).toBeGreaterThan(0.006);
  },
);

it('keeps the actual Sport boot clear of its pipe, shortened silencer and hanger', () => {
  const bike = makeBike({ ...newPlayer(), bike: '701' }, []);
  bike.root.updateMatrixWorld(true);
  const boot = (
    bike.rider.getObjectsByProperty('name', 'rider-boot') as Mesh[]
  ).find((mesh) => mesh.position.x > 0)!;
  const foot = new Box3().setFromPoints(vertices(boot));
  const bounds = (name: string) =>
    new Box3().setFromPoints(vertices(bike.body.getObjectByName(name) as Mesh));
  // Disjoint world-space envelopes prove the complete solids cannot intersect.
  expect(foot.min.y - bounds('connected-exhaust-pipe').max.y).toBeGreaterThan(
    0.008,
  );
  expect(bounds('single-exhaust').min.z - foot.max.z).toBeGreaterThan(0.01);
  expect(bounds('exhaust-frame-hanger').min.z - foot.max.z).toBeGreaterThan(
    0.02,
  );
  expect(bounds('exhaust-mount-band').min.z - foot.max.z).toBeGreaterThan(0.02);
});

it('keeps both Supermoto boots outside the equally narrow swingarms', () => {
  const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
  bike.root.updateMatrixWorld(true);
  const boots = (
    bike.rider.getObjectsByProperty('name', 'rider-boot') as Mesh[]
  ).map((mesh) => new Box3().setFromPoints(vertices(mesh)));
  const arms = (
    bike.body.getObjectsByProperty('name', 'box-section-swingarm') as Mesh[]
  ).map((mesh) => new Box3().setFromPoints(vertices(mesh)));
  for (const side of [-1, 1]) {
    const foot = boots.find((box) => Math.sign(box.min.x) === side)!;
    const arm = arms.find((box) => Math.sign(box.min.x) === side)!;
    expect(
      side > 0 ? foot.min.x - arm.max.x : arm.min.x - foot.max.x,
    ).toBeGreaterThan(0.018);
  }
  expect(Math.abs(arms[0].min.x)).toBeCloseTo(Math.abs(arms[1].max.x), 6);
  expect(Math.abs(arms[0].max.x)).toBeCloseTo(Math.abs(arms[1].min.x), 6);
});
