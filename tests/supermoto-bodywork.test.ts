import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Box3, CylinderGeometry, DoubleSide, Mesh, MeshBasicMaterial, MeshStandardMaterial, Raycaster, Triangle, Vector3 } from 'three';
import { makeBike } from '../app/game/vehicle';
import { newPlayer } from '../app/domain/progression';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

describe('reference Supermoto bodywork', () => {
  let bike: ReturnType<typeof makeBike>;
  beforeAll(() => {
    bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    bike.root.updateMatrixWorld(true);
  }, 30000);

  it('uses thin closed moulded plastic instead of bulky elliptical solids', () => {
    for (const name of ['supermoto-front-fender', 'supermoto-tail-fender', 'supermoto-headlight-mask']) {
      const part = bike.body.getObjectByName(name) as Mesh;
      const p = part.geometry.getAttribute('position'), face = p.count / 2;
      for (let i = 0; i < face; i++) {
        const front = new Vector3().fromBufferAttribute(p, i);
        const back = new Vector3().fromBufferAttribute(p, i + face);
        expect(front.distanceTo(back)).toBeCloseTo(name === 'supermoto-tail-fender' ? 0.007 : 0.004, 6);
      }
      expect(part.geometry.index!.count).toBeGreaterThan((face - 1) * 6);
    }
    for (const name of ['radiator-shroud', 'supermoto-side-cover']) {
      const panels = bike.body.getObjectsByProperty('name', name) as Mesh[];
      expect(panels).toHaveLength(2);
      for (const panel of panels) {
        const p = panel.geometry.getAttribute('position');
        for (let i = 0; i < p.count / 2; i++) {
          expect(Math.abs(p.getX(i) - p.getX(i + p.count / 2))).toBeCloseTo(0.004, 6);
        }
      }
    }
  });

  it('mounts the actual rear damper at 45 degrees leaning toward the steering head', () => {
    const damper = bike.body.getObjectByName('supermoto-shock-damper') as Mesh;
    const axis = new Vector3(0, 1, 0).applyQuaternion(damper.quaternion);
    expect(Math.abs(axis.x)).toBeLessThan(1e-6);
    expect(Math.abs(axis.y)).toBeCloseTo(Math.SQRT1_2, 6);
    expect(Math.abs(axis.z)).toBeCloseTo(Math.SQRT1_2, 6);
    expect(axis.y * axis.z).toBeLessThan(0);
    expect(bike.body.getObjectsByProperty('name', 'supermoto-shock-eyelet')).toHaveLength(2);
    expect(bike.body.getObjectsByProperty('name', 'supermoto-shock-spring-seat')).toHaveLength(2);
  });

  it('keeps the rising saddle supported by the real rear-fender surface', () => {
    const finish = new MeshBasicMaterial({ side: DoubleSide });
    const probes = ['supermoto-seat', 'supermoto-tail-fender'].map(name => {
      const source = bike.body.getObjectByName(name) as Mesh;
      const probe = new Mesh(source.geometry, finish);
      probe.matrixWorld.copy(source.matrixWorld);
      return probe;
    });
    try {
      for (const z of [0.20, 0.30, 0.40, 0.50, 0.60, 0.68]) {
        const origin = bike.body.localToWorld(new Vector3(0, 1.3, z));
        const direction = new Vector3(0, -1, 0).transformDirection(bike.body.matrixWorld);
        const ray = new Raycaster(origin, direction);
        const [seat, fender] = probes.map(probe => ray.intersectObject(probe, false)
          .map(hit => bike.body.worldToLocal(hit.point.clone()).y));
        expect(seat.length).toBeGreaterThan(1);
        expect(fender.length).toBeGreaterThan(1);
        const roof = Math.max(...fender), bottom = Math.min(...seat);
        // Allow a small upholstery seam, but no floating saddle or a fender
        // pushed through the seating surface after either profile is changed.
        expect(bottom - roof).toBeLessThanOrEqual(0.008);
        expect(bottom - roof).toBeGreaterThanOrEqual(-0.012);
        expect(Math.max(...seat) - roof).toBeGreaterThan(0.005);
      }
    } finally {
      finish.dispose();
    }
  });

  it('joins the radiator and shock supports to actual frame geometry on both sides', () => {
    const finish = new MeshBasicMaterial({ side: DoubleSide });
    const probes = new Map<Mesh, Mesh>();
    const triangles = new Map<Mesh, Triangle[]>();
    const pointGap = (point: Vector3, target: Mesh) => {
      let probe = probes.get(target);
      if (!probe) {
        probe = new Mesh(target.geometry, finish);
        probe.matrixWorld.copy(target.matrixWorld);
        probes.set(target, probe);
      }
      // An endpoint may be welded inside a tube. Count distinct surfaces so
      // two coplanar triangles at the same hit do not change inside/outside.
      const ray = new Raycaster(point, new Vector3(0.713, 0.219, 0.665).normalize());
      const distances = ray.intersectObject(probe, false).map(hit => hit.distance)
        .filter((distance, i, all) => i === 0 || distance - all[i - 1] > 1e-6);
      if (distances.length % 2) return 0;
      let faces = triangles.get(target);
      if (!faces) {
        const p = target.geometry.getAttribute('position'), ix = target.geometry.getIndex();
        faces = [];
        for (let i = 0; i < (ix?.count ?? p.count); i += 3) {
          const vertices = [0, 1, 2].map(k => new Vector3()
            .fromBufferAttribute(p, ix ? ix.getX(i + k) : i + k).applyMatrix4(target.matrixWorld));
          faces.push(new Triangle(vertices[0], vertices[1], vertices[2]));
        }
        triangles.set(target, faces);
      }
      const nearest = new Vector3();
      return Math.min(...faces.map(face => face.closestPointToPoint(point, nearest).distanceTo(point)));
    };
    try {
      for (const [name, startName, endName, count] of [
        ['radiator-frame-mount', 'supermoto-frame-main-spar', 'radiator-core', 2],
        ['supermoto-under-seat-frame-rail', 'supermoto-frame-main-spar', 'supermoto-upper-subframe', 2],
        ['supermoto-shock-bridge-support', 'shock-frame-crossmember', 'supermoto-upper-subframe', 2],
        ['shock-upper-mount', 'shock-frame-crossmember', 'supermoto-shock-damper', 1],
      ] as const) {
        const connectors = bike.body.getObjectsByProperty('name', name) as Mesh[];
        expect(connectors).toHaveLength(count);
        for (const connector of connectors) {
          expect(connector.geometry).toBeInstanceOf(CylinderGeometry);
          const parameters = (connector.geometry as CylinderGeometry).parameters;
          const radius = Math.max(parameters.radiusTop, parameters.radiusBottom)
            * connector.matrixWorld.getMaxScaleOnAxis();
          for (const [y, targetName] of [[-parameters.height / 2, startName], [parameters.height / 2, endName]] as const) {
            const point = new Vector3(0, y, 0).applyMatrix4(connector.matrixWorld);
            const targets = bike.body.getObjectsByProperty('name', targetName) as Mesh[];
            expect(targets.length).toBeGreaterThan(0);
            const gap = Math.min(...targets.map(target => pointGap(point, target)));
            expect(gap, `${name} must meet ${targetName}`).toBeLessThanOrEqual(radius + 1e-5);
          }
        }
      }
    } finally {
      finish.dispose();
    }
  });

  it('keeps the handlebar and clamps behind the actual front-mask surface', () => {
    const mask = bike.body.getObjectByName('supermoto-headlight-mask') as Mesh;
    const finish = new MeshBasicMaterial({ side: DoubleSide });
    const probe = new Mesh(mask.geometry, finish);
    probe.matrixWorld.copy(mask.matrixWorld);
    const direction = new Vector3(0, 0, 1).transformDirection(bike.body.matrixWorld);
    let samples = 0;
    try {
      for (const name of ['supermoto-handlebar', 'handlebar-clamp', 'handlebar-stem']) {
        const parts = bike.body.getObjectsByProperty('name', name) as Mesh[];
        expect(parts.length).toBeGreaterThan(0);
        let minimumGap = Infinity;
        for (const part of parts) {
          const positions = part.geometry.getAttribute('position');
          for (let i = 0; i < positions.count; i++) {
            const point = new Vector3().fromBufferAttribute(positions, i).applyMatrix4(part.matrixWorld);
            const local = bike.body.worldToLocal(point.clone());
            const origin = bike.body.localToWorld(new Vector3(local.x, local.y, -2));
            const hits = new Raycaster(origin, direction).intersectObject(probe, false);
            if (!hits.length) continue;
            const back = Math.max(...hits.map(hit => bike.body.worldToLocal(hit.point.clone()).z));
            minimumGap = Math.min(minimumGap, local.z - back);
            samples++;
          }
        }
        expect(minimumGap, `${name} must stay at least 1 mm behind the mask`).toBeGreaterThanOrEqual(0.001);
      }
      expect(samples).toBeGreaterThan(20);
    } finally {
      finish.dispose();
    }
  });

  it('keeps the visible tank black and the rear blade above its tyre without a plate carrier', () => {
    const tank = bike.body.getObjectByName('supermoto-fuel-tank') as Mesh;
    expect((tank.material as MeshStandardMaterial).color.getHexString()).toBe('101214');
    // Several samples of the round black volume must remain visible between
    // the upper crown and side-plastic seams, rather than hiding the whole tank.
    const shells = ['supermoto-fuel-tank', 'radiator-shroud', 'shroud-shoulder',
      'supermoto-side-cover', 'supermoto-airbox-access-panel', 'supermoto-airbox', 'supermoto-seat']
      .flatMap(name => bike.body.getObjectsByProperty('name', name));
    let tankSamples = 0;
    for (let y = 0.86; y <= 1.02; y += 0.02) for (let z = -0.34; z < 0.16; z += 0.025) {
      const start = bike.body.localToWorld(new Vector3(0.8, y, z));
      const hit = new Raycaster(start, new Vector3(-1, 0, 0)).intersectObjects(shells, false)[0];
      if (hit?.object === tank) tankSamples++;
    }
    expect(tankSamples).toBeGreaterThan(5);
    const tail = bike.body.getObjectByName('supermoto-tail-fender') as Mesh;
    const bounds = new Box3().setFromObject(tail);
    const wheelBounds = new Box3().setFromObject(bike.wheels[1]);
    expect(bounds.min.y).toBeGreaterThan(wheelBounds.max.y + 0.05);
    expect(bike.body.getObjectByName('supermoto-tail-light-lens')).toBeDefined();
    expect(bike.body.getObjectByName('supermoto-number-plate-carrier')).toBeUndefined();
  });
});
