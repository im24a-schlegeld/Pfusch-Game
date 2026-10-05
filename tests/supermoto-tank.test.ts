import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  Box3,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Vector3,
} from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';
import { SUPERMOTO_FUEL_CAP_MOUNT } from '../app/game/supermotoTank';
import { envelope, faces, gap, triangleGap } from './helpers/solidClearance';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

describe('exposed Supermoto tank and reference-shaped shrouds', () => {
  let bike: ReturnType<typeof makeBike>;
  beforeAll(() => {
    bike = makeBike({ ...newPlayer(), bike: '450', paint: '#879052' }, []);
    bike.root.updateMatrixWorld(true);
  }, 30000);

  it('exposes a continuous black reservoir on both sides below the painted upper wing', () => {
    const tank = bike.body.getObjectByName('supermoto-fuel-tank') as Mesh;
    expect((tank.material as MeshStandardMaterial).color.getHexString()).toBe(
      '101214',
    );
    for (const side of [-1, 1]) {
      let exposed = 0,
        probes = 0;
      for (const y of [0.845, 0.86, 0.875, 0.890])
        for (const z of [-0.22, -0.18, -0.14, -0.10, -0.06]) {
          const origin = bike.body.localToWorld(new Vector3(side * 0.8, y, z));
          const direction = new Vector3(-side, 0, 0).transformDirection(
            bike.body.matrixWorld,
          );
          const hit = new Raycaster(origin, direction)
            .intersectObject(bike.body, true)
            .find((hit) => {
              for (let part = hit.object; part; part = part.parent!)
                if (part === bike.rider) return false;
              return true;
            });
          probes++;
          if (hit?.object === tank) exposed++;
        }
      expect(
        exposed / probes,
        `Tank visibility on side ${side}`,
      ).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('removes the broad tank shelves while retaining a small rounded return on the side band', () => {
    expect(bike.body.getObjectByName('shroud-shoulder')).toBeUndefined();
    for (const side of [-1, 1]) {
      const shroud = (
        bike.body.getObjectsByProperty('name', 'radiator-shroud') as Mesh[]
      ).find((p) => p.geometry.getAttribute('position').getX(0) * side > 0)!;
      const ray = (x: number, z: number) => {
        const start = bike.body.localToWorld(new Vector3(side * x, 1.2, z));
        const direction = new Vector3(0, -1, 0).transformDirection(
          bike.body.matrixWorld,
        );
        return new Raycaster(start, direction)
          .intersectObject(shroud, false)
          .map((hit) => bike.body.worldToLocal(hit.point.clone()).y);
      };
      // These rays formerly hit the painted wrap around both tank flanks.
      // The thin green side bridge remains, but those broad caps are gone.
      for (const [x, z] of [[0.11, -0.355], [0.14, -0.355],
        [0.11, -0.08], [0.105, 0.1]]) expect(ray(x, z)).toHaveLength(0);
      const inner = Math.max(...ray(0.166, -0.355)),
        outer = Math.max(...ray(0.170, -0.355));
      expect([inner, outer].every(Number.isFinite)).toBe(true);
      expect(inner - outer).toBeGreaterThan(0.001);
      expect(inner - outer).toBeLessThan(0.004);
    }
  });

  it('supports the cap on the lower front neck above a compact trapezoid reservoir', () => {
    const tank = bike.body.getObjectByName('supermoto-fuel-tank') as Mesh;
    const roof = (z: number, x = 0) => {
      const origin = bike.body.localToWorld(new Vector3(x, 1.3, z));
      const direction = new Vector3(0, -1, 0).transformDirection(bike.body.matrixWorld);
      const hit = new Raycaster(origin, direction).intersectObject(tank, false)[0];
      return bike.body.worldToLocal(hit.point.clone()).y;
    };
    expect(roof(-0.299)).toBeGreaterThan(1.05);
    expect(roof(-0.299)).toBeLessThan(1.065);
    for (let i = 0; i < 16; i++) {
      const angle = i / 16 * Math.PI * 2;
      const support = roof(-0.299 + Math.cos(angle) * 0.027, Math.sin(angle) * 0.027);
      expect(support).toBeGreaterThan(SUPERMOTO_FUEL_CAP_MOUNT[1]);
      expect(support - SUPERMOTO_FUEL_CAP_MOUNT[1]).toBeLessThan(0.002);
    }
    expect(roof(-0.220)).toBeLessThan(1.011);
    expect(roof(-0.085)).toBeGreaterThan(0.948);
    expect(roof(-0.085)).toBeLessThan(0.97);
    const position = tank.geometry.getAttribute('position');
    let floor = Infinity;
    for (let i = 0; i < position.count; i++) floor = Math.min(floor, position.getY(i));
    expect(floor).toBeGreaterThanOrEqual(0.798 - 0.0001);
    for (const side of [-1, 1]) {
      const origin = bike.body.localToWorld(new Vector3(side * 0.8, 0.86, -0.085));
      const direction = new Vector3(-side, 0, 0).transformDirection(bike.body.matrixWorld);
      const hit = new Raycaster(origin, direction).intersectObject(tank, false)[0];
      // The vertical lower flank remains substantial just above the engine,
      // without extending the original tank floor down into the cylinder.
      expect(Math.abs(bike.body.worldToLocal(hit.point.clone()).x)).toBeGreaterThan(0.13);
    }
  });

  it('keeps the complete raised tank surface separate from the handlebar stem', () => {
    const inverse = bike.body.matrixWorld.clone().invert();
    const tank = faces(bike.body.getObjectByName('supermoto-fuel-tank') as Mesh, inverse);
    const stem = bike.body.getObjectByName('handlebar-stem') as Mesh;
    const stemFaces = faces(stem, inverse), stemBounds = envelope(stem, inverse);
    let checked = 0;
    for (const face of tank) {
      if (face.triangle.getArea() < 1e-12 || gap(face.bounds, stemBounds) > 0.001) continue;
      for (const other of stemFaces) {
        if (other.triangle.getArea() < 1e-12 || gap(face.bounds, other.bounds) > 0.001) continue;
        // The unchanged front tank edge is close to the stem. Test actual
        // triangle separation so a raised skin cannot cut through it.
        expect(triangleGap(face.triangle, other.triangle)).toBeGreaterThan(0.000001);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('uses a short front tongue and straight side blade instead of the old deep triangular fin', () => {
    for (const side of [-1, 1]) {
      const shroud = (bike.body.getObjectsByProperty('name', 'radiator-shroud') as Mesh[])
        .find(part => part.geometry.getAttribute('position').getX(0) * side > 0)!;
      for (const [y, z] of [[0.773, -0.365], [0.850, -0.390], [0.940, -0.460],
        [0.920, -0.222], [0.925, -0.110], [0.930, 0.025]]) {
        const origin = bike.body.localToWorld(new Vector3(side * 0.8, y, z));
        const direction = new Vector3(-side, 0, 0).transformDirection(bike.body.matrixWorld);
        const hit = new Raycaster(origin, direction).intersectObject(shroud, false)[0];
        expect(hit, `EXC plastic coverage at ${side}/${y}/${z}`).toBeDefined();
      }
      const origin = bike.body.localToWorld(new Vector3(side * 0.8, 0.68, -0.315));
      const direction = new Vector3(-side, 0, 0).transformDirection(bike.body.matrixWorld);
      expect(new Raycaster(origin, direction).intersectObject(shroud, false)).toHaveLength(0);
      const geometry = shroud.geometry, index = geometry.getIndex()!;
      const edges = new Map<string, number>();
      for (let i = 0; i < index.count; i += 3) for (let k = 0; k < 3; k++) {
        const a = index.getX(i + k), b = index.getX(i + (k + 1) % 3);
        const key = a < b ? `${a}/${b}` : `${b}/${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
      expect([...edges.values()].every(count => count === 2)).toBe(true);
    }
  });

  it('keeps every enlarged shroud triangle at least 8 mm from the unchanged hot header', () => {
    const inverse = bike.body.matrixWorld.clone().invert();
    const triangles = (mesh: Mesh) => {
      const transform = inverse.clone().multiply(mesh.matrixWorld);
      const position = mesh.geometry.getAttribute('position'), index = mesh.geometry.getIndex();
      const result: Box3[] = [];
      for (let i = 0; i < (index?.count ?? position.count); i += 3) {
        const bounds = new Box3();
        for (let k = 0; k < 3; k++) bounds.expandByPoint(new Vector3()
          .fromBufferAttribute(position, index ? index.getX(i + k) : i + k).applyMatrix4(transform));
        result.push(bounds);
      }
      return result;
    };
    const distance = (a: Box3, b: Box3) => Math.hypot(
      Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x),
      Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y),
      Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z),
    );
    const header = triangles(bike.body.getObjectByName('connected-exhaust-pipe') as Mesh);
    const headerBounds = header.reduce((result, box) => result.union(box), new Box3());
    for (const shroud of bike.body.getObjectsByProperty('name', 'radiator-shroud') as Mesh[]) {
      for (const face of triangles(shroud)) {
        if (distance(face, headerBounds) > 0.008) continue;
        // Positive separation of each transformed triangle box proves the
        // complete hot/cold surfaces clear, including triangle interiors.
        let minimum = Infinity;
        for (const pipe of header) minimum = Math.min(minimum, distance(face, pipe));
        expect(minimum).toBeGreaterThan(0.008);
      }
    }
  });

  it('shows the real black tank through the upper shoulder opening beside the seat nose', () => {
    const tank = bike.body.getObjectByName('supermoto-fuel-tank') as Mesh;
    const direction = new Vector3(0, -1, 0).transformDirection(bike.body.matrixWorld);
    for (const side of [-1, 1]) {
      let visible = 0;
      for (const x of [0.105, 0.115]) for (const z of [-0.29, -0.25, -0.21]) {
        const origin = bike.body.localToWorld(new Vector3(side * x, 1.2, z));
        const hit = new Raycaster(origin, direction).intersectObject(bike.body, true)
          .find(hit => {
            for (let part = hit.object; part; part = part.parent!)
              if (part === bike.rider) return false;
            return true;
          });
        if (hit?.object === tank) visible++;
      }
      expect(visible, `Black upper tank opening on side ${side}`).toBeGreaterThanOrEqual(5);
      let sideVisible = 0;
      const sideHits: string[] = [];
      for (const y of [0.990, 1.005]) for (const z of [-0.29, -0.265, -0.24]) {
        const origin = bike.body.localToWorld(new Vector3(side * 0.8, y, z));
        const sideDirection = new Vector3(-side, 0, 0).transformDirection(bike.body.matrixWorld);
        const hit = new Raycaster(origin, sideDirection).intersectObject(bike.body, true)
          .find(hit => {
            for (let part = hit.object; part; part = part.parent!)
              if (part === bike.rider) return false;
            return true;
          });
        if (hit?.object === tank) sideVisible++;
        else sideHits.push(`${y},${z}:${hit?.object.name}`);
      }
      expect(sideVisible, `Upper tank must also show from the side ${side} (${sideHits.join('; ')})`).toBeGreaterThanOrEqual(5);
    }
  });

  it('keeps the larger fork protectors open behind the slider and away from the tyre', () => {
    const guards = bike.body.getObjectsByProperty(
      'name',
      'open-back-fork-guard',
    ) as Mesh[];
    expect(guards).toHaveLength(2);
    const tire = bike.wheels[0].getObjectByName('tire')!;
    for (const guard of guards) {
      const g = guard.geometry;
      g.computeBoundingBox();
      expect(g.boundingBox!.max.y - g.boundingBox!.min.y).toBeGreaterThan(0.4);
      expect((guard.material as MeshStandardMaterial).color.getHexString()).toBe('879052');
      const localGuard = new Mesh(g, new MeshStandardMaterial({ side: DoubleSide }));
      // A longitudinal ray behind the slider sees no closure at either end;
      // the matching ray in front hits the actual moulded shell.
      expect(new Raycaster(new Vector3(0, -0.3, 0.025), new Vector3(0, 1, 0))
        .intersectObject(localGuard, false)).toHaveLength(0);
      expect(new Raycaster(new Vector3(0, 0, -0.1), new Vector3(0, 0, 1))
        .intersectObject(localGuard, false).length).toBeGreaterThan(1);
      localGuard.material.dispose();
      const p = g.getAttribute('position');
      let checked = 0;
      for (let i = 0; i < p.count; i++) {
          const point = new Vector3()
            .fromBufferAttribute(p, i)
            .applyMatrix4(guard.matrixWorld);
          const local = bike.body.worldToLocal(point.clone()),
            side = Math.sign(local.x);
          const origin = bike.body.localToWorld(
            new Vector3(side * 0.8, local.y, local.z),
          );
          const direction = new Vector3(-side, 0, 0).transformDirection(
            bike.body.matrixWorld,
          );
          const hit = new Raycaster(origin, direction).intersectObject(
            tire,
            false,
          )[0];
          if (!hit) continue;
          const gap =
            side * (local.x - bike.body.worldToLocal(hit.point.clone()).x);
          expect(gap).toBeGreaterThan(0.005);
          checked++;
        }
      expect(checked).toBeGreaterThan(4);
    }
  });
});
