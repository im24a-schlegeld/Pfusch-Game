import { describe, expect, it, vi } from 'vitest';
import { newPlayer } from '../app/domain/progression';
import { adminCosmeticsCatalog, applyAdminCosmeticEdit } from '../server/oxygen/adminCosmetics';
import { handleDashboardPlayers } from '../server/oxygen/adminManagement';
import type { ShopifyConfig } from '../server/shopify/auth';

const config: ShopifyConfig = { shop: 'demo-tests.myshopify.com', clientId: 'dashboard-test-client', secret: 'local-test-secret' };
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
async function staffToken() {
  const now = Math.floor(Date.now() / 1000);
  const a = b64({ alg: 'HS256', typ: 'JWT' });
  const b = b64({ aud: config.clientId, dest: `https://${config.shop}`,
    iss: `https://${config.shop}/admin`, sub: '12345', iat: now, nbf: now, exp: now + 60 });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(config.secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${a}.${b}`));
  return `${a}.${b}.${Buffer.from(signature).toString('base64url')}`;
}

describe('full digital admin garage', () => {
  it('lists catalog pieces, each color variant and every available bike', () => {
    const catalog = adminCosmeticsCatalog();
    expect(catalog.products.length).toBeGreaterThan(10);
    expect(catalog.products.some(product => product.variants.length > 0)).toBe(true);
    expect(catalog.bikes.map(bike => bike.id)).toContain('701');
    expect(catalog.helmetColor.length).toBeGreaterThan(5);
    expect(catalog.paint.length).toBeGreaterThan(5);
  });
  it('can grant, equip and revoke a bike without removing protected purchases', () => {
    const original = newPlayer();
    const unlocked = applyAdminCosmeticEdit(original, { kind: 'owned', key: 'bike:701', owned: true });
    const equipped = applyAdminCosmeticEdit(unlocked, { kind: 'appearance', key: 'bike', value: '701' });
    expect(equipped.bike).toBe('701');
    expect(equipped.ownedItems).toContain('bike:701');
    expect(original.ownedItems).not.toContain('bike:701');
    const removed = applyAdminCosmeticEdit(equipped, { kind: 'owned', key: 'bike:701', owned: false });
    expect(removed.bike).toBe('125');
    expect(removed.irlItems).toEqual(original.irlItems);
    expect(removed.redeemedRewards).toEqual(original.redeemedRewards);
  });
  it('grants and equips a specific shop article/color without changing IRL inventory', () => {
    const choice = adminCosmeticsCatalog().products.find(p => p.category === 'upper' && p.variants.length)!;
    const variant = choice.variants[0];
    const original = newPlayer();
    const unlocked = applyAdminCosmeticEdit(original, { kind: 'owned', key: variant.key, owned: true });
    const equipped = applyAdminCosmeticEdit(unlocked, { kind: 'equip', slot: 'upper', productId: choice.id, variantId: variant.id });
    expect(equipped.equipped.upper).toBe(choice.id);
    expect(equipped.variants[choice.id]).toBe(variant.id);
    expect(equipped.irlItems).toEqual(original.irlItems);
    const revoked = applyAdminCosmeticEdit(equipped, { kind: 'owned', key: variant.key, owned: false });
    expect(revoked.equipped.upper).toBeUndefined();
  });
  it('rejects inventory forgery, locked equipment and attempts to revoke starter bike', () => {
    const player = newPlayer();
    expect(() => applyAdminCosmeticEdit(player, { kind: 'owned', key: 'shopify:order:123', owned: true })).toThrow();
    expect(() => applyAdminCosmeticEdit(player, { kind: 'owned', key: 'bike:125', owned: false })).toThrow();
    expect(() => applyAdminCosmeticEdit(player, { kind: 'appearance', key: 'bike', value: '701' })).toThrow();
    expect(() => applyAdminCosmeticEdit(player, { kind: 'owned', key: 'bike:701', owned: true, irlItems: ['forged'] })).toThrow();
  });
  it('denies email writes even to explicitly allowlisted Shopify staff before contacting Shopify', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const request = new Request('https://game.example/api/admin/players', { method: 'POST',
      headers: { Authorization: `Bearer ${await staffToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '77', field: 'email', value: 'other@example.com', expected: 'old@example.com' }),
    });
    const response = await handleDashboardPlayers(request, config, fetcher, '12345');
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
