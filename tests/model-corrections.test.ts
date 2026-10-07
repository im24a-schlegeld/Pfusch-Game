import { expect, it, vi } from 'vitest';
import {
  Bone,
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
import { installImportedBikeFixtures } from './importedBikeFixture';

installImportedBikeFixtures();

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

it.each(['125', 'scooter', 'moped', '450', '701'] as const)(
  '%s scrapes at its earliest actual rear vertex, with the same adult bones',
  (id) => {
    const bike = makeBike({ ...newPlayer(), bike: id }, []);
    bike.root.updateMatrixWorld(true);
    // Remove only presentation scale. Keep the actual settled suspension pose
    // when comparing vertices with neutral axle/contact coordinates.
    const inverse = bike.root.matrixWorld.clone().invert().premultiply(
      new Matrix4().makeScale(1 / bike.body.scale.x, 1 / bike.body.scale.y, 1 / bike.body.scale.z),
    );
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
    const target = new Vector3(...contact.settledPoint);
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
    // The legs have linked bones; the sleeve rig uses sibling torso/arm bones.
    expect(bones.length).toBe(2);
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
    // A short mudguard lifts fewer millimetres than a high sport tail for
    // the same 0.03-radian return; every actual part must still clear the road.
    expect(
      Math.min(
        ...firstPart.flatMap((part) => vertices(part).map((point) => point.y)),
      ),
    ).toBeGreaterThan(0.001);
  },
);
