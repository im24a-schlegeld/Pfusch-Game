import { describe, expect, it, vi } from 'vitest';
import { gamePriceCatalog, loadGamePrices, parseGamePrices, saveGamePrice } from '../server/shopify/gamePrices';
import { handleAdminGamePrices, handlePublicGamePrices } from '../server/oxygen/adminPrices';
import type { ShopifyConfig } from '../server/shopify/auth';

const config: ShopifyConfig = { shop: 'pfusch-test.myshopify.com', clientId: 'test-price-app', secret: 'price-test-secret' };
const now = Date.parse('2026-10-17T23:00:00Z');
const digest = 'a'.repeat(64), afterDigest = 'b'.repeat(64);
const product = gamePriceCatalog().find(item => item.editable)!;
const flag = gamePriceCatalog().find(item => !item.editable)!;
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const json = (data: unknown) => Response.json({ data });
async function token() {
  const time = now / 1000, a = b64({ alg: 'HS256', typ: 'JWT' });
  const b = b64({ aud: config.clientId, dest: 'https://' + config.shop,
    iss: 'https://' + config.shop + '/admin', sub: '12345', iat: time, nbf: time, exp: time + 60 });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(config.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(a + '.' + b));
  return a + '.' + b + '.' + Buffer.from(signature).toString('base64url');
}
function mock(initial: Record<string, number> = {}, collision = false) {
  let prices = { ...initial };
  const writes: Record<string, unknown>[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/oauth/access_token'))
      return Response.json({ access_token: 'admin-test-token', expires_in: 86399, scope: 'write_customers' });
    const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
    if (query.includes('PfuschGamePrices')) return json({ shop: { id: 'gid://shopify/Shop/77',
      field: { value: JSON.stringify({ version: 1, prices }), compareDigest: digest } } });
    if (query.includes('PfuschGamePriceSave')) {
      const fields = variables.fields as Record<string, unknown>[];
      writes.push(...fields);
      if (collision) return json({ metafieldsSet: { userErrors: [{ code: 'STALE_OBJECT' }], metafields: [] } });
      prices = (JSON.parse(String(fields[0].value)) as { prices: Record<string, number> }).prices;
      return json({ metafieldsSet: { userErrors: [], metafields: [{ key: 'game_prices_v1', compareDigest: afterDigest }] } });
    }
    throw Error('unexpected query ' + query);
  });
  return { fetcher, writes, current: () => prices };
}
function admin(method: string, data?: unknown, authorization?: string) {
  return new Request('https://game.example/api/admin/prices', { method,
    headers: { ...(authorization ? { Authorization: 'Bearer ' + authorization } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}) });
}

describe('Shopify dashboard game coin price overrides', () => {
  it('rejects unverified visitors before Shopify calls', async () => {
    const { fetcher } = mock();
    const response = await handleAdminGamePrices(admin('POST', { id: product.id, price: 99, expected: digest }), config, fetcher, '12345', now);
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('lists editable products but locks the 5000-coin flag', async () => {
    const { fetcher } = mock();
    const response = await handleAdminGamePrices(admin('GET', undefined, await token()), config, fetcher, '12345', now);
    expect(response.status).toBe(200);
    const body = await response.json() as { editor: boolean; products: ReturnType<typeof gamePriceCatalog> };
    expect(body.editor).toBe(true);
    expect(body.products.find((p: {id: string}) => p.id === flag.id)).toMatchObject({ editable: false, defaultPrice: 5000 });
  });
  it('updates game Coins with Shopify CAS without touching CHF product prices or inventory', async () => {
    const { fetcher, writes } = mock();
    const result = await handleAdminGamePrices(admin('POST', { id: product.id, price: 139, expected: digest }, await token()), config, fetcher, '12345', now);
    expect(result.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ ownerId: 'gid://shopify/Shop/77', namespace: '$app:pfusch_game', key: 'game_prices_v1', compareDigest: digest, type: 'json' });
    expect(JSON.parse(String(writes[0].value))).toEqual({ version: 1, prices: { [product.id]: 139 } });
  });
  it('supports resetting and rejects unauthorized or conflicting writes', async () => {
    const restricted = mock();
    expect((await handleAdminGamePrices(admin('POST', { id: product.id, price: 100, expected: digest }, await token()), config, restricted.fetcher, '777', now)).status).toBe(403);
    const stale = mock({ [product.id]: 40 }, true);
    expect((await handleAdminGamePrices(admin('POST', { id: product.id, price: 30, expected: digest }, await token()), config, stale.fetcher, '12345', now)).status).toBe(409);
    const normal = mock({ [product.id]: 88 });
    expect((await handleAdminGamePrices(admin('POST', { id: product.id, price: null, expected: digest }, await token()), config, normal.fetcher, '12345', now)).status).toBe(200);
    expect(normal.current()).toEqual({});
    expect((await handleAdminGamePrices(admin('POST', { id: flag.id, price: 1, expected: digest }, await token()), config, normal.fetcher, '12345', now)).status).toBe(400);
  });
  it('reads public coin prices without exposing Staff IDs or CHF price writes', async () => {
    const m = mock({ [product.id]: 77 });
    const response = await handlePublicGamePrices('GET', config, m.fetcher);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ prices: { [product.id]: 77 } });
    expect((await handlePublicGamePrices('POST', config, m.fetcher)).status).toBe(405);
    expect(m.writes).toHaveLength(0);
  });
  it('rejects corrupted or unknown persisted price IDs', () => {
    expect(() => parseGamePrices({ version: 1, prices: { [product.id]: 60 } })).not.toThrow();
    expect(() => parseGamePrices({ version: 1, prices: { [product.id]: -2 } })).toThrow();
    expect(() => parseGamePrices({ version: 1, prices: { 'malicious-id': 1 } })).toThrow();
  });
});
