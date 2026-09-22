import { describe, expect, it, vi } from 'vitest';
import {
  Box3,
  Line3,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Vector3,
} from 'three';
import type { CylinderGeometry } from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';
import { BIKE_CONTACTS } from '../app/game/riderSkeleton';

// Mechanical meshes are built unchanged; only browser-only fabric painting is
// replaced. These tests inspect the actual assembled geometry and transforms.
vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

function rodAxis(part: Mesh) {
  const h = (part.geometry as CylinderGeometry).parameters.height;
  part.updateMatrix();
  return new Line3(
    new Vector3(0, -h / 2, 0).applyMatrix4(part.matrix),
    new Vector3(0, h / 2, 0).applyMatrix4(part.matrix),
  );
}

function ringCenter(part: Mesh, ring: number, sides = 14) {
  const vertices = part.geometry.getAttribute('position');
  const result = new Vector3();
  for (let i = 0; i < sides; i++)
    result.add(
      new Vector3().fromBufferAttribute(vertices, ring * (sides + 1) + i),
    );
  return result.divideScalar(sides);
}

describe('assembled motorcycle connections', () => {
  it.each(['450', '701'] as const)(
    '%s connects each caliper through a real carrier plate to its axle',
    (bikeId) => {
      const bike = makeBike({ ...newPlayer(), bike: bikeId }, []);
      bike.root.scale.setScalar(1);
      // Inspect the mechanical coordinate system; display scale is covered by
      // the assembled motorcycle scale tests.
      bike.body.scale.setScalar(1);
      bike.root.updateMatrixWorld(true);
      const calipers = bike.body.getObjectsByProperty(
        'name',
        'brake-caliper',
      ) as Mesh[];
      const carriers = bike.body.getObjectsByProperty(
        'name',
        'brake-caliper-carrier',
      ) as Mesh[];
      expect(carriers).toHaveLength(calipers.length);
      const ray = new Raycaster();
      for (const caliper of calipers) {
        ray.set(
          new Vector3(1, caliper.position.y, caliper.position.z),
          new Vector3(-1, 0, 0),
        );
        const connection = ray
          .intersectObjects(carriers, false)
          .find((hit) => Math.abs(hit.point.x - caliper.position.x) < 0.024);
        expect(connection).toBeDefined();
        // The same solid plate reaches the axle; a detached decorative plate
        // near the caliper is insufficient to pass this connectivity check.
        const wheel =
          caliper.parent === bike.wheels[0].parent
            ? bike.wheels[0]
            : bike.wheels[1];
        ray.set(
          new Vector3(1, wheel.position.y, wheel.position.z),
          new Vector3(-1, 0, 0),
        );
        expect(
          ray.intersectObject(connection!.object, false).length,
        ).toBeGreaterThan(0);
      }
      expect(bike.body.getObjectByName('rear-brake-torque-link')).toBeDefined();
      if (bikeId === '701') {
        const rearsets = bike.body.getObjectsByProperty(
          'name',
          'frame-mounted-rearset',
        );
        expect(rearsets).toHaveLength(2);
        for (const yAndZ of [
          [0.56, 0.16],
          [0.41, 0.4],
        ]) {
          ray.set(new Vector3(1, yAndZ[0], yAndZ[1]), new Vector3(-1, 0, 0));
          for (const rearset of rearsets)
            expect(ray.intersectObject(rearset, false).length).toBeGreaterThan(
              0,
            );
        }
      }
    },
  );
  it.each(['125', '450', '701'] as const)(
    '%s joins both fork legs with coaxial yokes, bearings and a frame head',
    (bikeId) => {
      const bike = makeBike({ ...newPlayer(), bike: bikeId }, []);
      const forks = bike.body.getObjectsByProperty(
        'name',
        'telescopic-fork-slider',
      ) as Mesh[];
      const yokes = bike.body.getObjectsByProperty(
        'name',
        'fork-yoke',
      ) as Mesh[];
      expect(forks).toHaveLength(2);
      expect(yokes).toHaveLength(2);
      expect(
        bike.body.getObjectsByProperty('name', 'steering-head'),
      ).toHaveLength(1);
      const nearest = new Vector3();
      for (const yoke of yokes) {
        const endpoints = rodAxis(yoke);
        for (const end of [endpoints.start, endpoints.end]) {
          const fork = forks.find(
            (part) => Math.sign(part.position.x) === Math.sign(end.x),
          )!;
          rodAxis(fork).closestPointToPoint(end, true, nearest);
          expect(nearest.distanceTo(end)).toBeLessThan(1e-6);
        }
      }
      const head = rodAxis(bike.body.getObjectByName('steering-head') as Mesh);
      for (const bearing of bike.body.getObjectsByProperty(
        'name',
        'steering-head-bearing',
      ) as Mesh[]) {
        const center = rodAxis(bearing).getCenter(new Vector3());
        head.closestPointToPoint(center, true, nearest);
        expect(nearest.distanceTo(center)).toBeLessThan(1e-6);
      }
      // A yoke may not substitute for/relocate a wheel or stretch the fork.
      expect(bike.wheels[0].position.z).toBe(
        bikeId === '125' ? -0.7 : bikeId === '450' ? -0.77 : -0.72,
      );
      const upper = rodAxis(forks[0]).end;
      bike.animateSuspension(0.035, 0.02);
      expect(rodAxis(forks[0]).end.distanceTo(upper)).toBeLessThan(1e-6);
    },
  );

  it('bridges the photographed Töffli handlebar gap and mounts its lamp and rack', () => {
    const bike = makeBike({ ...newPlayer(), bike: '125' }, []);
    const stem = bike.body.getObjectByName('handlebar-stem') as Mesh;
    const top = rodAxis(stem).end;
    expect(top.distanceTo(new Vector3(0, 1, -0.45))).toBeLessThan(0.013);
    bike.root.updateMatrixWorld(true);
    expect(
      new Box3()
        .setFromObject(stem)
        .intersectsBox(
          new Box3().setFromObject(bike.body.getObjectByName('steering-head')!),
        ),
    ).toBe(true);
    expect(
      bike.body.getObjectsByProperty('name', 'headlamp-bracket'),
    ).toHaveLength(2);
    expect(
      bike.body.getObjectsByProperty('name', 'rack-frame-mount'),
    ).toHaveLength(2);
    expect(
      bike.body.getObjectsByProperty('name', 'rack-crossbar'),
    ).toHaveLength(4);
    expect(bike.body.getObjectByName('moped-drive-belt')).toBeDefined();
    expect(bike.body.getObjectByName('left-drive-chain')).toBeUndefined();
  });

  it('joins the moderately widened Töffli upper frame into its actual steering head', () => {
    const bike = makeBike({ ...newPlayer(), bike: '125' }, []);
    const frame = bike.body.getObjectByName('moped-main-frame') as Mesh;
    const neck = rodAxis(bike.body.getObjectByName('steering-head') as Mesh);
    const frameEnd = ringCenter(frame, 22, 20);
    expect(neck.closestPointToPoint(frameEnd, true, new Vector3())
      .distanceTo(frameEnd)).toBeLessThan(0.001);
    const points = frame.geometry.getAttribute('position');
    let halfWidth = 0;
    for (let i = 0; i < points.count; i++)
      if (points.getY(i) > 0.58 && points.getY(i) < 0.82)
        halfWidth = Math.max(halfWidth, Math.abs(points.getX(i)));
    expect(halfWidth).toBeGreaterThan(0.082);
    expect(halfWidth).toBeLessThan(0.094);
  });

  it('sweeps both actual Supermoto grip axes toward the rider and keeps their IK centers', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    const bar = bike.body.getObjectByName('supermoto-handlebar') as Mesh;
    const grips = bike.body.getObjectsByProperty('name', 'supermoto-handgrip') as Mesh[];
    expect(grips).toHaveLength(2);
    for (const grip of grips) {
      const axis = rodAxis(grip);
      const center = axis.getCenter(new Vector3());
      const side = Math.sign(center.x);
      const target = BIKE_CONTACTS['450'].grip;
      expect(center.distanceTo(new Vector3(side * target[0], target[1], target[2])))
        .toBeLessThan(1e-6);
      expect(axis.end.z - axis.start.z).toBeGreaterThan(0.03);
      expect(ringCenter(bar, side < 0 ? 0 : 36, 12).distanceTo(axis.end))
        .toBeLessThan(1e-6);
      expect(axis.end.z - ringCenter(bar, 18, 12).z).toBeGreaterThan(0.12);
    }
  });

  it.each(['125', '450', '701'] as const)(
    '%s carries a continuous engine-to-muffler pipe with a frame attachment',
    (bikeId) => {
      const bike = makeBike({ ...newPlayer(), bike: bikeId }, []);
      const pipe = bike.body.getObjectByName('connected-exhaust-pipe') as Mesh;
      const muffler = bike.body.getObjectByName('single-exhaust') as Mesh;
      const end = ringCenter(pipe, 24);
      const mufflerAxis = rodAxis(muffler);
      const nearest = mufflerAxis.closestPointToPoint(end, true, new Vector3());
      expect(nearest.distanceTo(end)).toBeLessThan(0.016);
      const start = ringCenter(pipe, 0);
      expect(start.y).toBeGreaterThan(
        bikeId === '450' ? 0.7 : bikeId === '701' ? 0.35 : 0.27,
      );
      expect(start.z).toBeLessThan(-0.14);
      expect(bike.body.getObjectByName('exhaust-frame-hanger')).toBeDefined();
      expect(bike.body.getObjectByName('exhaust-mount-band')).toBeDefined();
      if (bikeId === '701') {
        const headers = bike.body.getObjectsByProperty(
          'name',
          'four-cylinder-exhaust-header',
        ) as Mesh[];
        expect(headers).toHaveLength(4);
        for (const header of headers)
          expect(ringCenter(header, 18, 10).distanceTo(start)).toBeLessThan(
            1e-6,
          );
      }
    },
  );
});
