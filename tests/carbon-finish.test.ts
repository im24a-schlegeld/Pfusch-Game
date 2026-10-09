import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CARBON_PRICE, CARBON_PAINT_PRICE, CARBON_RIM_PRICE, DARK_CARBON } from '../app/domain/carbon';
import { newPlayer } from '../app/domain/progression';
import { commitGarageEdit, garageAppearance, garageOffer } from '../app/domain/garageEdit';
import { decodePlayer } from '../app/services';
import { makeBike } from '../app/game/vehicle';
import { createPreviewColorUpdater } from '../app/game/previewAppearance';
import { installImportedBikeFixtures } from './importedBikeFixture';
import { sanitizeDigitalPlayer } from '../server/shopify/playerValidation';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new THREE.MeshStandardMaterial(), fabricMaterial: () => new THREE.MeshStandardMaterial(),
  sleeveMaterial: () => new THREE.MeshStandardMaterial(), accessoryMaterial: () => new THREE.MeshStandardMaterial(),
}));
installImportedBikeFixtures();

it('previews free, buys each finish once, and round trips the existing v1 save', () => {
  const poor = newPlayer();
  expect(garageAppearance(poor, { kind: 'paint', value: DARK_CARBON }, []).paint).toBe(DARK_CARBON);
  expect(commitGarageEdit(poor, { kind: 'paint', value: DARK_CARBON }, [])).toBeNull();
  let player = { ...poor, coins: CARBON_PAINT_PRICE + CARBON_RIM_PRICE + CARBON_PRICE * 2 };
  for (const kind of ['paint', 'rims'] as const) {
    const edit = { kind, value: DARK_CARBON };
    expect(garageOffer(player, edit, []).price).toBe(kind === 'paint' ? CARBON_PAINT_PRICE : CARBON_RIM_PRICE);
    player = commitGarageEdit(player, edit, [])!;
    expect(commitGarageEdit(player, edit, [])).toEqual(player);
  }
  const helmet = { kind: 'helmet' as const, helmet: player.helmet, helmetColor: DARK_CARBON, helmetVisor: DARK_CARBON };
  expect(garageOffer(player, helmet, []).price).toBe(CARBON_PRICE * 2);
  expect(commitGarageEdit({ ...player, coins: CARBON_PRICE * 2 - 1 }, helmet, [])).toBeNull();
  player = commitGarageEdit(player, helmet, [])!;
  expect(player.coins).toBe(0);
  expect(commitGarageEdit(player, helmet, [])).toEqual(player);
  expect(decodePlayer(JSON.stringify(player))).toEqual(player);
  const backedUp = sanitizeDigitalPlayer(player, 'carbon-owner');
  for (const field of ['paint', 'rims', 'helmetColor', 'helmetVisor'] as const)
    expect(backedUp[field]).toBe(DARK_CARBON);
  expect(() => sanitizeDigitalPlayer({ ...poor, paint: DARK_CARBON }, 'carbon-owner')).toThrow();
  expect(() => sanitizeDigitalPlayer({ ...poor, helmetColor: 'carbon-red' }, 'carbon-owner')).toThrow();
  expect(decodePlayer(JSON.stringify({ ...poor, helmetColor: DARK_CARBON })).helmetColor).toBe(poor.helmetColor);
});

it.each(['125', 'moped', '450', '701', 'scooter'])('shares one carbon map and restores authored %s materials after preview', bikeId => {
  const player = { ...newPlayer(), bike: bikeId };
  const bike = makeBike(player, []);
  const materials = new Set<THREE.MeshStandardMaterial>();
  bike.root.traverse(object => {
    if (object instanceof THREE.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material instanceof THREE.MeshStandardMaterial && material.userData.appearanceColorSlot) materials.add(material);
    }
  });
  const before = [...materials].map(material => ({ material, color: material.color.clone(), map: material.map, roughness: material.roughness, metalness: material.metalness }));
  const update = createPreviewColorUpdater(bike.body, bike.rider, player);
  const carbon = { ...player, paint: DARK_CARBON, rims: DARK_CARBON, helmetColor: DARK_CARBON, helmetVisor: DARK_CARBON };
  update(carbon);
  expect(new Set([...materials].map(material => material.map)).size).toBe(1);
  expect([...materials][0].map?.name).toBe('shared-dark-carbon-128');
  expect(new Set([...materials].map(material => material.userData.appearanceColorSlot))).toEqual(new Set(['paint', 'rims', 'helmetColor', 'helmetVisor']));
  update(player);
  for (const item of before) {
    expect(item.material.color.equals(item.color)).toBe(true);
    expect(item.material.map).toBe(item.map);
    expect(item.material.roughness).toBe(item.roughness);
    expect(item.material.metalness).toBe(item.metalness);
  }
  const equipped = makeBike(carbon, []);
  const restore = createPreviewColorUpdater(equipped.body, equipped.rider, carbon);
  expect(() => restore(player)).not.toThrow();
});
