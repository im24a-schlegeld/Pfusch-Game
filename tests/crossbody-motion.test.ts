import { describe, expect, it, vi } from 'vitest';
import { Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { newPlayer } from '../app/domain/progression';
import type { Product } from '../app/domain/types';
import catalog from '../public/catalog/products.json';
import { makeBike } from '../app/game/vehicle';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

const products = catalog as Product[];
const bag = products.find((p) => p.handle === 'logo-crossbody-tasche')!;
const hoodie = products.find((p) => p.handle === 'keep-up-hoodie')!;

describe('crossbody cloth attachment', () => {
  it('hangs with gravity, keeps both lugs attached and the full strap outside the hoodie', () => {
    const player = newPlayer();
    player.bike = '450';
    player.equipped.accessory = bag.id;
    player.equipped.upper = hoodie.id;
    const bike = makeBike(player, products);
    const pivot = bike.rider.getObjectByName('crossbody-hanging-pivot')!;
    const pouch = bike.rider.getObjectByName('carried-crossbody-bag')!;
    const rings = pouch.getObjectsByProperty('name', 'crossbody-strap-ring');
    expect(rings).toHaveLength(2);
    const strap = bike.rider.getObjectByName('crossbody-flat-strap') as Mesh;
    const garment = bike.rider.getObjectByName('tailored-garment') as Mesh;
    const sleeves = bike.rider.getObjectsByProperty(
      'name',
      'garment-sleeve',
    ) as Mesh[];
    expect(sleeves).toHaveLength(2);
    for (const sleeve of sleeves)
      expect((sleeve.material as MeshStandardMaterial).color.toArray()).toEqual(
        (garment.material as MeshStandardMaterial).color.toArray(),
      );
    const surface = new Mesh(garment.geometry, garment.material);
    surface.updateMatrixWorld(true);
    const position = strap.geometry.getAttribute('position');
    const ray = new Raycaster(),
      point = new Vector3();
    for (const pitch of [0, 0.65, 1.15]) {
      bike.animateRider({ wheelie: pitch, steer: 0.6, landing: 0 }, 1 / 30);
      bike.animateSuspension(pitch, 0.015);
      bike.animateAccessories({ reducedMotion: true }, 1 / 60);
      bike.root.updateMatrixWorld(true);
      if (pitch === 0) {
        const center = garment.parent!.worldToLocal(
          pouch.getWorldPosition(new Vector3()),
        );
        expect(Math.abs(center.x)).toBeLessThan(0.18);
        expect(center.y).toBeGreaterThan(0.12);
        expect(center.y).toBeLessThan(0.3);
        expect(center.z).toBeGreaterThan(0.15);
        expect(center.z).toBeLessThan(0.23);
        expect(
          new Vector3(0, -1, 0).applyQuaternion(pivot.quaternion).z,
        ).toBeCloseTo(0, 7);
      }
      const down = new Vector3(0, -1, 0).transformDirection(pivot.matrixWorld);
      if (pitch > 0)
        expect(down.distanceTo(new Vector3(0, -1, 0))).toBeLessThan(1e-7);
      for (const [row, ring] of [
        [0, rings[0]],
        [112, rings[1]],
      ] as const) {
        const center = new Vector3();
        for (let i = 0; i < 4; i++)
          center.add(point.fromBufferAttribute(position, row * 4 + i));
        center.multiplyScalar(0.25).applyMatrix4(strap.matrixWorld);
        const attachment = ring.getWorldPosition(new Vector3());
        expect(center.distanceTo(attachment)).toBeLessThan(0.001);
      }
      for (let row = 8; row < 106; row += 5)
        for (let corner = 0; corner < 4; corner++) {
          point.fromBufferAttribute(position, row * 4 + corner);
          const radial = new Vector3(point.x, 0, point.z).normalize();
          ray.set(
            radial.clone().multiplyScalar(0.8).setY(point.y),
            radial.clone().negate(),
          );
          const hit = ray.intersectObject(surface)[0];
          if (hit)
            expect(
              Math.hypot(point.x, point.z) -
                Math.hypot(hit.point.x, hit.point.z),
            ).toBeGreaterThan(0.002);
        }
    }
    const frozen = position.array.slice();
    const orientation = pivot.quaternion.toArray();
    bike.animateAccessories({ paused: true, lateralAcceleration: 30 }, 1);
    expect(position.array).toEqual(frozen);
    expect(pivot.quaternion.toArray()).toEqual(orientation);
    for (let i = 0; i < 60; i++)
      bike.animateAccessories(
        { lateralAcceleration: 15, longitudinalAcceleration: 10 },
        1 / 60,
      );
    expect(pivot.quaternion.toArray()).not.toEqual(orientation);
    expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
  });
});
