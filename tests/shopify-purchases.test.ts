import { describe, expect, it, vi } from 'vitest';
import catalog from '../public/catalog/products.json';
import type { Product } from '../app/domain/types';
import { newPlayer } from '../app/domain/progression';
import { productColorKey, ownsProductColor } from '../app/domain/productOwnership';
import { readCustomerPurchases } from '../server/shopify/purchaseStore';
import { handlePlayerRequest } from '../server/shopify/playerEndpoint';
import { createCsrf } from '../server/shopify/auth';
import { decodePlayer, LocalPlayerRepository } from '../app/services';
import { ShopifyCloudRepository } from '../app/services/shopifyCloud';
import type { CloudTransport } from '../app/services/shopifyBridge';

const config = { shop: 'test.myshopify.com', secret: 'test-secret', adminToken: 'test-admin' };
const products = catalog as Product[], product = products.find(item => (item.preview?.colors.length ?? 0) > 1)!;
const variant = product.preview!.colors[0].variantIds[0], other = product.preview!.colors[1].variantIds[0];
const owner = 'gid://shopify/Customer/123';
const response = (data: unknown) => new Response(JSON.stringify({ data }));
const connection = (nodes: unknown[], next: string | null = null) => ({ nodes, pageInfo: { hasNextPage: next !== null, endCursor: next } });
const line = (id = variant, quantity = 1) => ({ currentQuantity: quantity, product: { id: `gid://shopify/Product/${product.id}` }, variant: { id: `gid://shopify/ProductVariant/${id}` } });
const order = (id: number, overrides: Record<string, unknown> = {}) => ({ id: `gid://shopify/Order/${id}`, cancelledAt: null, test: false,
  displayFinancialStatus: 'PAID', lineItems: connection([line()]), ...overrides });

describe('server-verified Shopify purchases', () => {
  it('grants only retained paid colors and excludes refunds, cancellations, tests and unpaid orders', async () => {
    const request = vi.fn<typeof fetch>(async (_url, options) => {
      const body = JSON.parse(options!.body as string);
      if (body.query.includes('GamePurchaseScopes')) return response({ currentAppInstallation: { accessScopes: ['read_orders', 'read_all_orders'].map(handle => ({ handle })) } });
      return response({ customer: { id: owner, orders: connection([
        order(1), order(2, { lineItems: connection([line(other, 0)]) }),
        order(3, { lineItems: connection([line(other)]), cancelledAt: '2026-10-13T00:00:00Z' }),
        order(4, { lineItems: connection([line(other)]), test: true }),
        order(5, { lineItems: connection([line(other)]), displayFinancialStatus: 'PENDING' }),
      ]) } });
    });
    const result = await readCustomerPurchases(config, '123', request);
    expect(result).toEqual({ available: true, history: 'all', items: [product.id, productColorKey(product, variant)] });
    const player = { ...newPlayer(), irlItems: result.items };
    expect(ownsProductColor(player, product, variant)).toBe(true);
    expect(ownsProductColor(player, product, other)).toBe(false);
  });
  it('paginates orders and line items and verifies ownership of additional order pages', async () => {
    const request = vi.fn<typeof fetch>(async (_url, options) => {
      const body = JSON.parse(options!.body as string);
      if (body.query.includes('GamePurchaseScopes')) return response({ currentAppInstallation: { accessScopes: [{ handle: 'read_orders' }] } });
      if (body.query.includes('GamePurchaseLines')) return response({ order: { id: 'gid://shopify/Order/1', customer: { id: owner }, lineItems: connection([line(other)]) } });
      return response({ customer: { id: owner, orders: body.variables.after ? connection([])
        : connection([order(1, { lineItems: connection([line()], 'line-next') })], 'order-next') } });
    });
    const result = await readCustomerPurchases(config, '123', request);
    expect(result.items).toEqual([product.id, productColorKey(product, variant), productColorKey(product, other)]);
    expect(result.history).toBe('recent');
    expect(request).toHaveBeenCalledTimes(4);
  });
  it('reports missing permissions without granting unverified products', async () => {
    const request = vi.fn<typeof fetch>(async () => response({ currentAppInstallation: { accessScopes: [{ handle: 'write_customers' }] } }));
    expect(await readCustomerPurchases(config, '123', request)).toEqual({ items: [], available: false, reason: 'orders_scope_missing', history: 'recent' });
    expect(request).toHaveBeenCalledOnce();
  });
  it('retains purchased equipment through cloud save while keeping claims outside the persisted backup', async () => {
    const now = Date.UTC(2026, 9, 13), identity = { shop: config.shop, customerId: '123' };
    const purchases = { available: true, history: 'all' as const, items: [product.id, productColorKey(product, variant)] };
    let stored: unknown;
    const request = vi.fn<typeof fetch>(async (_url, options) => {
      const body = JSON.parse(options!.body as string);
      if (body.query.includes('SaveGamePlayer')) {
        stored = JSON.parse(body.variables.metafields[0].value);
        return response({ metafieldsSet: { metafields: [{ compareDigest: 'b'.repeat(64) }], userErrors: [] } });
      }
      return response({ customer: { id: owner, emailMarketingConsent: { marketingState: 'SUBSCRIBED' }, metafield: null } });
    });
    const player = { ...newPlayer(), irlItems: ['forged'], equipped: { upper: product.id }, variants: { [product.id]: variant } };
    const result = await handlePlayerRequest({ method: 'POST', url: 'https://game.example/api/player', contentType: 'application/json',
      readBody: async () => ({ player, compareDigest: null, csrfToken: await createCsrf(identity, config.secret, now) }) },
    { config, request, now: () => now, authenticate: async () => identity, purchases: async () => purchases });
    expect(result.status).toBe(200);
    expect(result.body.player).toMatchObject({ irlItems: purchases.items, equipped: player.equipped });
    expect(stored).toMatchObject({ irlItems: [], equipped: player.equipped });
  });
  it('loads live entitlements separately, ignores snapshot claims and strips them from browser writes', async () => {
    const values = new Map<string, string>(), driver = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const items = [product.id, productColorKey(product, variant)];
    const data = { customer: { id: '123' }, player: { ...newPlayer(), irlItems: ['forged'] }, compareDigest: 'a'.repeat(64), csrfToken: 'csrf-token-for-testing',
      storage: { allowed: true, reason: 'subscribed', completedRuns: 0, freeRuns: 5 }, purchases: { items, available: true, history: 'all' } };
    const request = vi.fn<CloudTransport['request']>(async () => ({ status: 200, data }));
    const repo = new ShopifyCloudRepository({ request }, driver, new LocalPlayerRepository(driver), decodePlayer, 100000);
    const loaded = await repo.load();
    expect(loaded.irlItems).toEqual(items);
    repo.save(loaded);
    await repo.flush();
    expect(request).toHaveBeenLastCalledWith('POST', expect.objectContaining({ player: expect.objectContaining({ irlItems: [] }) }));
    expect((await repo.load()).irlItems).toEqual(items);
  });
});
