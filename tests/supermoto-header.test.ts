import { describe, expect, it, vi } from 'vitest';
import {
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Raycaster,
  TubeGeometry,
  Vector3,
} from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

describe('fitted Supermoto header', () => {
  it('keeps the real compact return bend clear of the cylinder, radiator and coolant hose', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    bike.root.scale.setScalar(1);
    bike.body.scale.setScalar(1);
    bike.root.updateMatrixWorld(true);
    const header = bike.body.getObjectByName(
      'connected-exhaust-pipe',
    ) as Mesh<TubeGeometry>;
    const path = header.geometry.parameters.path;
    const start = path.getPoint(0);
    expect(start.distanceTo(new Vector3(0.046, 0.724, -0.238))).toBeLessThan(
      1e-9,
    );
    const portAxis = new Vector3(0.083, -0.006, -0.025).normalize();
    expect(path.getTangent(0).dot(portAxis)).toBeGreaterThan(0.999);
    const frontBend = path
      .getSpacedPoints(256)
      .filter((point) => point.z < -0.07);
    // A header beside the head must not hang down level with the crankcase.
    expect(Math.min(...frontBend.map((point) => point.y))).toBeGreaterThan(
      0.65,
    );
    expect(Math.max(...frontBend.map((point) => point.x))).toBeLessThan(0.19);

    const finish = new MeshBasicMaterial({ side: DoubleSide });
    const names = new Set([
      'engine-crankcase',
      'engine-clutch-cover',
      'engine-ignition-cover',
      'engine-water-jacket',
      'engine-cylinder-head',
      'engine-valve-cover',
      'engine-water-pump',
      'radiator-core',
      'radiator-end-tank',
    ]);
    const obstacles: Mesh[] = [];
    bike.body.traverse((object) => {
      if (!(object instanceof Mesh) || !names.has(object.name)) return;
      const proxy = new Mesh(object.geometry, finish);
      proxy.name = object.name;
      proxy.matrixWorld.copy(object.matrixWorld);
      obstacles.push(proxy);
    });
    const direction = new Vector3(0.719, 0.417, 0.557).normalize();
    const points = header.geometry.getAttribute('position');
    const sides = header.geometry.parameters.radialSegments;
    try {
      // The first ring intentionally seats inside the exhaust port. All later
      // surface rings must remain outside the real assembled closed volumes.
      for (let index = (sides + 1) * 2; index < points.count; index++) {
        const point = new Vector3()
          .fromBufferAttribute(points, index)
          .applyMatrix4(header.matrixWorld);
        for (const obstacle of obstacles) {
          const hits = new Raycaster(point, direction)
            .intersectObject(obstacle, false)
            .map((hit) => hit.distance)
            .filter(
              (distance, i, all) => i === 0 || distance - all[i - 1] > 1e-6,
            );
          expect(hits.length % 2, `header inside ${obstacle.name}`).toBe(0);
        }
      }
      const coolant = bike.body.getObjectByName(
        'coolant-hose',
      ) as Mesh<TubeGeometry>;
      const coolantPath = coolant.geometry.parameters.path
        .getSpacedPoints(128)
        .map((point) => point.applyMatrix4(coolant.matrixWorld));
      const headerPath = path
        .getSpacedPoints(256)
        .map((point) => point.applyMatrix4(header.matrixWorld));
      let closest = Infinity;
      for (const a of headerPath)
        for (const b of coolantPath)
          closest = Math.min(closest, a.distanceTo(b));
      expect(
        closest -
          header.geometry.parameters.radius -
          coolant.geometry.parameters.radius,
      ).toBeGreaterThan(0.003);
      for (const frame of bike.body.getObjectsByProperty('name',
        'supermoto-frame-main-spar') as Mesh<TubeGeometry>[]) {
        const framePath = frame.geometry.parameters.path.getSpacedPoints(256)
          .filter((point) => point.y > 0.65)
          .map((point) => point.applyMatrix4(frame.matrixWorld));
        let frameGap = Infinity;
        for (const a of headerPath) for (const b of framePath)
          frameGap = Math.min(frameGap, a.distanceTo(b));
        expect(frameGap - header.geometry.parameters.radius
          - frame.geometry.parameters.radius, 'header must clear upper frame spars')
          .toBeGreaterThan(0.002);
      }
    } finally {
      finish.dispose();
    }
  });
});
