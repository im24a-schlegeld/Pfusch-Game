import { describe, expect, it, vi } from 'vitest';
import { newPlayer } from '../app/domain/progression';
import { applySetup, deleteSetup, MAX_SAVED_SETUPS, MAX_SAVED_SETUPS_BYTES, sanitizeSavedSetups, saveSetup } from '../app/domain/setups';
import type { Player, Product, StickerPlacement } from '../app/domain/types';
import { decodePlayer, LocalPlayerRepository } from '../app/services';
import { ShopifyCloudRepository } from '../app/services/shopifyCloud';
import type { CloudTransport } from '../app/services/shopifyBridge';
import { sanitizeDigitalPlayer } from '../server/shopify/playerValidation';

const garment: Product = { id: 'top-1', title: 'Windbreaker', handle: 'unisex-windbreaker',
  category: 'upper', url: '', image: '', images: [], price: 45, currency: 'CHF', type: '', baseColor: '#202324',
  description: '', available: false, options: [],
  variants: [{ id: 'variant-blue', title: 'Blue', available: false, price: 45, options: [] }] };
const keychain: Product = { ...garment, id: 'key-1', handle: 'schlusselanhanger', category: 'accessory',
  variants: [{ ...garment.variants[0], id: 'variant-key' }] };
const decal: Product = { ...garment, id: 'sticker-1', handle: 'chrome-sticker', category: 'collectible' };
const products = [garment, keychain, decal];
const placement: StickerPlacement = { id: 'decal-1', productId: decal.id, surface: 'body/side',
  point: [0, 0, 0], normal: [0, 0, 1], size: 0.1, rotation: 0 };
function dressed(): Player {
  return { ...newPlayer(), xp: 300, level: 2, coins: 300,
    ownedItems: [...newPlayer().ownedItems, garment.id, keychain.id, decal.id, 'bike:scooter'],
    equipped: { upper: garment.id, keychain: keychain.id },
    variants: { [garment.id]: 'variant-blue', [keychain.id]: 'variant-key' },
    customizations: { [garment.id]: { hoodEnabled: true } },
    stickers: { '125': [structuredClone(placement)] } };
}

describe('saved garage setups', () => {
  it('captures a detached cosmetic snapshot and restores clothes, bike, helmet and decals without rolling progress back', () => {
    const original = dressed();
    const saved = saveSetup(original, '  Alltag  ', 'setup-a')!;
    expect(saved.savedSetups[0].name).toBe('Alltag');
    expect(Object.keys(saved.savedSetups[0].appearance)).not.toContain('coins');
    original.customizations[garment.id].hoodEnabled = false;
    original.stickers['125'][0].point[0] = 4;
    expect(saved.savedSetups[0].appearance.customizations[garment.id].hoodEnabled).toBe(true);
    expect(saved.savedSetups[0].appearance.stickers['125'][0].point[0]).toBe(0);
    const later = { ...saved, coins: 900, xp: 1400, level: 4, runsPlayed: 7,
      equipped: {}, bike: 'scooter', helmet: 'motocross' as const,
      stickers: { scooter: [structuredClone(placement)], '125': [] } };
    const applied = applySetup(later, 'setup-a', products)!;
    expect(applied).toMatchObject({ coins: 900, xp: 1400, level: 4, runsPlayed: 7, bike: '125',
      helmet: 'fullface', equipped: { upper: garment.id, keychain: keychain.id } });
    expect(applied.stickers['125']).toEqual([placement]);
    expect(applied.stickers.scooter).toEqual(later.stickers.scooter);
    expect(applied.ownedItems).toEqual(later.ownedItems);
    expect(applied.savedSetups).toEqual(saved.savedSetups);
  });

  it('removes decals on active targets when loading a clean setup, without erasing other bike designs', () => {
    const saved = saveSetup(dressed(), 'Clean', 'clean')!;
    saved.savedSetups[0].appearance.stickers['125'] = [];
    const applied = applySetup({ ...saved, stickers: { '125': [placement], scooter: [placement] } }, 'clean', products)!;
    expect(applied.stickers['125']).toEqual([]);
    expect(applied.stickers.scooter).toEqual([placement]);
  });

  it('rejects locked bikes, low levels, missing ownership and stale catalog selections atomically', () => {
    const saved = saveSetup(dressed(), 'One', 'one')!;
    expect(applySetup({ ...saved, ownedItems: saved.ownedItems.filter(id => id !== garment.id) }, 'one', products)).toBeNull();
    expect(applySetup(saved, 'one', products.filter(product => product.id !== garment.id))).toBeNull();
    const stale = structuredClone(saved);
    stale.savedSetups[0].appearance.variants[garment.id] = 'deleted-variant';
    expect(applySetup(stale, 'one', products)).toBeNull();
    stale.savedSetups[0].appearance.bike = '701';
    expect(applySetup(stale, 'one', products)).toBeNull();
    const scooter = saveSetup({ ...dressed(), bike: 'scooter' }, 'Scooter', 'scooter')!;
    expect(applySetup({ ...scooter, level: 1 }, 'scooter', products)).toBeNull();
  });

  it('restores legacy equipped garments without a remembered variant using the catalog default', () => {
    const saved = saveSetup({ ...dressed(), variants: {} }, 'Legacy', 'legacy')!;
    const applied = applySetup(saved, 'legacy', products)!;
    expect(applied.variants[garment.id]).toBe(garment.variants[0].id);
    expect(applied.variants[keychain.id]).toBe(keychain.variants[0].id);
  });

  it('bounds the library, overwrites a chosen entry, and deletes only the setup', () => {
    let player = dressed();
    for (let index = 0; index < MAX_SAVED_SETUPS; index++) player = saveSetup(player, `Setup ${index}`, `setup-${index}`)!;
    expect(saveSetup(player, 'Extra', 'overflow')).toBeNull();
    expect(saveSetup(player, '', 'setup-0')).toBeNull();
    expect(saveSetup(player, 'x'.repeat(33), 'setup-0')).toBeNull();
    const renamed = saveSetup(player, 'Renamed', 'setup-0')!;
    expect(renamed.savedSetups).toHaveLength(MAX_SAVED_SETUPS);
    const deleted = deleteSetup(renamed, 'setup-0');
    expect(deleted.savedSetups).toHaveLength(MAX_SAVED_SETUPS - 1);
    expect({ ...deleted, savedSetups: [] }).toEqual({ ...player, savedSetups: [] });
  });

  it('migrates old schema-1 saves without modifying their progress', () => {
    const old = { ...dressed(), savedSetups: undefined };
    const decoded = decodePlayer(JSON.stringify(old));
    expect(decoded.savedSetups).toEqual([]);
    expect(decoded.coins).toBe(old.coins);
    expect(sanitizeDigitalPlayer(old, '123').savedSetups).toEqual([]);
    const saved = saveSetup(dressed(), 'Persist', 'persist')!;
    expect(decodePlayer(JSON.stringify(saved)).savedSetups).toEqual(saved.savedSetups);
    expect(sanitizeDigitalPlayer(saved, '123').savedSetups).toEqual(saved.savedSetups);
  });

  it('discards forged recursive snapshots and ownership grants on both decoders', () => {
    const saved = saveSetup(dressed(), 'Safe', 'safe')!;
    const forged = { ...saved, savedSetups: [{ ...saved.savedSetups[0],
      appearance: { ...saved.savedSetups[0].appearance, coins: 999999, savedSetups: saved.savedSetups } }] };
    expect(decodePlayer(JSON.stringify(forged)).savedSetups).toEqual([]);
    expect(sanitizeDigitalPlayer(forged, '123').savedSetups).toEqual([]);
    const locked = structuredClone(saved);
    locked.savedSetups[0].appearance.equipped.upper = 'unowned-product';
    expect(sanitizeSavedSetups(locked.savedSetups, saved)).toEqual([]);
    const polluted = JSON.parse(JSON.stringify(saved));
    polluted.savedSetups[0].appearance.customizations = JSON.parse('{"__proto__":{"hoodEnabled":true}}');
    expect(sanitizeDigitalPlayer(polluted, '123').savedSetups).toEqual([]);
    expect(sanitizeDigitalPlayer(forged, '123').coins).toBe(saved.coins);
  });

  it('rejects oversized server libraries and bounds the client recovery result', () => {
    const saved = saveSetup(dressed(), 'Safe', 'safe')!;
    const overflow = Array.from({ length: MAX_SAVED_SETUPS + 1 }, (_, index) => ({ ...saved.savedSetups[0], id: `copy-${index}` }));
    expect(() => sanitizeDigitalPlayer({ ...saved, savedSetups: overflow }, '123')).toThrow();
    expect(sanitizeSavedSetups(overflow, saved)).toHaveLength(MAX_SAVED_SETUPS);
    expect(() => sanitizeDigitalPlayer({ ...saved, savedSetups: [{ payload: 'x'.repeat(MAX_SAVED_SETUPS_BYTES) }] }, '123')).toThrow();
    expect(sanitizeSavedSetups([saved.savedSetups[0], saved.savedSetups[0]], saved)).toHaveLength(1);
  });

  it('imports guest setups once with the existing cloud-save flow', async () => {
    const guest = saveSetup(dressed(), 'Guest', 'guest')!;
    const values = new Map([['pfusch:player:v1', JSON.stringify(guest)]]);
    const driver = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); } };
    const request = vi.fn<CloudTransport['request']>(async (method, body) => ({ status: 200,
      data: { customer: { id: '123' }, player: method === 'GET' ? null : (body as { player: Player }).player,
        compareDigest: method === 'GET' ? null : 'a'.repeat(64), csrfToken: 'test-csrf-token-only',
        storage: { allowed: true, reason: 'subscribed', completedRuns: 0, freeRuns: 5 } } }));
    const repo = new ShopifyCloudRepository({ request }, driver, new LocalPlayerRepository(driver), decodePlayer);
    const imported = await repo.load();
    await repo.flush();
    expect(imported.savedSetups).toEqual(guest.savedSetups);
    const post = request.mock.calls.find(([method]) => method === 'POST');
    expect((post?.[1] as { player: Player } | undefined)?.player.savedSetups).toEqual(guest.savedSetups);
    expect(values.get('pfusch:player:v1:guest-imported')).toBe('123');
  });
});
