import { describe, expect, it } from 'vitest';
import catalog from '../public/catalog/products.json';
import type { Player, Product, StickerPlacement } from '../app/domain/types';
import { newPlayer } from '../app/domain/progression';
import {
  equipConfiguration,
  initialConfiguration,
  previewLoadout,
} from '../app/domain/preview';
import {
  DEFAULT_VISOR_COLOR,
  equipHelmet,
  HELMETS,
  HELMET_COLORS,
  VISOR_COLORS,
} from '../app/domain/helmet';
import { MAX_STICKERS, saveStickers, validSticker } from '../app/domain/stickers';
import { decodePlayer } from '../app/services';

const products = catalog as Product[];
const bag = products.find((p) => p.handle === 'logo-crossbody-tasche')!;
const keychain = products.find((p) => p.handle === 'schlusselanhanger')!;
const cap = products.find((p) => p.category === 'head')!;
const sticker = products.find((p) => p.handle === 'chrome-sticker')!;
const placement = (id = 'sticker-1'): StickerPlacement => ({
  id,
  productId: sticker.id,
  surface: '0/4/moped-main-frame',
  point: [0.075, 0.71, -0.32],
  normal: [1, 0, 0],
  size: 0.14,
  rotation: 0,
});
const stickerOwner = (): Player => {
  const player = newPlayer();
  return {
    ...player,
    ownedItems: [...player.ownedItems, 'bike:450', sticker.id],
  };
};

describe('additive accessory and visor migration', () => {
  it('preserves old v1 progress and equipment when all new optional fields are missing', () => {
    const player = {
      ...newPlayer(),
      xp: 480,
      coins: 815,
      tickets: 3,
      highScore: 2390,
      runsPlayed: 7,
      totalDistance: 2146,
      ownedItems: [...newPlayer().ownedItems, bag.id, cap.id],
      equipped: { accessory: bag.id, head: cap.id },
      variants: { [bag.id]: bag.variants[0].id },
    };
    const restored = decodePlayer(JSON.stringify({
      ...player, helmetVisor: undefined, stickers: undefined,
    }));
    expect(restored).toMatchObject({
      version: 1,
      xp: 480, coins: 815, tickets: 3, highScore: 2390,
      runsPlayed: 7, totalDistance: 2146,
      equipped: player.equipped,
      ownedItems: player.ownedItems,
      variants: player.variants,
      helmetVisor: DEFAULT_VISOR_COLOR,
      stickers: {},
    });
    expect(restored.equipped.keychain).toBeUndefined();
  });

  it('moves the legacy accessory keychain to its independent slot without losing its variant', () => {
    const player = newPlayer();
    const restored = decodePlayer(JSON.stringify({
      ...player,
      ownedItems: [...player.ownedItems, keychain.id, cap.id],
      equipped: { accessory: keychain.id, head: cap.id },
      variants: { [keychain.id]: keychain.variants[0].id },
      coins: 415,
    }));
    expect(restored.equipped).toEqual({ keychain: keychain.id, head: cap.id });
    expect(restored.variants[keychain.id]).toBe(keychain.variants[0].id);
    expect(restored.coins).toBe(415);
    expect(decodePlayer(JSON.stringify(restored))).toEqual(restored);
  });

  it('equips bag, cap and keychain independently in either order', () => {
    for (const order of [[bag, cap, keychain], [keychain, cap, bag], [cap, bag, keychain]]) {
      const original = newPlayer();
      let player: Player = {
        ...original,
        ownedItems: [...original.ownedItems, bag.id, cap.id, keychain.id],
      };
      for (const product of order) {
        const next = equipConfiguration(player, product, initialConfiguration(player, product));
        expect(next).not.toBeNull();
        player = next!;
      }
      expect(player.equipped).toEqual({
        accessory: bag.id, head: cap.id, keychain: keychain.id,
      });
      expect(player.coins).toBe(original.coins);
      expect(original.equipped).toEqual({});
      expect(decodePlayer(JSON.stringify(player)).equipped).toEqual(player.equipped);
    }
  });

  it('previews a locked keychain beside the equipped bag and cap without committing it', () => {
    const player: Player = {
      ...newPlayer(), equipped: { accessory: bag.id, head: cap.id },
    };
    const original = structuredClone(player);
    const config = initialConfiguration(player, keychain);
    expect(previewLoadout(player, keychain, config).equipped).toEqual({
      accessory: bag.id, head: cap.id, keychain: keychain.id,
    });
    expect(equipConfiguration(player, keychain, config)).toBeNull();
    expect(player).toEqual(original);
  });

  it('round trips every supported visor on either helmet and changes no other loadout', () => {
    const player = stickerOwner();
    player.equipped = { accessory: bag.id, keychain: keychain.id, head: cap.id };
    player.stickers = { '125': [placement()] };
    for (const helmet of HELMETS)
      for (const color of VISOR_COLORS) {
        const equipped = equipHelmet(player, {
          helmet: helmet.id,
          helmetColor: player.helmetColor,
          helmetVisor: color.value,
        })!;
        expect(equipped).not.toBeNull();
        expect(equipped.helmetVisor).toBe(color.value);
        expect(equipped.equipped).toEqual(player.equipped);
        expect(equipped.stickers).toEqual(player.stickers);
        expect(equipped.coins).toBe(player.coins);
        expect(decodePlayer(JSON.stringify(equipped))).toEqual(equipped);
      }
    expect(player.helmetVisor).toBe(DEFAULT_VISOR_COLOR);
  });

  it('rejects unsupported visor selections and recovers invalid saved tints independently', () => {
    const player = {
      ...newPlayer(), coins: 731, helmetColor: HELMET_COLORS[0].value,
    };
    for (const helmetVisor of ['', '#ff00ff', '#123456', 'blue'])
      expect(equipHelmet(player, { ...player, helmetVisor })).toBeNull();
    for (const helmetVisor of [null, 12, {}, '#ff00ff'])
      expect(decodePlayer(JSON.stringify({ ...player, helmetVisor }))).toEqual(player);
  });
});

describe('bounded motorcycle sticker customization', () => {
  it('saves each owned bike separately, deep copies the draft and round trips placements', () => {
    const player = stickerOwner();
    const firstDraft = [placement()];
    const first = saveStickers(player, '125', firstDraft, products)!;
    const secondDraft = [{ ...placement('sticker-2'), rotation: -1.1 }];
    const second = saveStickers(first, '450', secondDraft, products)!;
    expect(second.stickers).toEqual({ '125': firstDraft, '450': secondDraft });
    expect(decodePlayer(JSON.stringify(second))).toEqual(second);
    expect(player.stickers).toEqual({});
    firstDraft[0].point[0] = 9;
    secondDraft[0].normal[0] = 0;
    expect(second.stickers['125'][0].point[0]).toBe(0.075);
    expect(second.stickers['450'][0].normal).toEqual([1, 0, 0]);
    const cleared = saveStickers(second, '125', [], products)!;
    expect(cleared.stickers['125']).toEqual([]);
    expect(cleared.stickers['450']).toEqual(second.stickers['450']);
    expect(second.stickers['125']).toHaveLength(1);
  });

  it('allows the bounded maximum and rejects duplicate IDs or excess placements', () => {
    const player = stickerOwner();
    const full = Array.from({ length: MAX_STICKERS }, (_, i) => placement(`sticker-${i}`));
    expect(saveStickers(player, '125', full, products)?.stickers['125']).toHaveLength(MAX_STICKERS);
    expect(saveStickers(player, '125', [...full, placement('overflow')], products)).toBeNull();
    expect(saveStickers(player, '125', [placement(), placement()], products)).toBeNull();
  });

  it('rejects non-finite/out-of-bounds placement data and invalid normals at the save boundary', () => {
    const invalid: StickerPlacement[] = [
      { ...placement(), point: [NaN, 0, 0] },
      { ...placement(), point: [0, Infinity, 0] },
      { ...placement(), point: [21, 0, 0] },
      { ...placement(), normal: [0, 0, 0] },
      { ...placement(), normal: [2, 0, 0] },
      { ...placement(), normal: [NaN, 0, 0] },
      { ...placement(), size: 0.001 },
      { ...placement(), size: 1 },
      { ...placement(), rotation: Infinity },
      { ...placement(), rotation: Math.PI * 3 },
      { ...placement(), surface: '' },
    ];
    expect(validSticker(placement())).toBe(true);
    for (const value of invalid) {
      expect(validSticker(value)).toBe(false);
      expect(saveStickers(stickerOwner(), '125', [value], products)).toBeNull();
    }
  });

  it('cannot persist locked product/bike previews or substitute a non-sticker catalog item', () => {
    const player = newPlayer();
    const original = structuredClone(player);
    expect(saveStickers(player, '125', [placement()], products)).toBeNull();
    const ownedSticker = stickerOwner();
    expect(saveStickers(ownedSticker, '701', [placement()], products)).toBeNull();
    expect(saveStickers({ ...ownedSticker, ownedItems: [...ownedSticker.ownedItems, bag.id] },
      '125', [{ ...placement(), productId: bag.id }], products)).toBeNull();
    expect(player).toEqual(original);
    const irl = { ...player, irlItems: [sticker.id] };
    expect(saveStickers(irl, '125', [placement()], products)).not.toBeNull();
  });

  it('sanitizes malformed, duplicate, oversized and unowned saved sticker lists', () => {
    const player = stickerOwner();
    const restored = decodePlayer(JSON.stringify({
      ...player,
      stickers: {
        '125': [
          { ...placement('bad-normal'), normal: [0, 0, 0] },
          { ...placement('bad-item'), productId: bag.id },
          placement(), placement(),
          ...Array.from({ length: MAX_STICKERS + 3 }, (_, i) => placement(`extra-${i}`)),
        ],
        'unknown-bike': [placement()],
      },
    }));
    expect(restored.stickers['125']).toHaveLength(MAX_STICKERS);
    expect(new Set(restored.stickers['125'].map((s) => s.id)).size).toBe(MAX_STICKERS);
    expect(restored.stickers['125'].every(validSticker)).toBe(true);
    expect(restored.stickers['unknown-bike']).toBeUndefined();
    expect(restored.coins).toBe(player.coins);
    const locked = decodePlayer(JSON.stringify({
      ...newPlayer(), stickers: { '125': [placement()] },
    }));
    expect(locked.stickers['125'] ?? []).toEqual([]);
  });
});
