import { describe, expect, it, vi } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';
import {
  SUPERMOTO_LAMP_BULB,
  SUPERMOTO_LENS_FACE,
  SUPERMOTO_FRONT_FENDER_MOUNT,
  SUPERMOTO_MASK_STRAP_ANCHORS,
  supermotoFrontFenderGeometry,
  supermotoHeadlightMaskGeometry,
} from '../app/game/supermotoBodywork';
import { supermotoLampGeometry, supermotoProjectorGeometry } from '../app/game/supermotoHeadlight';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

describe('moulded Supermoto front fender and raked mask', () => {
  it('opens the reference vent on the viewers right and recesses all five projectors behind glass', () => {
    const finish = new MeshBasicMaterial({ side: DoubleSide });
    const parts = [supermotoHeadlightMaskGeometry(), supermotoLampGeometry('glass'),
      supermotoProjectorGeometry('lens'), supermotoLampGeometry('reflector')]
      .map(geometry => new Mesh(geometry, finish));
    const cast = (x: number, y: number, mesh: Mesh) => new Raycaster(
      new Vector3(x, y, -1), new Vector3(0, 0, 1),
    ).intersectObject(mesh, false);
    try {
      expect(cast(-0.12, 1.089, parts[0])).toHaveLength(0);
      expect(cast(0.12, 1.089, parts[0]).length).toBeGreaterThan(0);
      for (const [x, y] of [[-0.026,1.022],[0.026,1.022],[0,1.009],[-0.026,0.994],[0.026,0.994]]) {
        expect(cast(x, y, parts[0])).toHaveLength(0);
        const [glass, lens, housing] = parts.slice(1).map(part => cast(x, y, part)[0]?.point);
        expect(glass).toBeDefined(); expect(lens).toBeDefined(); expect(housing).toBeDefined();
        expect(lens.z - glass.z).toBeGreaterThan(0.002);
        expect(housing.z - lens.z).toBeGreaterThan(0.01);
      }
    } finally {
      parts.forEach(part => part.geometry.dispose()); finish.dispose();
    }
  });

  it('forms the marked flatter blade with side steps and channels as one closed thin surface', () => {
    const geometry = supermotoFrontFenderGeometry();
    const finish = new MeshBasicMaterial({ side: DoubleSide });
    const fender = new Mesh(geometry, finish);
    const topAt = (x: number, z: number) => {
      const hits = new Raycaster(new Vector3(x, 1.5, z), new Vector3(0, -1, 0))
        .intersectObject(fender, false);
      expect(hits.length).toBeGreaterThan(1);
      return hits[0].point.y;
    };
    try {
      const noseDrop = topAt(0, -0.62455) - topAt(0, -0.89045);
      expect(noseDrop).toBeGreaterThan(0.03);
      expect(noseDrop).toBeLessThan(0.06);
      // Both sides of the nose have material: this is a rounded broad blade,
      // not a zero-width spear. The side-step interrupts the outer outline.
      expect(topAt(0.0301, -0.89045)).toBeGreaterThan(0.74);
      expect(topAt(-0.0301, -0.89045)).toBeCloseTo(topAt(0.0301, -0.89045), 7);
      const wide = new Raycaster(new Vector3(0.0774, 1.5, -0.737), new Vector3(0, -1, 0));
      const inset = new Raycaster(new Vector3(0.0774, 1.5, -0.715), new Vector3(0, -1, 0));
      expect(wide.intersectObject(fender).length).toBeGreaterThan(0);
      expect(inset.intersectObject(fender)).toHaveLength(0);
      const ridge = topAt(0, -0.62455), channel = topAt(0.043, -0.62455);
      expect(ridge - channel).toBeGreaterThan(0.018);
      expect(topAt(0.05805, -0.62455) - channel).toBeGreaterThan(0.003);
      expect(topAt(0, -0.550)).toBeCloseTo(0.908, 5);
      const positions = geometry.getAttribute('position'), index = geometry.getIndex()!;
      expect(positions.count).toBeLessThan(2200);
      const uv = geometry.getAttribute('uv');
      const previous = new Map<number, Vector3>();
      for (let i = 0; i < positions.count / 2; i++) {
        const point = new Vector3().fromBufferAttribute(positions, i), column = uv.getX(i);
        const last = previous.get(column);
        if (last) {
          expect(point.z - last.z, 'nose and side strips must never fold back').toBeGreaterThan(0);
          if (point.z < -0.858) expect(point.y - last.y, 'nose must descend without a curled lip').toBeGreaterThan(0);
        }
        previous.set(column, point);
      }
      const edges = new Map<string, number>();
      for (let i = 0; i < index.count; i += 3) for (let k = 0; k < 3; k++) {
        const a = index.getX(i + k), b = index.getX(i + (k + 1) % 3);
        const key = a < b ? `${a}/${b}` : `${b}/${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
      expect([...edges.values()].every(count => count === 2)).toBe(true);
    } finally {
      geometry.dispose(); finish.dispose();
    }
  });

  it('places the mounting crown directly beneath the mask and seats both holders on it', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    bike.root.updateMatrixWorld(true);
    const fender = bike.body.getObjectByName('supermoto-front-fender') as Mesh;
    const mask = bike.body.getObjectByName('supermoto-headlight-mask') as Mesh;
    const positions = mask.geometry.getAttribute('position');
    let lowest = 0;
    for (let i = 1; i < positions.count; i++) if (positions.getY(i) < positions.getY(lowest)) lowest = i;
    const maskBottom = new Vector3().fromBufferAttribute(positions, lowest);
    expect(Math.abs(SUPERMOTO_FRONT_FENDER_MOUNT[2] - maskBottom.z)).toBeLessThan(0.010);
    const finish = new MeshBasicMaterial({ side: DoubleSide });
    const probe = new Mesh(fender.geometry, finish);
    try {
      const center = new Raycaster(new Vector3(0, 1.2, maskBottom.z), new Vector3(0, -1, 0))
        .intersectObject(probe, false)[0];
      expect(center).toBeDefined();
      expect(maskBottom.y - center.point.y).toBeGreaterThan(0.008);
      expect(maskBottom.y - center.point.y).toBeLessThan(0.025);
      const holders = bike.body.getObjectsByProperty('name', 'front-fender-mount') as Mesh[];
      expect(holders).toHaveLength(2);
      for (const side of [-1, 1]) {
        const [x, y, z] = SUPERMOTO_FRONT_FENDER_MOUNT;
        const hit = new Raycaster(new Vector3(side * x, y + 0.02, z), new Vector3(0, -1, 0))
          .intersectObject(probe, false)[0];
        expect(hit.point.distanceTo(new Vector3(side * x, y, z))).toBeLessThan(0.0002);
      }
    } finally { finish.dispose(); }
  });

  it('clears the actual tyre through rebound, rest and maximum landing compression', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    const source = bike.body.getObjectByName('supermoto-front-fender') as Mesh;
    const finish = new MeshBasicMaterial({ side: DoubleSide });
    const fender = new Mesh(source.geometry, finish);
    try {
      for (const travel of [-0.025, 0, 0.12]) {
        bike.animateSuspension(0, travel);
        bike.root.updateMatrixWorld(true);
        fender.matrixWorld.copy(source.matrixWorld);
        const direction = new Vector3(0, -1, 0).transformDirection(bike.body.matrixWorld);
        let checked = 0;
        for (const x of [0, 0.025]) for (const z of [-0.97, -0.87, -0.77, -0.67, -0.57, -0.48]) {
          const origin = bike.body.localToWorld(new Vector3(x, 1.5, z));
          const ray = new Raycaster(origin, direction);
          const sheet = ray.intersectObject(fender, false);
          const wheel = ray.intersectObject(bike.wheels[0], true);
          if (!sheet.length || !wheel.length) continue;
          const bottom = Math.min(...sheet.map(hit => bike.body.worldToLocal(hit.point.clone()).y));
          const tyreTop = Math.max(...wheel.map(hit => bike.body.worldToLocal(hit.point.clone()).y));
          expect(bottom - tyreTop, `fender clearance at ${x}/${z}, travel ${travel}`).toBeGreaterThan(0.025);
          checked++;
        }
        expect(checked).toBeGreaterThan(5);
      }
    } finally {
      finish.dispose();
    }
  });

  it('keeps the raked mask straps on its actual back face and the bulb behind the lens', () => {
    const geometry = supermotoHeadlightMaskGeometry();
    const finish = new MeshBasicMaterial({ side: DoubleSide });
    const mask = new Mesh(geometry, finish);
    try {
      for (const [x, y, z] of SUPERMOTO_MASK_STRAP_ANCHORS) for (const side of [-1, 1]) {
        const hits = new Raycaster(new Vector3(side * x, y, 0), new Vector3(0, 0, -1))
          .intersectObject(mask, false);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].point.distanceTo(new Vector3(side * x, y, z))).toBeLessThan(0.002);
      }
      const [lower, upper] = [0.944, 1.145].map(y => new Raycaster(
        new Vector3(0.068, y, 0), new Vector3(0, 0, -1),
      ).intersectObject(mask, false)[0]?.point);
      expect(lower).toBeDefined(); expect(upper).toBeDefined();
      const rake = Math.atan((upper.z - lower.z) / (upper.y - lower.y)) * 180 / Math.PI;
      expect(rake).toBeGreaterThan(24);
      expect(rake).toBeLessThan(30);
      expect(SUPERMOTO_LAMP_BULB[2] - SUPERMOTO_LENS_FACE[2]).toBeCloseTo(0.030, 6);
    } finally {
      geometry.dispose(); finish.dispose();
    }
  });
});
