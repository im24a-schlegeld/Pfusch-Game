import { describe, expect, it, vi } from 'vitest';
import { Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { newPlayer } from '../app/domain/progression';
import type { Product } from '../app/domain/types';
import { makeBike } from '../app/game/vehicle';
import catalog from '../public/catalog/products.json';
import artwork from '../public/catalog/keychain-artwork.json';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

const products = catalog as Product[];
const keychain = products.find((product) => product.handle === 'schlusselanhanger')!;
const bag = products.find((product) => product.handle === 'logo-crossbody-tasche')!;

describe('authentic, chassis-attached keychain', () => {
  it('uses only the first mockup for previews and two different real face textures', () => {
    expect(artwork.source).toBe(keychain.images[0]);
    for (const color of keychain.preview!.colors)
      for (const side of ['front', 'back'] as const) {
        expect(color[side]?.source).toBe(keychain.images[0]);
        expect(color[side]?.localImage).toBe('/' + keychain.localImage);
      }
    expect(artwork.front.localImage).not.toBe(artwork.back.localImage);
  });

  it.each(['125', '450', '701', 'scooter'])('%s joins the ignition to the real chassis and retains a bounded hanging attachment', (model) => {
    const player = newPlayer();
    player.bike = model;
    player.equipped.keychain = keychain.id;
    const bike = makeBike(player, products);
    const assembly = bike.body.getObjectByName('ignition-keychain-v38')!;
    const pivot = assembly.getObjectByName('keychain-pivot')!;
    const connector = assembly.getObjectByName('ignition-clamp-mount') as Mesh;
    expect(bike.body.getObjectByName(assembly.userData.supportSurface)).toBeDefined();
    bike.root.updateMatrixWorld(true);
    connector.geometry.computeBoundingBox();
    const bounds = connector.geometry.boundingBox!;
    const support = new Vector3(...assembly.userData.supportPoint as [number, number, number]);
    const endpoints = [bounds.min.y, bounds.max.y].map((y) =>
      bike.body.worldToLocal(connector.localToWorld(new Vector3(0, y, 0))),
    );
    expect(Math.min(...endpoints.map((point) => point.distanceTo(support)))).toBeLessThan(1e-7);
    expect(endpoints[0].distanceTo(endpoints[1])).toBeLessThan(0.085);
    const anchor = pivot.position.clone();
    const front = pivot.getObjectByName('keychain-mockup-front') as Mesh;
    const back = pivot.getObjectByName('keychain-mockup-back') as Mesh;
    expect((front.material as MeshStandardMaterial).userData.source).toBe(artwork.front.localImage);
    expect((back.material as MeshStandardMaterial).userData.source).toBe(artwork.back.localImage);
    expect(back.rotation.y).toBe(Math.PI);
    for (let frame = 0; frame < 60; frame++)
      bike.animateAccessories({ lateralAcceleration: 20, longitudinalAcceleration: 15, landing: frame === 0 ? 1 : 0 }, 1 / 60);
    expect(pivot.position.equals(anchor)).toBe(true);
    bike.root.updateMatrixWorld(true);
    const down = new Vector3(0, -1, 0).transformDirection(pivot.matrixWorld);
    expect(down.angleTo(new Vector3(0, -1, 0))).toBeLessThanOrEqual(0.401);
    const frozen = pivot.quaternion.clone();
    bike.animateAccessories({ paused: true, lateralAcceleration: -30 }, 1);
    expect(pivot.quaternion.equals(frozen)).toBe(true);
    bike.body.rotation.x = 0.9;
    bike.animateAccessories({ reducedMotion: true }, 1 / 60);
    bike.root.updateMatrixWorld(true);
    expect(new Vector3(0, -1, 0).transformDirection(pivot.matrixWorld).distanceTo(new Vector3(0, -1, 0))).toBeLessThan(1e-7);
  });

  it('keeps the separate keychain when a crossbody bag is also equipped', () => {
    const player = newPlayer();
    player.equipped.keychain = keychain.id;
    player.equipped.accessory = bag.id;
    const bike = makeBike(player, products);
    expect(bike.body.getObjectByName('keychain-pivot')).toBeDefined();
    expect(bike.rider.getObjectByName('crossbody-flat-strap')).toBeDefined();
  });
});
