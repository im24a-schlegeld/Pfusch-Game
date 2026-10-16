import { describe, expect, it } from 'vitest';
import catalog from '../public/catalog/products.json';
import { PAINTS, RIMS } from '../app/domain/config';
import { commitGarageEdit, commitStickerEdit, garageAppearance, garageEditChanged, garageOffer, type GarageEdit } from '../app/domain/garageEdit';
import { initialConfiguration } from '../app/domain/preview';
import { digitalPrice, newPlayer } from '../app/domain/progression';
import type { Product, StickerPlacement } from '../app/domain/types';

const products = catalog as Product[];
describe('one-part garage edits and atomic purchases', () => {
  it('keeps helmet type, color and visor together and discards only the draft on part change', () => {
    const player = { ...newPlayer(), coins: 500 };
    const edit: GarageEdit = { kind: 'helmet', helmet: 'motocross', helmetColor: '#202324', helmetVisor: '#287a9d' };
    const preview = garageAppearance(player, edit, products);
    expect(preview.helmetColor).toBe('#202324'); expect(preview.helmetVisor).toBe('#287a9d');
    const other = garageAppearance(player, { kind: 'paint', value: PAINTS[0].value }, products);
    expect(other.helmet).toBe(player.helmet);
    const saved = commitGarageEdit(player, edit, products)!;
    expect(garageAppearance(saved, { kind: 'paint', value: PAINTS[0].value }, products).helmetVisor).toBe('#287a9d');
    expect(player.helmet).toBe('fullface');
  });
  it('purchases and equips exactly the requested color, charging at most once', () => {
    const player = { ...newPlayer(), coins: 1000 };
    const color = PAINTS.find(c => !player.ownedItems.includes(`paint:${c.value}`))!;
    const edit: GarageEdit = { kind: 'paint', value: color.value };
    const next = commitGarageEdit(player, edit, products)!;
    expect(next.paint).toBe(color.value); expect(next.coins).toBe(player.coins - color.price);
    const repeated = commitGarageEdit(next, edit, products)!;
    expect(repeated.coins).toBe(next.coins);
    expect(repeated.ownedItems.filter(id => id === `paint:${color.value}`)).toHaveLength(1);
    expect(garageEditChanged(next, edit, products)).toBe(false);
  });
  it('rejects insufficient funds, required levels and invalid configuration without changing inventory', () => {
    const player = { ...newPlayer(), coins: 0 };
    const original = structuredClone(player);
    expect(garageOffer(player, { kind: 'model', value: '701' }, products).blocked).toBe('Ab Level 6 verfügbar');
    expect(commitGarageEdit(player, { kind: 'model', value: '701' }, products)).toBeNull();
    const rim = RIMS.find(c => c.price > 0 && !player.ownedItems.includes(`rims:${c.value}`))!;
    expect(garageOffer(player, { kind: 'rims', value: rim.value }, products).blocked).toBe(`Dir fehlen ${rim.price} Coins`);
    const product = products.find(p => p.handle === 'racing-zipper')!;
    expect(commitGarageEdit({ ...player, coins: 999 }, { kind: 'product', productId: product.id,
      configuration: { ...initialConfiguration(player, product), customNumber: '123' } }, products)).toBeNull();
    expect(player).toEqual(original);
  });
  it('commits product variant, number and hood options only on explicit confirmation', () => {
    for (const handle of ['racing-zipper', 'unisex-windbreaker']) {
      const player = { ...newPlayer(), coins: 3000 };
      const product = products.find(p => p.handle === handle)!;
      const configuration = { ...initialConfiguration(player, product),
        ...(handle === 'racing-zipper' ? { customNumber: '07' } : { hoodEnabled: true }) };
      const edit: GarageEdit = { kind: 'product', productId: product.id, configuration };
      garageAppearance(player, edit, products);
      expect(player.equipped.upper).toBeUndefined(); expect(player.coins).toBe(3000);
      const next = commitGarageEdit(player, edit, products)!;
      expect(next.equipped.upper).toBe(product.id); expect(next.variants[product.id]).toBe(configuration.variantId);
      expect(next.customizations[product.id]).toMatchObject(handle === 'racing-zipper' ? { customNumber: '07' } : { hoodEnabled: true });
    }
  });
  it('a newer draft remains based on the latest confirmed account, not an older full-player snapshot', () => {
    const player = { ...newPlayer(), coins: 1000 };
    const captured: GarageEdit = { kind: 'paint', value: PAINTS[0].value };
    const newer: GarageEdit = { kind: 'rims', value: RIMS[RIMS.length - 1].value };
    const confirmed = commitGarageEdit(player, captured, products)!;
    const preview = garageAppearance(confirmed, newer, products);
    expect(preview.paint).toBe(captured.value); expect(preview.rims).toBe(newer.value);
    expect(preview.coins).toBe(confirmed.coins);
  });
  it('buys each copy once and saves bike and helmet sticker positions together', () => {
    const player = newPlayer(), sticker = products.find(product => product.handle === 'chrome-sticker')!;
    const helmet: StickerPlacement = { id: 'helmet', productId: sticker.id, surface: 'helmet/fullface/full-face-helmet', point: [0, 0, 0], normal: [1, 0, 0], size: .07, rotation: 0 };
    const drafts = { '125': [{ ...helmet, id: 'bike', surface: 'body/moped-main-frame:0' }], 'helmet:fullface': [helmet] };
    const next = commitStickerEdit(player, drafts, products)!;
    expect(next.coins).toBe(player.coins - 2 * digitalPrice(sticker));
    expect(next.stickers).toEqual(drafts);
    expect(commitStickerEdit(next, drafts, products)!.coins).toBe(next.coins);
    expect(player.stickers).toEqual({});
    expect(player.ownedItems).not.toContain(sticker.id);
  });
  it('never charges for invalid sticker placements, locked targets or insufficient coins', () => {
    const player = newPlayer(), original = structuredClone(player), sticker = products.find(product => product.handle === 'chrome-sticker')!;
    const helmet: StickerPlacement = { id: 'helmet', productId: sticker.id, surface: 'helmet/fullface/full-face-helmet', point: [0, 0, 0], normal: [1, 0, 0], size: .07, rotation: 0 };
    expect(commitStickerEdit(player, { 'helmet:fullface': [{ ...helmet, size: .4 }] }, products)).toBeNull();
    expect(commitStickerEdit(player, { 'helmet:fullface': [helmet], '701': [{ ...helmet, surface: 'body/tank:0' }] }, products)).toBeNull();
    expect(commitStickerEdit({ ...player, coins: 0 }, { 'helmet:fullface': [helmet] }, products)).toBeNull();
    expect(commitStickerEdit(player, {}, products)).toBeNull();
    expect(player).toEqual(original);
  });
});
