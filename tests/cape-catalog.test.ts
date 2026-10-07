import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commitGarageEdit, garageAppearance, garageOffer, type GarageEdit } from '../app/domain/garageEdit';
import { equipmentSlot, initialConfiguration } from '../app/domain/preview';
import { digitalLevel, digitalPrice, newPlayer } from '../app/domain/progression';
import { applySetup, saveSetup } from '../app/domain/setups';
import type { Product } from '../app/domain/types';
import { decodePlayer } from '../app/services';
import { sanitizeDigitalPlayer } from '../server/shopify/playerValidation';

const products: Product[] = JSON.parse(readFileSync('public/catalog/products.json', 'utf8'));
const cape = products.find(product => product.id === '10442786799945')!;
const legacy = products.find(product => product.id === '9464572805449')!;
const bag = products.find(product => product.handle === 'logo-crossbody-tasche')!;
const key = products.find(product => product.handle === 'schlusselanhanger')!;
const cap = products.find(product => product.category === 'head')!;
const edit: GarageEdit = { kind: 'product', productId: cape.id, configuration: initialConfiguration(newPlayer(), cape) };

describe('current Shopify flag as an independent cape', () => {
  it('retains the old identity unavailable, with no old-to-new ownership transfer', () => {
    expect(legacy.category).toBe('collectible');
    expect(legacy.available).toBe(false);
    expect(legacy.variants.every(variant => !variant.available)).toBe(true);
    expect(cape.category).toBe('cape');
    expect(cape.variants[0].id).toBe('55543055515977');
    const player = decodePlayer(JSON.stringify({ ...newPlayer(), ownedItems: [legacy.id] }));
    expect(player.ownedItems).not.toContain(cape.id);
    expect(player.equipped.cape).toBeUndefined();
  });

  it('allows free locked preview alongside all accessories without mutating saved state', () => {
    const player = { ...newPlayer(), coins: 0, equipped: { accessory: bag.id, keychain: key.id, head: cap.id } };
    const original = structuredClone(player), preview = garageAppearance(player, edit, products);
    expect(equipmentSlot(cape)).toBe('cape');
    expect(preview.equipped).toEqual({ ...player.equipped, cape: cape.id });
    expect(preview.coins).toBe(0);
    expect(preview.ownedItems).not.toContain(cape.id);
    expect(player).toEqual(original);
    expect(commitGarageEdit(player, edit, products)).toBeNull();
  });

  it('requires level 8 and 5000 coins, purchases once, and removes only the cape', () => {
    expect(digitalPrice(cape)).toBe(5000);
    expect(digitalLevel(cape)).toBe(8);
    const player = { ...newPlayer(), xp: 5100, level: 8, coins: 5000, equipped: { accessory: bag.id, keychain: key.id } };
    expect(garageOffer({ ...player, level: 7 }, edit, products).blocked).toBe('Ab Level 8 verfügbar');
    expect(commitGarageEdit({ ...player, coins: 4999 }, edit, products)).toBeNull();
    const saved = commitGarageEdit(player, edit, products)!;
    expect(saved.coins).toBe(0);
    expect(saved.equipped).toEqual({ ...player.equipped, cape: cape.id });
    expect(commitGarageEdit(saved, edit, products)!.coins).toBe(0);
    const removed = commitGarageEdit(saved, { kind: 'remove', slot: 'cape' }, products)!;
    expect(removed.equipped).toEqual(player.equipped);
    expect(removed.ownedItems).toContain(cape.id);
  });

  it('roundtrips additive schema 1 cape + outfit through local, cloud validation and saved setups', () => {
    let player = { ...newPlayer(), xp: 5100, level: 8, coins: 5000 };
    player = commitGarageEdit(player, edit, products)!;
    player = saveSetup(player, 'Cape', 'cape-setup')!;
    for (const saved of [decodePlayer(JSON.stringify(player)), sanitizeDigitalPlayer(player, '123')]) {
      expect(saved.version).toBe(1);
      expect(saved.equipped.cape).toBe(cape.id);
      expect(saved.savedSetups[0].appearance.equipped.cape).toBe(cape.id);
      expect(applySetup({ ...saved, equipped: {} }, 'cape-setup', products)!.equipped.cape).toBe(cape.id);
    }
  });

  it('uses an untouched original photo and bounded UV crop excluding its background', () => {
    const artwork = cape.preview!.artwork!;
    expect(artwork.source).toBe(cape.image);
    expect(existsSync(`public${artwork.localImage}`)).toBe(true);
    expect(artwork.crop).toEqual({ x: 155, y: 485, width: 1720, height: 1035 });
    expect(artwork.crop.x + artwork.crop.width).toBeLessThan(artwork.width);
    expect(artwork.crop.y + artwork.crop.height).toBeLessThan(artwork.height);
  });
});

describe('public catalog audit', () => {
  it('exhausts pagination and covers every product in all localized sitemaps without filtering availability', () => {
    const audit = JSON.parse(readFileSync('public/catalog/coverage.json', 'utf8'));
    expect(audit.paginationExhausted).toBe(true);
    expect(audit.pages.at(-1).count).toBe(0);
    expect(audit.productSitemaps).toHaveLength(12);
    expect(audit.publishedProducts).toBe(16);
    expect(audit.publishedVariants).toBe(186);
    expect(audit.missingSitemapHandles).toEqual([]);
    expect(audit.retiredProductIds).toEqual([legacy.id]);
    for (const sitemap of audit.productSitemaps) for (const handle of sitemap.handles) {
      expect(products.some(product => product.handle === handle)).toBe(true);
    }
    for (const product of products) for (const variant of product.variants) expect(typeof variant.id).toBe('string');
  });
});
