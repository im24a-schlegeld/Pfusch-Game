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
import { TUBE_EXHAUST } from '../app/game/exhaustClearance';
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
    expect(start.distanceTo(new Vector3(0, 0.560, -0.236))).toBeLessThan(
      1e-9,
    );
    const portAxis = new Vector3(0, -0.012, -0.070).normalize();
    expect(path.getTangent(0).dot(portAxis)).toBeGreaterThan(0.999);
    // The outlet and first forward section pass centrally through the cradle,
    // then the return sweeps outside; a side exit cannot satisfy this gate.
    expect(Math.abs(start.x)).toBeLessThan(0.001);
    // Probe the same physical front plane even when the rear curve grows.
    const exit = path.getSpacedPoints(512).find(point => point.z < -0.3)!;
    expect(Math.abs(exit.x)).toBeLessThan(0.005);
    expect(exit.z).toBeLessThan(-0.295);
    const exhaustAxis = new Vector3(0, TUBE_EXHAUST.endY - TUBE_EXHAUST.startY, TUBE_EXHAUST.endZ - TUBE_EXHAUST.startZ).normalize();
    expect(path.getTangent(1).dot(exhaustAxis), 'pipe enters the muffler axially').toBeGreaterThan(0.999);
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
    const concealedRun = path.getSpacedPoints(256).filter(point => point.z > 0.045 && point.z < 0.165);
    expect(concealedRun.length).toBeGreaterThan(12);
    for (const point of concealedRun) {
      // The visible main spar lies outside this rear run.
      expect(point.x + header.geometry.parameters.radius).toBeLessThan(0.114);
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
      'supermoto-frame-merge-branch',
      'supermoto-frame-central-up-tube',
      'supermoto-rear-subframe',
      'supermoto-upper-subframe',
      'airbox-inner-splash-wall',
      'supermoto-shock-damper',
      'supermoto-shock-reservoir',
      'supermoto-shock-spring-seat',
      'rear-shock-spring',
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
          expect(hits.length % 2, `header inside ${obstacle.name} at ${point.toArray().join(",")}`).toBe(0);
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
      const rightSpar = bike.body.getObjectsByProperty('name', 'supermoto-frame-main-spar')
        .find(object => (object as Mesh<TubeGeometry>).geometry.parameters.path.getPoint(0.5).x > 0) as Mesh<TubeGeometry>;
      const sparPoints = rightSpar.geometry.parameters.path.getSpacedPoints(256);
      const crossing = path.getSpacedPoints(512).filter(p => p.z > 0 && p.z < 0.15)
        .sort((a, b) => {
          const gap = (p: Vector3) => Math.min(...sparPoints.map(q => Math.hypot(p.y - q.y, p.z - q.z)));
          return gap(a) - gap(b);
        })[0];
      const hit = new Raycaster(new Vector3(0.6, crossing.y, crossing.z), new Vector3(-1, 0, 0))
        .intersectObjects([rightSpar, header], false)[0];
      expect(hit?.object.name, 'the marked crossing must be hidden behind the frame').toBe('supermoto-frame-main-spar');
      const rightRear = bike.body.getObjectsByProperty('name', 'supermoto-rear-subframe')
        .find(object => (object as Mesh).geometry.getAttribute('position').getX(0) > 0) as Mesh;
      let rearCovered = 0;
      for (const point of path.getSpacedPoints(512).filter(p => p.z > 0.25 && p.z < 0.42)) {
        const ray = new Raycaster(new Vector3(0.6, point.y, point.z), new Vector3(-1, 0, 0));
        if (!ray.intersectObject(rightRear, false).length) continue;
        const first = ray.intersectObjects([rightRear, header], false)[0];
        expect(first.object.name, 'the complete rear brace must stay outside the exhaust').toBe('supermoto-rear-subframe');
        rearCovered++;
      }
      expect(rearCovered).toBeGreaterThan(3);
      for (const travel of [-0.025, 0, 0.06, 0.12]) {
        bike.animateSuspension(0, travel); bike.root.updateMatrixWorld(true);
        for (const name of ['supermoto-shock-damper', 'supermoto-shock-reservoir', 'supermoto-shock-spring-seat', 'rear-shock-spring']) {
          for (const shock of bike.body.getObjectsByProperty('name', name) as Mesh[]) {
            const proxy = new Mesh(shock.geometry, finish); proxy.matrixWorld.copy(shock.matrixWorld);
            for (const point of headerPath.filter(p => p.z > 0.02)) {
              const gap = new Raycaster(point, new Vector3(-1, 0, 0)).intersectObject(proxy, false)[0];
              if (gap) expect(gap.distance - header.geometry.parameters.radius, name + ' travel ' + travel + ' at ' + point.toArray().join(',')).toBeGreaterThan(0.003);
            }
          }
        }
      }
    } finally {
      finish.dispose();
    }
  });
});
