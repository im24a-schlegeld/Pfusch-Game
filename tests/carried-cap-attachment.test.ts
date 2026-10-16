import { describe, expect, it, vi } from 'vitest';
import { Box3, type Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { newPlayer } from '../app/domain/progression';
import type { Product } from '../app/domain/types';
import catalog from '../public/catalog/products.json';
import { makeBike } from '../app/game/vehicle';
import { CARRIED_CAP_STRAP_ANCHOR } from '../app/game/carriedCap';
import { installImportedBikeFixtures } from './importedBikeFixture';

installImportedBikeFixtures();

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

const cap = (catalog as Product[]).find((p) => p.handle === 'p-zero-cap')!;

describe('hip cap attachment on the shared rider', () => {
  it.each(['125', 'scooter', 'moped', '450', '701'])(
    '%s keeps the cap hanging directly from its own strap through bike motion',
    (id) => {
      const player = newPlayer();
      player.bike = id;
      player.equipped.head = cap.id;
      const bike = makeBike(player, [cap]);
      const pivot = bike.rider.getObjectByName('carried-cap-pivot')!;
      const carried = bike.rider.getObjectByName('carried-cap')!;
      expect(bike.rider.getObjectByName('cap-belt-clip')).toBeUndefined();
      expect(bike.rider.getObjectByName('cap-belt-loop')).toBeUndefined();
      expect(carried.getObjectByName('imported-cap-shell')?.userData.sourceModel).toBe('user-supplied-cap-obj');
      const shell = carried.getObjectByName('imported-cap-shell') as Mesh;
      const positions = shell.geometry.getAttribute('position');
      const anchor = new Vector3(...CARRIED_CAP_STRAP_ANCHOR);
      let nearest = Infinity;
      for (let i = 0; i < positions.count; i++)
        nearest = Math.min(nearest, new Vector3().fromBufferAttribute(positions, i).distanceTo(anchor));
      // The contact point belongs to the supplied adjustment strap itself.
      expect(nearest).toBeLessThan(0.004);
      const helmet = bike.rider.getObjectByName('full-face-helmet')!;
      const trousers = bike.rider.getObjectByName('continuous-trouser-seat') as Mesh;
      const rest = carried.quaternion.clone();
      const childPosition = carried.position.clone();
      const waistContact = new Vector3();
      for (const pitch of [0, 0.7]) {
        bike.root.rotation.z = 0.12;
        bike.animateRider({ wheelie: pitch, steer: 0.4, landing: 0 }, 1 / 60);
        bike.animateSuspension(pitch, 0.015);
        bike.animateAccessories({ reducedMotion: true }, 1 / 60);
        bike.root.updateMatrixWorld(true);
        pivot.getWorldPosition(waistContact);
        const waistPositions = trousers.geometry.getAttribute('position');
        let waistGap = Infinity;
        for (let i = 0; i < waistPositions.count; i++) {
          const point = new Vector3().fromBufferAttribute(waistPositions, i).applyMatrix4(trousers.matrixWorld);
          waistGap = Math.min(waistGap, point.distanceTo(waistContact));
        }
        expect(waistGap).toBeLessThan(1e-9);
        const down = new Vector3(0, -1, 0).transformDirection(
          pivot.matrixWorld,
        );
        expect(down.distanceTo(new Vector3(0, -1, 0))).toBeLessThan(1e-9);
        const strap = anchor.clone().applyMatrix4(carried.matrixWorld);
        expect(strap.distanceTo(waistContact)).toBeLessThan(1e-9);
        const bounds = new Box3().setFromObject(carried, true);
        expect(bounds.min.y).toBeLessThan(waistContact.y - 0.2);
        expect(bounds.min.y).toBeGreaterThan(0);
        expect(carried.quaternion.equals(rest)).toBe(true);
        expect(carried.position.equals(childPosition)).toBe(true);
        expect(helmet.scale.toArray()).toEqual([1.12, 1.12, 1.12]);
      }
    },
  );
});
