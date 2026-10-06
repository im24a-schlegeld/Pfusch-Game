import { installImportedBikeFixtures } from './importedBikeFixture';
installImportedBikeFixtures(['450']);
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import catalog from '../public/catalog/products.json';
import type { Helmet, Product, StickerPlacement } from '../app/domain/types';
import { newPlayer } from '../app/domain/progression';
import { helmetStickerTarget, MAX_STICKERS, saveStickerTargets, saveStickers, validStickerForTarget } from '../app/domain/stickers';
import { decodePlayer } from '../app/services';
import { sanitizeDigitalPlayer } from '../server/shopify/playerValidation';
import { applyBikeStickers, applyHelmetStickers, helmetStickerSurfaces, stickerHelmet, stickerSurfaces } from '../app/game/bikeStickers';
import { makeBike } from '../app/game/vehicle';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new THREE.MeshStandardMaterial(),
  fabricMaterial: () => new THREE.MeshStandardMaterial(),
  sleeveMaterial: () => new THREE.MeshStandardMaterial(),
  accessoryMaterial: () => new THREE.MeshStandardMaterial(),
}));
beforeAll(() => { vi.spyOn(THREE.TextureLoader.prototype, 'load').mockReturnValue(new THREE.Texture()); });
afterAll(() => vi.restoreAllMocks());

const products = catalog as Product[];
const sticker = products.find((product) => product.handle === 'chrome-sticker')!;
const owner = () => {
  const player = newPlayer();
  return { ...player, ownedItems: [...player.ownedItems, sticker.id] };
};
const placement = (helmet: Helmet = 'fullface'): StickerPlacement => ({
  id: 'helmet-sticker-1', productId: sticker.id,
  surface: `helmet/${helmet}/${helmet === 'fullface' ? 'full-face-helmet' : 'motocross-helmet'}`,
  point: [0.12, 0.06, 0.07], normal: [1, 0, 0], size: 0.07, rotation: 0,
});

describe('helmet sticker storage', () => {
  it('adds independent helmet lists to schema 1 without changing bike stickers or equipment', () => {
    const player = owner();
    const bikePlacement = { ...placement(), surface: 'body/moped-main-frame:0' };
    const bikeSaved = saveStickers(player, '125', [bikePlacement], products)!;
    const saved = saveStickerTargets(bikeSaved, {
      'helmet:fullface': [placement()],
      'helmet:motocross': [placement('motocross')],
    }, products)!;
    expect(saved.version).toBe(1);
    expect(saved.bike).toBe(player.bike);
    expect(saved.helmet).toBe(player.helmet);
    expect(saved.stickers['125']).toEqual([bikePlacement]);
    expect(player.stickers).toEqual({});
    expect(decodePlayer(JSON.stringify(saved)).stickers).toEqual(saved.stickers);
    expect(sanitizeDigitalPlayer(saved, '12345').stickers).toEqual(saved.stickers);
    expect(decodePlayer(JSON.stringify({ ...player, stickers: undefined })).stickers).toEqual({});
  });

  it('needs an owned sticker but no motorcycle purchase to save a stock helmet', () => {
    expect(saveStickers(newPlayer(), 'helmet:fullface', [placement()], products)).toBeNull();
    const player = { ...owner(), bike: '701' };
    const saved = saveStickers(player, 'helmet:fullface', [placement()], products)!;
    expect(saved.stickers['helmet:fullface']).toHaveLength(1);
    const changedBike = { ...saved, bike: '450' };
    expect(changedBike.stickers[helmetStickerTarget(changedBike.helmet)]).toEqual([placement()]);
    const draft = [placement()];
    const copied = saveStickers(player, 'helmet:fullface', draft, products)!;
    draft[0].point[0] = 9;
    expect(copied.stickers['helmet:fullface'][0].point[0]).toBe(0.12);
  });

  it('bounds each helmet and rejects cross-target, unknown or oversized entries locally and on the server', () => {
    const player = owner();
    const invalid = [
      { ...placement(), surface: 'body/fender:0' },
      { ...placement(), surface: 'helmet/motocross/motocross-helmet' },
      { ...placement(), size: 0.3 },
    ];
    for (const entry of invalid) {
      expect(validStickerForTarget('helmet:fullface', entry)).toBe(false);
      expect(saveStickers(player, 'helmet:fullface', [entry], products)).toBeNull();
      expect(() => sanitizeDigitalPlayer({ ...player, stickers: { 'helmet:fullface': [entry] } }, '12345')).toThrow();
    }
    const full = Array.from({ length: MAX_STICKERS }, (_, index) => ({ ...placement(), id: `helmet-${index}` }));
    expect(saveStickers(player, 'helmet:fullface', full, products)?.stickers['helmet:fullface']).toHaveLength(MAX_STICKERS);
    expect(saveStickers(player, 'helmet:fullface', [...full, placement()], products)).toBeNull();
    expect(saveStickers(player, 'helmet:unknown', [placement()], products)).toBeNull();
    expect(() => sanitizeDigitalPlayer({ ...player, stickers: { 'helmet:unknown': [placement()] } }, '12345')).toThrow();
    expect(decodePlayer(JSON.stringify({ ...player, stickers: { 'helmet:unknown': [placement()], 'helmet:fullface': invalid } })).stickers).toEqual({ 'helmet:fullface': [] });
  });

  it('saves workshop drafts atomically and can remove helmet stickers without touching the bike', () => {
    const player = owner();
    const bikePlacement = { ...placement(), surface: 'body/moped-main-frame:0' };
    expect(saveStickerTargets(player, { 'helmet:fullface': [placement()], '701': [bikePlacement] }, products)).toBeNull();
    expect(player.stickers).toEqual({});
    const saved = saveStickerTargets(player, { 'helmet:fullface': [placement()], '125': [bikePlacement] }, products)!;
    const cleared = saveStickers(saved, 'helmet:fullface', [], products)!;
    expect(cleared.stickers['helmet:fullface']).toEqual([]);
    expect(cleared.stickers['125']).toEqual([bikePlacement]);
  });
});

describe('helmet sticker geometry', () => {
  it.each(['fullface', 'motocross'] as const)('sticks to the real %s shell, follows the head and stays separate from bike decals', (helmetStyle) => {
    const player = { ...owner(), helmet: helmetStyle, bike: '450' };
    const bike = makeBike(player, []);
    const helmet = stickerHelmet(bike.rider)!;
    const surfaces = helmetStickerSurfaces(bike.rider);
    expect(surfaces.size).toBeGreaterThan(0);
    expect([...surfaces.values()].every((mesh) => !/lens|goggle|strap|binding|vent/.test(mesh.name))).toBe(true);
    expect([...stickerSurfaces(bike.body, bike.rider, player.paint).values()].includes(helmet as THREE.Mesh)).toBe(false);
    const [surface, shell] = [...surfaces][0];
    const probe = new THREE.Mesh(shell.geometry, shell.material);
    probe.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(1, 0.07, 0.055), new THREE.Vector3(-1, 0, 0));
    const hit = ray.intersectObject(probe, false).find((entry) => entry.face?.materialIndex === 0)!;
    expect(hit).toBeTruthy();
    const saved: StickerPlacement = { ...placement(helmetStyle), surface, point: hit.point.toArray(), normal: hit.face!.normal.toArray() };
    applyBikeStickers(bike.body, bike.rider, player.paint, []);
    applyHelmetStickers(bike.rider, [saved]);
    const decal = helmet.getObjectByName(`sticker-${saved.id}`) as THREE.Mesh;
    expect(decal).toBeInstanceOf(THREE.Mesh);
    expect(decal.parent).toBe(shell);
    expect(decal.geometry.getIndex()!.count).toBeGreaterThan(0);
    expect((decal.material as THREE.MeshBasicMaterial).map).toBeTruthy();
    const local = new THREE.Vector3().fromBufferAttribute(decal.geometry.getAttribute('position'), 0);
    bike.root.updateMatrixWorld(true);
    const before = decal.localToWorld(local.clone());
    helmet.rotation.x += 0.35;
    bike.root.updateMatrixWorld(true);
    expect(decal.localToWorld(local.clone()).distanceTo(before)).toBeGreaterThan(0.005);
    applyHelmetStickers(bike.rider, [saved]);
    expect([...helmetStickerSurfaces(bike.rider).keys()]).toEqual([...surfaces.keys()]);
    applyHelmetStickers(bike.rider, []);
    expect(helmet.getObjectByName(`sticker-${saved.id}`)).toBeUndefined();
  });

  it('clips a brow sticker at the full-face visor instead of painting across the glass', () => {
    const bike = makeBike(owner(), []);
    const [surface, shell] = [...helmetStickerSurfaces(bike.rider)][0];
    const probe = new THREE.Mesh(shell.geometry, shell.material);
    probe.updateMatrixWorld(true);
    const hit = new THREE.Raycaster(new THREE.Vector3(0, 0.064, -1), new THREE.Vector3(0, 0, 1)).intersectObject(probe, false)[0];
    expect(hit.face!.materialIndex).toBe(0);
    const saved = { ...placement(), surface, point: hit.point.toArray(), normal: hit.face!.normal.toArray(), size: 0.16 };
    applyHelmetStickers(bike.rider, [saved]);
    const decal = shell.getObjectByName(`sticker-${saved.id}`) as THREE.Mesh;
    expect(decal.geometry.getIndex()!.count).toBeGreaterThan(0);
    const positions = decal.geometry.getAttribute('position'), index = decal.geometry.getIndex()!;
    for (let i = 0; i < index.count; i++) {
      const vertex = new THREE.Vector3().fromBufferAttribute(positions, index.getX(i));
      expect(Math.abs(vertex.x) < 0.02 && Math.abs(vertex.y) < 0.035 && vertex.z < 0).toBe(false);
    }
  });
});
