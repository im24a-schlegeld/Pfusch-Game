import { describe, expect, it, vi } from 'vitest';
import { Box3, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { createMotocrossHelmet } from '../app/game/motocrossHelmet';
import { makeBike } from '../app/game/vehicle';
import { installImportedBikeFixtures } from './importedBikeFixture';
import { newPlayer } from '../app/domain/progression';

installImportedBikeFixtures();

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

const ray = (x: number, y: number) =>
  new Raycaster(new Vector3(x, y, -1), new Vector3(0, 0, 1));

// Source-space assertions are independent of the shared authored riding tilt.
const sourceHelmet = (color: string) => {
  const helmet = createMotocrossHelmet(color);
  helmet.geometry.rotateX(-helmet.userData.sourceTilt);
  (helmet.getObjectByName('motocross-peak') as Mesh).geometry.rotateX(-helmet.userData.sourceTilt);
  const goggles = helmet.getObjectByName('motocross-goggles')!;
  goggles.position.set(0, 0, 0); goggles.rotation.set(0, 0, 0);
  return helmet;
};

describe('independent motocross equipment geometry', () => {
  it.each(['125', 'scooter', 'moped', '450', '701'] as const)(
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
    const helmet = sourceHelmet('#b8ce47');
    expect(helmet.name).toBe('motocross-helmet');
    expect(helmet.userData.helmetStyle).toBe('motocross');
    expect(helmet.material[0].color.getHexString()).toBe('b8ce47');
    expect(helmet.scale.toArray()).toEqual([1, 1, 1]);
    helmet.geometry.computeBoundingBox();
    const bounds = helmet.geometry.boundingBox!;
    expect(Math.max(Math.abs(bounds.min.x), bounds.max.x)).toBeLessThanOrEqual(
      0.1271,
    );
    expect(bounds.max.y).toBeGreaterThan(.14);
    expect(bounds.max.y).toBeLessThan(.16);
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
    const helmet = sourceHelmet('#202324');
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
      const lens = helmet.getObjectByName('motocross-goggle-lens') as Mesh;
      const lensHit = ray(x, y).intersectObject(lens, false)[0];
      expect(hits[0].point.z).toBeGreaterThan((lensHit?.point.z ?? -.15) + .025);
    }
    for (const [x, y] of [
      [0, 0.11],
      [0.05, -0.102],
    ]) {
      const hits = ray(x, y).intersectObject(helmet, false);
      expect(hits[0]?.point.z).toBeLessThan(-0.08);
    }
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
    const helmet = sourceHelmet('#202324');
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

  it('attaches the original peak on both sides and wraps a wider band over shell recesses', () => {
    const helmet = sourceHelmet('#d7dbd7');
    helmet.updateMatrixWorld(true);
    const peak = helmet.getObjectByName('motocross-peak') as Mesh;
    const shellPoints = helmet.geometry.getAttribute('position');
    const peakPoints = peak.geometry.getAttribute('position');
    for (const side of [-1, 1]) {
      let closest = Infinity;
      const a = new Vector3(), b = new Vector3();
      for (let i = 0; i < peakPoints.count; i++) {
        a.fromBufferAttribute(peakPoints, i);
        if (a.x * side < .08 || a.y > .085) continue;
        for (let j = 0; j < shellPoints.count; j++)
          closest = Math.min(closest, a.distanceToSquared(b.fromBufferAttribute(shellPoints, j)));
      }
      expect(Math.sqrt(closest)).toBeLessThan(.008);
    }
    const fitted = createMotocrossHelmet('#d7dbd7');
    fitted.updateMatrixWorld(true);
    const goggles = fitted.getObjectByName('motocross-goggles')!;
    const strap = fitted.getObjectByName('goggle-strap') as Mesh;
    expect(strap.userData.width).toBe(.048);
    for (const angle of [1.8, 2.3, Math.PI, 4, 4.5]) for (const offset of [-.014, 0, .014]) {
      const pitch = -Math.atan2(.045, .246), axis = new Vector3(1, 0, 0);
      const direction = new Vector3(Math.sin(angle), 0, -Math.cos(angle)).applyAxisAngle(axis, pitch);
      const across = new Vector3(0, offset, 0).applyAxisAngle(axis, pitch);
      const origin = goggles.localToWorld(new Vector3(0, .003 + .045 * .096 / .246, 0)
        .add(across).addScaledVector(direction, 1));
      const cast = new Raycaster(origin, direction.negate().transformDirection(goggles.matrixWorld));
      const skin = cast.intersectObject(fitted, false)[0];
      const textile = cast.intersectObject(strap, false)[0];
      expect(skin).toBeDefined(); expect(textile).toBeDefined();
      expect(skin.distance - textile.distance).toBeGreaterThan(0);
      expect(skin.distance - textile.distance).toBeLessThan(.02);
    }
    const strapBounds = new Box3().setFromObject(strap, true);
    const frameBounds = new Box3().setFromObject(fitted.getObjectByName('motocross-goggle-frame')!, true);
    const mounts = fitted.getObjectsByProperty('name', 'goggle-strap-outrigger');
    expect(mounts).toHaveLength(2);
    for (const mount of mounts) {
      const bounds = new Box3().setFromObject(mount, true);
      expect(bounds.intersectsBox(strapBounds)).toBe(true);
      expect(bounds.intersectsBox(frameBounds)).toBe(true);
    }
    // Every longitudinal strip stays in one inclined plane, including the
    // frame transitions. A bowed side profile would leave these planes.
    const slope = .045 / .246, intercept = .003 + slope * .096;
    const planes = [-1, -.94, -.78, -.4, 0, .4, .78, .94, 1]
      .map(v => intercept + v * .024 * Math.sqrt(1 + slope * slope));
    let deviation = 0;
    for (const part of [strap, ...mounts] as Mesh[]) {
      const positions = part.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        const height = positions.getY(i) - slope * positions.getZ(i);
        deviation = Math.max(deviation, Math.min(...planes.map(plane => Math.abs(height - plane))));
      }
    }
    expect(deviation).toBeLessThan(.000002);
  });

  it('keeps goggles level independently of the gentler shell pitch and shared head joint', () => {
    const helmet = createMotocrossHelmet('#d7dbd7');
    expect(helmet.userData.sourceTilt).toBeGreaterThan(-.36);
    expect(helmet.userData.sourceTilt).toBeLessThan(0);
    expect(helmet.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(helmet.position.toArray()).toEqual([0, 0, 0]);
    const lens = helmet.getObjectByName('motocross-goggle-lens') as Mesh;
    const p = new Vector3().fromBufferAttribute(lens.geometry.getAttribute('position'), 0);
    expect(p.x).toBeCloseTo(-.09, 5);
    expect(p.y).toBeCloseTo(-.028, 5);
    helmet.rotation.x = -.06;
    helmet.updateMatrixWorld(true);
    const upright = new Vector3(0, 1, 0).transformDirection(lens.matrixWorld);
    expect(upright.y).toBeCloseTo(1, 5);
    expect(upright.z).toBeCloseTo(0, 5);
    const band = helmet.getObjectByName('goggle-strap') as Mesh;
    expect(band.userData.width).toBe(.048);
  });

  it('ships the clean imported source with bounded geometry and no print-support wall', () => {
    const helmet = sourceHelmet('#d7dbd7');
    expect(helmet.userData.geometryRevision).toBe('thor-source-shell-v1');
    const peak = helmet.getObjectByName('motocross-peak') as Mesh;
    expect(helmet.geometry.index!.count / 3 + peak.geometry.index!.count / 3).toBeLessThan(6000);
    peak.geometry.computeBoundingBox();
    const bounds = peak.geometry.boundingBox!;
    expect(bounds.max.y).toBeLessThan(.18);
    expect(bounds.min.z).toBeLessThan(-.23);
    expect(bounds.max.z).toBeLessThan(.01);
    expect(helmet.getObjectByName('motocross-goggle-lens')).toBeDefined();
    expect(helmet.getObjectByName('goggle-face-seal')).toBeDefined();
  });
});
