import { describe, expect, it, vi } from 'vitest';
import { handleAdminOverview, readAdminOverview, renderAdminDashboard, verifyAdminIdToken } from '../server/oxygen/adminDashboard';
import type { ShopifyConfig } from '../server/shopify/auth';

const config: ShopifyConfig = { shop: 'gkhnzi-gc.myshopify.com', clientId: 'pfusch-dashboard-test-key', secret: 'test-only-app-secret' };
const encode = (data: unknown) => Buffer.from(JSON.stringify(data)).toString('base64url');
async function jwt(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = encode({ typ: 'JWT', alg: 'HS256' });
  const body = encode({ aud: config.clientId, dest: `https://${config.shop}`, iss: `https://${config.shop}/admin`,
    sub: '12345', iat: now, nbf: now, exp: now + 60, ...overrides });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(config.secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${Buffer.from(signed).toString('base64url')}`;
}
const fetchUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
const request = (token?: string, method = 'GET') => new Request('https://game.invalid/api/admin/overview', {
  method, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
});

describe('existing Shopify app / admin dashboard', () => {
  it('rejects untrusted requests before touching any Shopify data', async () => {
    const network = vi.fn<typeof fetch>();
    expect((await handleAdminOverview(request(), config, network)).status).toBe(401);
    expect((await handleAdminOverview(request('a.b.c'), config, network)).status).toBe(401);
    expect((await handleAdminOverview(request(await jwt(), 'POST'), config, network)).status).toBe(405);
    expect(network.mock.calls).toHaveLength(0);
  });
  it('validates signature, audience, shop, issuer, timestamps and staff ID', async () => {
    await expect(verifyAdminIdToken(`Bearer ${await jwt()}`, config)).resolves.toBe('12345');
    const valid = await jwt();
    const [head, claims, signature] = valid.split('.');
    const tampered = `${head}.${claims}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
    await expect(verifyAdminIdToken(`Bearer ${tampered}`, config)).rejects.toMatchObject({ status: 401 });
    for (const bad of [
      { aud: 'other-app' }, { dest: 'https://other.myshopify.com' }, { iss: 'https://bad.example/admin' },
      { exp: Math.floor(Date.now() / 1000) - 120 }, { nbf: Math.floor(Date.now() / 1000) + 90 },
      { sub: 'not-a-staff-id' }, { iat: Math.floor(Date.now() / 1000) + 200 },
    ]) await expect(verifyAdminIdToken(`Bearer ${await jwt(bad)}`, config)).rejects.toMatchObject({ status: 401 });
  });
  it('shows only aggregate sample data and opt-in ranking aliases, with no customer identifiers', async () => {
    const customerId = 'gid://shopify/Customer/777';
    const player = JSON.stringify({ version: 1, runsPlayed: 12, coins: 300, totalDistance: 16000,
      guardianBells: { earned: 3, spent: 1, spentRunIds: ['first'] } });
    const data = { shop: { name: 'PFUSCH.', currencyCode: 'CHF',
      metafield: { value: JSON.stringify({ all: { rows: [{ name: 'RIDER TEST', score: 805 }] } }) } },
      currentAppInstallation: { accessScopes: [{ handle: 'write_customers' }, { handle: 'write_discounts' }] },
      customers: { nodes: [{ id: customerId, playerField: { value: player }, rewardField: null }], pageInfo: { hasNextPage: true } } };
    const graphql = vi.fn<typeof fetch>(async (url) => {
      if (fetchUrl(url).endsWith('/oauth/access_token')) return Response.json({
        access_token: 'test-admin-token', expires_in: 7200, scope: 'write_customers,write_discounts',
      });
      return Response.json({ data });
    });
    const overview = await readAdminOverview(config, graphql);
    expect(overview.metrics).toMatchObject({ players: 1, runs: 12, distanceKm: 16, coins: 300, bellsAvailable: 2, bellsSpent: 1 });
    expect(overview.top).toEqual([{ name: 'RIDER TEST', score: 805 }]);
    expect(overview.sampleOnly).toBe(true);
    expect(overview.moreCustomers).toBe(true);
    expect(JSON.stringify(overview)).not.toContain(customerId);
    expect(JSON.stringify(overview)).not.toContain(config.secret);
    expect(graphql.mock.calls.some(call => fetchUrl(call[0]).includes('/graphql.json'))).toBe(true);
  });
  it('serves an unprivileged Shopify App Bridge shell without secrets or game mutations', async () => {
    const page = renderAdminDashboard(config);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('shopify-api-key');
    expect(html).toContain('cdn.shopify.com/shopifycloud/app-bridge.js');
    expect(html).toContain('/api/admin/overview');
    expect(html).not.toContain(config.secret);
    expect(html).not.toContain('metafieldsSet');
  });
});
