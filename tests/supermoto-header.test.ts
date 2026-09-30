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
    expect(start.distanceTo(new Vector3(0.112, 0.578, -0.210))).toBeLessThan(
      1e-9,
    );
    const portAxis = new Vector3(0.05, -0.018, -0.080).normalize();
    expect(path.getTangent(0).dot(portAxis)).toBeGreaterThan(0.999);
    const frontBend = path
      .getSpacedPoints(256)
      .filter((point) => point.z < -0.07);
    // The short external return drops below the radiator without extending
    // far toward the front tyre or hanging below the sump.
    expect(Math.min(...frontBend.map((point) => point.y))).toBeGreaterThan(
      0.48,
    );
    expect(Math.min(...frontBend.map((point) => point.y))).toBeLessThan(0.53);
    expect(Math.min(...frontBend.map((point) => point.z))).toBeGreaterThan(-0.35);
    expect(Math.max(...frontBend.map((point) => point.x))).toBeLessThan(0.20);
    const externalRun = path.getSpacedPoints(256).filter(point => point.z > 0.045 && point.z < 0.165);
    expect(externalRun.length).toBeGreaterThan(12);
    for (const point of externalRun) {
      expect(point.x - header.geometry.parameters.radius).toBeGreaterThan(0.165);
    }

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
      // The seated port occupied the first 2 of 40 longitudinal sections.
      // Preserve that same physical interval when increasing curve resolution.
      const firstExternalRing = Math.ceil(header.geometry.parameters.tubularSegments * 0.05);
      for (let index = (sides + 1) * firstExternalRing; index < points.count; index++) {
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
      const hosePoints = coolant.geometry.getAttribute('position');
      const hoseStride = coolant.geometry.parameters.radialSegments + 1;
      // The hose still joins the pump and radiator at its unchanged ends.
      // Its new inboard middle must clear the cast engine volumes as well.
      for (let i = hoseStride * 2; i < hosePoints.count - hoseStride * 2; i++) {
        const point = new Vector3().fromBufferAttribute(hosePoints, i).applyMatrix4(coolant.matrixWorld);
        for (const obstacle of obstacles.filter(part => part.name.startsWith('engine-') && part.name !== 'engine-water-pump')) {
          const hits = new Raycaster(point, direction).intersectObject(obstacle, false)
            .map(hit => hit.distance).filter((d, j, all) => !j || d - all[j - 1] > 1e-6);
          expect(hits.length % 2, `coolant hose inside ${obstacle.name}`).toBe(0);
        }
      }
      const headerPath = path
        .getSpacedPoints(256)
        .map((point) => point.applyMatrix4(header.matrixWorld));
      let closest = Infinity;
      let closestPair = '';
      for (const a of headerPath)
        for (const b of coolantPath)
          if (a.distanceTo(b) < closest) {
            closest = a.distanceTo(b);
            closestPair = `header ${a.toArray()} coolant ${b.toArray()}`;
          }
      expect(
        closest -
          header.geometry.parameters.radius -
          coolant.geometry.parameters.radius,
        closestPair,
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
