import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CylinderGeometry, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';
import { envelope, faces, gap, triangleGap } from './helpers/solidClearance';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

describe('formed EXC fork protectors', () => {
  let bike: ReturnType<typeof makeBike>;
  beforeAll(() => {
    bike = makeBike({ ...newPlayer(), bike: '450', paint: '#879052' }, []);
    bike.root.updateMatrixWorld(true);
  });

  it('retains bounded closed skin topology, rounded shoulders and lower fastenings', () => {
    const guards = bike.body.getObjectsByProperty('name', 'open-back-fork-guard') as Mesh[];
    expect(guards).toHaveLength(2);
    for (const guard of guards) {
      expect(guard.parent?.name).toBe('front-suspension-axle');
      const p = guard.geometry.getAttribute('position'), index = guard.geometry.getIndex()!;
      expect(p.count).toBeLessThan(2000);
      const edges = new Map<string, number>();
      for (let i = 0; i < index.count; i += 3) for (let k = 0; k < 3; k++) {
        const a = index.getX(i + k), b = index.getX(i + (k + 1) % 3);
        const key = a < b ? `${a}/${b}` : `${b}/${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
      expect([...edges.values()].every(count => count === 2)).toBe(true);
      const highCentre: number[] = [], highSide: number[] = [];
      for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.15) {
        if (Math.abs(p.getX(i)) < 0.005) highCentre.push(p.getY(i));
        if (Math.abs(p.getX(i)) > 0.030) highSide.push(p.getY(i));
      }
      expect(Math.max(...highCentre) - Math.max(...highSide)).toBeGreaterThan(0.008);
      const bosses = guard.getObjectsByProperty('name', 'supermoto-fork-guard-boss') as Mesh<CylinderGeometry>[];
      expect(bosses).toHaveLength(2);
      for (const boss of bosses) {
        const end = new Vector3(0, boss.geometry.parameters.height / 2, 0)
          .applyQuaternion(boss.quaternion).add(boss.position);
        // Inner end enters the 21 mm slider surface, not an unsupported shell.
        expect(Math.hypot(end.x, end.z)).toBeLessThan(0.021);
        const shell = new Mesh(guard.geometry, guard.material);
        const front = new Raycaster(new Vector3(0, boss.position.y, -0.1), new Vector3(0, 0, 1))
          .intersectObject(shell, false)[0];
        expect(front).toBeDefined();
        expect(Math.abs(front.point.z + 0.038), 'boss reaches moulded front paddle').toBeLessThan(0.003);
      }
    }
  });

  it('clears the complete tyre, rotor and fork solids over travel while bosses stay on the slider', () => {
    const guards = bike.body.getObjectsByProperty('name', 'open-back-fork-guard') as Mesh[];
    const tire = bike.wheels[0].getObjectByName('tire') as Mesh;
    const disc = bike.wheels[0].getObjectByName('front-brake-disc') as Mesh;
    const forks = ['telescopic-fork-slider', 'fork-stanchion']
      .flatMap(name => bike.body.getObjectsByProperty('name', name)) as Mesh[];
    for (const [pitch, travel] of [[0, -0.025], [0, 0], [0, 0.12], [0.68, 0.05], [1.1, 0]]) {
      bike.animateSuspension(pitch, travel);
      bike.root.updateMatrixWorld(true);
      const inverse = bike.body.matrixWorld.clone().invert();
      for (const guard of guards) {
        const shellFaces = faces(guard, inverse);
        const shellBounds = envelope(guard, inverse);
        for (const [part, required] of [[tire, 0.005], [disc, 0.003],
          ...forks.map(fork => [fork, 0.001] as const)] as const) {
          const partBounds = envelope(part, inverse);
          if (gap(shellBounds, partBounds) > required) continue;
          const sourceFaces = shellFaces.filter(face => gap(face.bounds, partBounds) <= required);
          const targetFaces = faces(part, inverse).filter(face => gap(face.bounds, shellBounds) <= required);
          let minimum = Infinity, at = '';
          for (const a of sourceFaces) for (const b of targetFaces) {
            if (gap(a.bounds, b.bounds) > required) continue;
            const distance = triangleGap(a.triangle, b.triangle);
            if (distance < minimum) {
              minimum = distance;
              at = guard.worldToLocal(a.triangle.getMidpoint(new Vector3()).applyMatrix4(bike.body.matrixWorld)).toArray().join(',');
            }
          }
          expect(minimum, `${part.name}, pitch ${pitch}, travel ${travel}, guard ${at}`)
            .toBeGreaterThan(required);
        }
        const side = Math.sign(guard.position.x);
        const slider = forks.find(part => part.name === 'telescopic-fork-slider'
          && Math.sign(part.position.x) === side)! as Mesh<CylinderGeometry>;
        for (const boss of guard.getObjectsByProperty('name', 'supermoto-fork-guard-boss') as Mesh<CylinderGeometry>[]) {
          const end = new Vector3(0, boss.geometry.parameters.height / 2, 0)
            .applyMatrix4(boss.matrixWorld);
          slider.worldToLocal(end);
          expect(Math.hypot(end.x, end.z), 'boss remains attached through travel').toBeLessThan(0.021);
        }
      }
    }
    bike.animateSuspension(0, 0);
  });
});
