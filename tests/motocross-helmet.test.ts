import { describe, expect, it, vi } from 'vitest';
import { Box3, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { createMotocrossHelmet } from '../app/game/motocrossHelmet';
import { makeBike } from '../app/game/vehicle';
import { newPlayer } from '../app/domain/progression';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

const ray = (x: number, y: number) =>
  new Raycaster(new Vector3(x, y, -1), new Vector3(0, 0, 1));

describe('independent motocross equipment geometry', () => {
  it.each(['125', 'scooter', '450', '701'] as const)(
    '%s mounts and animates both helmet styles on the same unchanged head',
    (bike) => {
      const player = { ...newPlayer(), bike, helmetColor: '#b8ce47' };
      const fullface = makeBike({ ...player, helmet: 'fullface' }, []);
      const motocross = makeBike({ ...player, helmet: 'motocross' }, []);
      const original = fullface.rider.getObjectByName('full-face-helmet')!;
      const helmet = motocross.rider.getObjectByName(
        'motocross-helmet',
      ) as Mesh;
      expect(
        motocross.rider.getObjectByName('full-face-helmet'),
      ).toBeUndefined();
      expect(helmet.scale.toArray()).toEqual([1.065, 1.065, 1.065]);
      expect(
        (helmet.material as MeshStandardMaterial[])[0].color.getHexString(),
      ).toBe('b8ce47');
      const sameHead = () => {
        expect(helmet.position.toArray()).toEqual(original.position.toArray());
        expect(helmet.rotation.toArray()).toEqual(original.rotation.toArray());
        expect(helmet.scale.toArray()).toEqual(original.scale.toArray());
      };
      sameHead();
      for (let i = 0; i < 30; i++) {
        const target = { wheelie: 0.7, steer: -0.25, landing: 0.15 };
        fullface.animateRider(target, 1 / 60);
        motocross.animateRider(target, 1 / 60);
        sameHead();
      }
    },
  );
  it('retains the caller contract and adult cranium bounds with finite indexed surfaces', () => {
    const helmet = createMotocrossHelmet('#b8ce47');
    expect(helmet.name).toBe('motocross-helmet');
    expect(helmet.userData.helmetStyle).toBe('motocross');
    expect(helmet.material[0].color.getHexString()).toBe('b8ce47');
    expect(helmet.scale.toArray()).toEqual([1, 1, 1]);
    helmet.geometry.computeBoundingBox();
    const bounds = helmet.geometry.boundingBox!;
    expect(Math.max(Math.abs(bounds.min.x), bounds.max.x)).toBeLessThanOrEqual(
      0.1271,
    );
    expect(bounds.max.y).toBeCloseTo(0.154, 5);
    expect(bounds.max.z).toBeLessThanOrEqual(0.16);
    expect(bounds.min.z).toBeLessThan(-0.21);
    helmet.traverse((part) => {
      if (!(part instanceof Mesh)) return;
      const position = part.geometry.getAttribute('position');
      expect([...position.array].every(Number.isFinite), part.name).toBe(true);
      const index = part.geometry.getIndex();
      if (index)
        for (const vertex of index.array)
          expect(vertex).toBeLessThan(position.count);
      const normals = part.geometry.getAttribute('normal');
      expect([...normals.array].every(Number.isFinite), part.name).toBe(true);
    });
  });

  it('has a real open eye aperture through the shell, while crown and chin remain solid', () => {
    const helmet = createMotocrossHelmet('#202324');
    helmet.updateMatrixWorld(true);
    for (const [x, y] of [
      [0, 0],
      [-0.08, 0],
      [0.08, 0],
      [0, 0.042],
    ]) {
      const hits = ray(x, y).intersectObject(helmet, false);
      expect(hits.length).toBeGreaterThan(0);
      // The ray must reach the far inner shell; a visor-colored face covering
      // the opening would be hit first at negative Z and fail this check.
      expect(hits[0].point.z).toBeGreaterThan(0.03);
    }
    for (const [x, y] of [
      [0, 0.11],
      [0.05, -0.102],
    ]) {
      const hits = ray(x, y).intersectObject(helmet, false);
      expect(hits[0]?.point.z).toBeLessThan(-0.08);
    }
    const chinVent = ray(0, -0.129).intersectObject(helmet, false);
    expect(chinVent[0]?.point.z).toBeGreaterThan(0);
  });

  it('keeps the shell and projecting chin one connected thick surface', () => {
    const geometry = createMotocrossHelmet('#d7dbd7').geometry;
    const index = geometry.getIndex()!;
    const neighbors = Array.from(
      { length: geometry.getAttribute('position').count },
      () => new Set<number>(),
    );
    for (let i = 0; i < index.count; i += 3)
      for (let j = 0; j < 3; j++) {
        const a = index.getX(i + j),
          b = index.getX(i + ((j + 1) % 3));
        neighbors[a].add(b);
        neighbors[b].add(a);
      }
    const seen = new Set<number>(),
      pending = [index.getX(0)];
    while (pending.length) {
      const vertex = pending.pop()!;
      if (seen.has(vertex)) continue;
      seen.add(vertex);
      for (const next of neighbors[vertex])
        if (!seen.has(next)) pending.push(next);
    }
    expect(seen.size).toBe(neighbors.length);
  });

  it('fits a separate convex lens with a nose notch inside an open goggle frame', () => {
    const helmet = createMotocrossHelmet('#202324');
    helmet.updateMatrixWorld(true);
    const lens = helmet.getObjectByName('motocross-goggle-lens') as Mesh;
    const frame = helmet.getObjectByName('motocross-goggle-frame') as Mesh;
    expect(ray(0, 0).intersectObject(frame, false)).toHaveLength(0);
    const center = ray(0, 0).intersectObject(lens, false)[0].point;
    const side = ray(0.075, 0).intersectObject(lens, false)[0].point;
    expect(center.z).toBeLessThan(side.z);
    expect(center.z).toBeGreaterThan(-0.155);
    expect(center.z).toBeLessThan(-0.15);
    expect(ray(0, -0.031).intersectObject(lens, false)).toHaveLength(0);
    expect(
      ray(0.055, -0.027).intersectObject(lens, false).length,
    ).toBeGreaterThan(0);
  });

  it('supports the peak at both temples and joins a broad strap to both goggle outriggers', () => {
    const helmet = createMotocrossHelmet('#d7dbd7');
    helmet.updateMatrixWorld(true);
    const peak = helmet.getObjectByName('motocross-peak')!;
    const peakBounds = new Box3().setFromObject(peak, true);
    const mounts = helmet.getObjectsByProperty('name', 'peak-temple-mount');
    expect(mounts).toHaveLength(2);
    helmet.geometry.computeBoundingBox();
    for (const mount of mounts) {
      const bounds = new Box3().setFromObject(mount, true);
      expect(bounds.intersectsBox(peakBounds)).toBe(true);
      expect(bounds.intersectsBox(helmet.geometry.boundingBox!)).toBe(true);
    }
    const strap = new Box3().setFromObject(
      helmet.getObjectByName('goggle-strap')!,
      true,
    );
    expect(strap.max.y - strap.min.y).toBeCloseTo(0.046, 5);
    expect(strap.max.z).toBeGreaterThan(0.158);
    const frame = new Box3().setFromObject(
      helmet.getObjectByName('motocross-goggle-frame')!,
      true,
    );
    const outriggers = helmet.getObjectsByProperty(
      'name',
      'goggle-strap-outrigger',
    );
    expect(outriggers).toHaveLength(2);
    for (const outrigger of outriggers) {
      const bounds = new Box3().setFromObject(outrigger, true);
      expect(bounds.intersectsBox(strap)).toBe(true);
      expect(bounds.intersectsBox(frame)).toBe(true);
    }
  });

  it('adds an angular rear trailing edge with both roots attached to the original shell', () => {
    const helmet = createMotocrossHelmet('#d7dbd7');
    helmet.updateMatrixWorld(true);
    const ridge = helmet.getObjectByName('motocross-rear-ridge') as Mesh;
    const fromRear = (y: number, target: Mesh) =>
      new Raycaster(
        new Vector3(0, y, 1),
        new Vector3(0, 0, -1),
      ).intersectObject(target, false)[0]?.point.z;
    const crest = fromRear(0.113, ridge)!;
    expect(crest - fromRear(0.113, helmet)!).toBeGreaterThan(0.014);
    for (const y of [0.0995, 0.1235])
      expect(Math.abs(fromRear(y, ridge)! - fromRear(y, helmet)!)).toBeLessThan(
        0.004,
      );
  });

  it('leaves the rear crown exposed, opens the peak reliefs and turns the front lip down', () => {
    const helmet = createMotocrossHelmet('#d7dbd7');
    helmet.updateMatrixWorld(true);
    const peak = helmet.getObjectByName('motocross-peak') as Mesh;
    const down = (x: number, z: number, target: Mesh = peak) =>
      new Raycaster(
        new Vector3(x, 1, z),
        new Vector3(0, -1, 0),
      ).intersectObject(target, false);

    // The previous rectangular canopy covered these points outside the crown.
    for (const side of [-1, 1]) {
      expect(down(side * 0.105, -0.06)).toHaveLength(0);
      expect(down(side * 0.035, -0.132)).toHaveLength(0);
    }
    expect(down(0, -0.132).length).toBeGreaterThan(0);
    expect(down(0, -0.26)[0].point.y).toBeLessThan(
      down(0, -0.24)[0].point.y - 0.005,
    );
    const root = down(0, -0.041)[0].point;
    const crown = down(0, -0.041, helmet)[0].point;
    expect(Math.abs(root.y - crown.y)).toBeLessThan(0.006);
  });
});
