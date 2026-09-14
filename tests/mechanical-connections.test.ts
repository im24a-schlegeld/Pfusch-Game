import { describe, expect, it, vi } from 'vitest';
import { Box3, Line3, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { CylinderGeometry } from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';

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
    result.add(new Vector3().fromBufferAttribute(vertices, ring * (sides + 1) + i));
  return result.divideScalar(sides);
}

describe('assembled motorcycle connections', () => {
  it.each(['125', '450', '701'] as const)(
    '%s joins both fork legs with coaxial yokes, bearings and a frame head',
    (bikeId) => {
      const bike = makeBike({ ...newPlayer(), bike: bikeId }, []);
      const forks = bike.body.getObjectsByProperty('name', 'telescopic-fork-slider') as Mesh[];
      const yokes = bike.body.getObjectsByProperty('name', 'fork-yoke') as Mesh[];
      expect(forks).toHaveLength(2);
      expect(yokes).toHaveLength(2);
      expect(bike.body.getObjectsByProperty('name', 'steering-head')).toHaveLength(1);
      const nearest = new Vector3();
      for (const yoke of yokes) {
        const endpoints = rodAxis(yoke);
        for (const end of [endpoints.start, endpoints.end]) {
          const fork = forks.find((part) => Math.sign(part.position.x) === Math.sign(end.x))!;
          rodAxis(fork).closestPointToPoint(end, true, nearest);
          expect(nearest.distanceTo(end)).toBeLessThan(1e-6);
        }
      }
      const head = rodAxis(bike.body.getObjectByName('steering-head') as Mesh);
      for (const bearing of bike.body.getObjectsByProperty('name', 'steering-head-bearing') as Mesh[]) {
        const center = rodAxis(bearing).getCenter(new Vector3());
        head.closestPointToPoint(center, true, nearest);
        expect(nearest.distanceTo(center)).toBeLessThan(1e-6);
      }
      // A yoke may not substitute for/relocate a wheel or stretch the fork.
      expect(bike.wheels[0].position.z).toBe(bikeId === '125' ? -0.7 : bikeId === '450' ? -0.77 : -0.72);
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
    expect(new Box3().setFromObject(stem).intersectsBox(new Box3().setFromObject(bike.body.getObjectByName('steering-head')!))).toBe(true);
    expect(bike.body.getObjectsByProperty('name', 'headlamp-bracket')).toHaveLength(2);
    expect(bike.body.getObjectsByProperty('name', 'rack-frame-mount')).toHaveLength(2);
    expect(bike.body.getObjectsByProperty('name', 'rack-crossbar')).toHaveLength(4);
    expect(bike.body.getObjectByName('moped-drive-belt')).toBeDefined();
    expect(bike.body.getObjectByName('left-drive-chain')).toBeUndefined();
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
      expect(start.y).toBeGreaterThan(bikeId === '450' ? 0.7 : bikeId === '701' ? 0.35 : 0.27);
      expect(start.z).toBeLessThan(-0.14);
      expect(bike.body.getObjectByName('exhaust-frame-hanger')).toBeDefined();
      expect(bike.body.getObjectByName('exhaust-mount-band')).toBeDefined();
      if (bikeId === '701') {
        const headers = bike.body.getObjectsByProperty('name', 'four-cylinder-exhaust-header') as Mesh[];
        expect(headers).toHaveLength(4);
        for (const header of headers)
          expect(ringCenter(header, 18, 10).distanceTo(start)).toBeLessThan(1e-6);
      }
    },
  );
});
