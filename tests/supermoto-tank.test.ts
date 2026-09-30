import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CylinderGeometry,
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
    bike = makeBike({ ...newPlayer(), bike: '450' }, []);
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
      const g = guard.geometry as CylinderGeometry;
      expect(g.parameters.openEnded).toBe(true);
      expect(g.parameters.thetaLength).toBeLessThan(Math.PI * 1.5);
      expect(g.parameters.height).toBeGreaterThan(0.4);
      const p = g.getAttribute('position');
      let checked = 0;
      for (let i = 0; i <= g.parameters.radialSegments; i++)
        for (const t of [0.2, 0.4, 0.6, 0.8]) {
          const point = new Vector3()
            .fromBufferAttribute(p, i)
            .lerp(
              new Vector3().fromBufferAttribute(
                p,
                i + g.parameters.radialSegments + 1,
              ),
              t,
            )
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
