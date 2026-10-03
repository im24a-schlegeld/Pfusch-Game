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

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

describe('exposed Supermoto tank and rounded shrouds', () => {
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
      for (const y of [0.85, 0.865, 0.88, 0.895])
        for (const z of [-0.12, -0.08, -0.04, 0, 0.04]) {
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

  it('rounds the shoulder in real geometry, with no disconnected cover strip', () => {
    expect(bike.body.getObjectByName('shroud-shoulder')).toBeUndefined();
    for (const side of [-1, 1]) {
      const shroud = (
        bike.body.getObjectsByProperty('name', 'radiator-shroud') as Mesh[]
      ).find((p) => p.geometry.getAttribute('position').getX(0) * side > 0)!;
      const ray = (x: number) => {
        // Sample the remaining front shoulder; z=-0.2 now belongs to the
        // requested open tank recess and is checked separately below.
        const start = bike.body.localToWorld(new Vector3(side * x, 1.2, -0.355));
        const direction = new Vector3(0, -1, 0).transformDirection(
          bike.body.matrixWorld,
        );
        return new Raycaster(start, direction)
          .intersectObject(shroud, false)
          .map((hit) => bike.body.worldToLocal(hit.point.clone()).y);
      };
      const a = Math.max(...ray(0.11)),
        b = Math.max(...ray(0.14)),
        c = Math.max(...ray(0.165));
      expect([a, b, c].every(Number.isFinite)).toBe(true);
      expect(a).toBeGreaterThan(b);
      expect(b).toBeGreaterThan(c);
      // A plane would have the same slope. The shoulder rolls increasingly
      // steeply down to the side face, as in the marked reference area.
      expect((b - c) / 0.025).toBeGreaterThan(((a - b) / 0.03) * 1.5);
    }
  });

  it('covers the EXC lower radiator fin and wider upper band while retaining a thin closed shell', () => {
    for (const side of [-1, 1]) {
      const shroud = (bike.body.getObjectsByProperty('name', 'radiator-shroud') as Mesh[])
        .find(part => part.geometry.getAttribute('position').getX(0) * side > 0)!;
      for (const [y, z] of [[0.660, -0.315], [0.710, -0.360], [0.850, -0.430],
        [0.725, -0.222], [0.775, -0.190], [0.955, 0.025]]) {
        const origin = bike.body.localToWorld(new Vector3(side * 0.8, y, z));
        const direction = new Vector3(-side, 0, 0).transformDirection(bike.body.matrixWorld);
        const hit = new Raycaster(origin, direction).intersectObject(shroud, false)[0];
        expect(hit, `EXC plastic coverage at ${side}/${y}/${z}`).toBeDefined();
      }
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
      for (const y of [0.975, 0.985]) for (const z of [-0.29, -0.265, -0.24]) {
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
