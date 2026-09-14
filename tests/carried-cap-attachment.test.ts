import { describe, expect, it, vi } from 'vitest';
import { Box3, MeshStandardMaterial, Vector3 } from 'three';
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

const cap = (catalog as Product[]).find((p) => p.handle === 'p-zero-cap')!;

describe('hip cap attachment on the shared rider', () => {
  it.each(['125', 'scooter', '450', '701'])(
    '%s keeps the cap clipped and hanging below its strap through bike motion',
    (id) => {
      const player = newPlayer();
      player.bike = id;
      player.equipped.head = cap.id;
      const bike = makeBike(player, [cap]);
      const pivot = bike.rider.getObjectByName('carried-cap-pivot')!;
      const clip = bike.rider.getObjectByName('cap-belt-clip')!;
      const carried = bike.rider.getObjectByName('carried-cap')!;
      const helmet = bike.rider.getObjectByName('full-face-helmet')!;
      const rest = carried.quaternion.clone();
      const childPosition = carried.position.clone();
      const clipCenter = new Vector3();
      for (const pitch of [0, 0.7]) {
        bike.root.rotation.z = 0.12;
        bike.animateRider({ wheelie: pitch, steer: 0.4, landing: 0 }, 1 / 60);
        bike.animateSuspension(pitch, 0.015);
        bike.animateAccessories({ reducedMotion: true }, 1 / 60);
        bike.root.updateMatrixWorld(true);
        clip.getWorldPosition(clipCenter);
        expect(
          pivot.getWorldPosition(new Vector3()).distanceTo(clipCenter),
        ).toBeLessThan(1e-9);
        const down = new Vector3(0, -1, 0).transformDirection(
          pivot.matrixWorld,
        );
        expect(down.distanceTo(new Vector3(0, -1, 0))).toBeLessThan(1e-9);
        const strap = new Vector3(0, 0, 0.1).applyMatrix4(carried.matrixWorld);
        // The rear adjustment strap sits inside the small metal clip's ring.
        expect(strap.distanceTo(clipCenter)).toBeGreaterThan(0.019);
        expect(strap.distanceTo(clipCenter)).toBeLessThan(0.03);
        const bounds = new Box3().setFromObject(carried, true);
        expect(bounds.min.y).toBeLessThan(clipCenter.y - 0.2);
        expect(bounds.min.y).toBeGreaterThan(0);
        expect(carried.quaternion.equals(rest)).toBe(true);
        expect(carried.position.equals(childPosition)).toBe(true);
        expect(helmet.scale.toArray()).toEqual([1.065, 1.065, 1.065]);
      }
    },
  );
});
