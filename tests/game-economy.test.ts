import { describe, expect, it } from 'vitest';
import catalog from '../public/catalog/products.json';
import { digitalPrice, finishRun, newPlayer } from '../app/domain/progression';
import { commitStickerEdit } from '../app/domain/garageEdit';
import type { Product, StickerPlacement } from '../app/domain/types';

const products = catalog as Product[];
const sticker = products.find(product => product.handle === 'chrome-sticker')!;
const plain = products.find(product => product.handle === 'signs-t-shirt')!;
const placement = (id: string): StickerPlacement => ({
  id, productId: sticker.id, surface: 'helmet/fullface/full-face-helmet',
  point: [0.1, 0.05, 0], normal: [1, 0, 0], size: 0.09, rotation: 0,
});

describe('proportional digital prices', () => {
  it('tracks shop price and keeps the flag at its established long-term price', () => {
    const cheaper = digitalPrice({ ...plain, price: 20 });
    const dearer = digitalPrice({ ...plain, price: 40 });
    expect(dearer / cheaper).toBeCloseTo(2, 1);
    expect(digitalPrice(products.find(product => product.category === 'cape')!)).toBe(5000);
    expect(digitalPrice({ ...plain, price: Number.NaN })).toBeGreaterThan(0);
  });
  it('prices ordinary clothing and caps in the requested shop-proportional range', () => {
    expect(digitalPrice(plain)).toBe(120);
    expect(digitalPrice(products.find(product => product.handle === 'p-zero-cap')!)).toBe(100);
    expect(digitalPrice({ ...plain, price: 1 })).toBe(40);
    expect(digitalPrice({ ...plain, price: 100 })).toBe(240);
    expect(digitalPrice({ ...plain, price: Number.NaN })).toBe(40);
  });
  it('adds about twelve percent for actual glow, hood or number customization', () => {
    const normal = digitalPrice({ ...plain, price: 35 });
    for (const handle of ['keep-up-t-shirt', 'unisex-windbreaker', 'racing-zipper']) {
      const effect = products.find(product => product.handle === handle)!;
      const cost = digitalPrice({ ...effect, price: 35 });
      expect(cost / normal).toBeCloseTo(1.12, 2);
    }
  });
  it('sets sticker copies to fifteen and the keychain to forty coins', () => {
    expect(digitalPrice(sticker)).toBe(15);
    expect(digitalPrice(products.find(product => product.handle === 'schlusselanhanger')!)).toBe(40);
  });
  it('preserves ride income independently of the lower catalog prices', () => {
    const run = { id: 'economy-example', score: 12000, distance: 1500, seconds: 60,
      bestCombo: 3, nearMisses: 4, jumps: 1, wheelieMeters: 400, maxSpeed: 35, cause: 'end' };
    const player = newPlayer();
    player.challenges = { date: '2026-10-16', values: {}, claimed: ['three-rides', 'one-wheel', 'close-call', 'night-shift', 'take-off', 'score-hunter'] };
    const result = finishRun(player, run, '2026-10-16')!;
    expect(result.reward.coins).toBe(61);
    expect(result.player.coins).toBe(player.coins + 61);
  });
});

describe('sticker copies are individual purchases', () => {
  it('charges each new copy, including copies of owned artwork, atomically across targets', () => {
    const player = { ...newPlayer(), coins: 1000, ownedItems: [...newPlayer().ownedItems, sticker.id] };
    const drafts = { 'helmet:fullface': [placement('one'), placement('two')],
      '125': [{ ...placement('three'), surface: 'body/moped-main-frame:0' }] };
    const saved = commitStickerEdit(player, drafts, products)!;
    expect(saved.coins).toBe(player.coins - 45);
    expect(saved.stickers).toEqual(drafts);
    expect(commitStickerEdit(saved, drafts, products)!.coins).toBe(saved.coins);
    expect(player.stickers).toEqual({});
  });
  it('does not charge again for moving, centering or removing an existing placement', () => {
    const saved = commitStickerEdit({ ...newPlayer(), coins: 1000 }, { 'helmet:fullface': [placement('one')] }, products)!;
    const moved = { ...placement('one'), point: [-0.1, 0.01, 0] as [number, number, number], rotation: 0.4 };
    const edited = commitStickerEdit(saved, { 'helmet:fullface': [moved] }, products)!;
    expect(edited.coins).toBe(saved.coins);
    expect(commitStickerEdit(edited, { 'helmet:fullface': [] }, products)!.coins).toBe(saved.coins);
  });
  it('rejects an unaffordable multi-copy purchase without partial placement or deduction', () => {
    const player = { ...newPlayer(), coins: digitalPrice(sticker), ownedItems: [...newPlayer().ownedItems, sticker.id] };
    expect(commitStickerEdit(player, { 'helmet:fullface': [placement('one'), placement('two')] }, products)).toBeNull();
    expect(player.stickers).toEqual({});
    expect(player.coins).toBe(digitalPrice(sticker));
  });
});
