import { describe, expect, it, vi } from 'vitest';
import { newPlayer } from '../app/domain/progression';
import { handleAdminOverview } from '../server/oxygen/adminDashboard';
import { handleDashboardPlayers } from '../server/oxygen/adminManagement';
import { handleOxygenRequest } from '../server/oxygen/runtime';
import type { ShopifyConfig } from '../server/shopify/auth';

const config: ShopifyConfig = { shop: 'staff-authorization-tests.myshopify.com', clientId: 'test-admin-app-key', secret: 'local-test-secret' };
const origin = 'https://game.example';
const env = { OXYGEN_APP_ORIGIN: origin, SHOPIFY_SHOP_DOMAIN: config.shop,
  SHOPIFY_CLIENT_ID: config.clientId, SHOPIFY_CLIENT_SECRET: config.secret,
  CUSTOMER_ACCOUNT_CLIENT_ID: 'test-customer-client', OXYGEN_SESSION_SECRET: 'a'.repeat(64) };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
async function staffToken(staffId = '12345') {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const claims = encode({ aud: config.clientId, dest: `https://${config.shop}`, iss: `https://${config.shop}/admin`,
    sub: staffId, iat: now, nbf: now, exp: now + 60 });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(config.secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${Buffer.from(signature).toString('base64url')}`;
}
async function staffRequest(path: string, body?: unknown, staffId = '12345') {
  return new Request(origin + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${await staffToken(staffId)}`,
      ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const readPaths = ['/api/admin/overview', '/api/admin/players', '/api/admin/players?id=77'];
const digest = 'a'.repeat(64);
function requestBody(init: RequestInit | undefined) {
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
  return init.body;
}
function adminFetch() {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/oauth/access_token')) return Response.json({ access_token: 'test-only-token', expires_in: 7200, scope: 'write_customers' });
    const { query, variables } = JSON.parse(requestBody(init)) as { query: string; variables: Record<string, unknown> };
    if (query.includes('PfuschAdminDashboard')) return Response.json({ data: {
      shop: { name: 'Test Store', currencyCode: 'CHF', metafield: null }, currentAppInstallation: { accessScopes: [] },
      customers: { nodes: [], pageInfo: { hasNextPage: false } },
    } });
    if (query.includes('PfuschAdminPlayers')) return Response.json({ data: { customers: { nodes: [
      { id: 'gid://shopify/Customer/77', email: 'customer@example.invalid', firstName: 'Test', lastName: 'Rider', game: null, presence: null },
    ], pageInfo: { hasNextPage: false, endCursor: null } } } });
    if (query.includes('PfuschAdminDetail') || query.includes('PfuschAdminEdit')) return Response.json({ data: {
      customer: { id: variables.id, game: { value: JSON.stringify(newPlayer()), compareDigest: digest }, audit: null },
    } });
    if (query.includes('PfuschAdminSave')) return Response.json({ data: { metafieldsSet: { userErrors: [], metafields: [{ compareDigest: digest }] } } });
    throw new Error('Unexpected test query');
  });
}

describe('Shopify staff customer-data authorization', () => {
  it.each(readPaths)('denies signed but non-allowlisted staff before any Shopify request: %s', async path => {
    const fetcher = adminFetch();
    const request = await staffRequest(path, undefined, '999');
    const response = path.startsWith('/api/admin/overview')
      ? await handleAdminOverview(request, config, fetcher, Date.now(), '12345')
      : await handleDashboardPlayers(request, config, fetcher, '12345');
    expect(fetcher).not.toHaveBeenCalled();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'admin_editor_not_authorized' });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it.each(readPaths.flatMap(path => [undefined, '', 'invalid', '123450'].map(allowlist => ({ path, allowlist }))))
    ('fails closed through Oxygen for $path with allowlist $allowlist', async ({ path, allowlist }) => {
      const fetcher = adminFetch();
      const response = await handleOxygenRequest(await staffRequest(path),
        { ...env, SHOPIFY_DASHBOARD_EDITOR_IDS: allowlist }, '', fetcher);
      expect(fetcher).not.toHaveBeenCalled();
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'admin_editor_not_authorized' });
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    });

  it.each(readPaths)('preserves allowlisted staff reads through Oxygen: %s', async path => {
    const fetcher = adminFetch();
    const response = await handleOxygenRequest(await staffRequest(path),
      { ...env, SHOPIFY_DASHBOARD_EDITOR_IDS: '777, 12345' }, '', fetcher);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    if (path.includes('?id=')) expect(body).toMatchObject({ id: '77', player: { xp: 0 } });
    else if (path === '/api/admin/players') expect(body).toMatchObject({ editor: true, staffId: '12345', rows: [{ email: 'customer@example.invalid' }] });
    else expect(body).toMatchObject({ shop: 'Test Store', metrics: { players: 0 } });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('keeps non-allowlisted staff writes blocked before any Shopify request', async () => {
    const fetcher = adminFetch();
    const response = await handleDashboardPlayers(await staffRequest('/api/admin/players',
      { id: '77', field: 'xp', value: 150 }, '999'), config, fetcher, '12345');
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('preserves an allowlisted staff edit through Oxygen', async () => {
    const fetcher = adminFetch();
    const response = await handleOxygenRequest(await staffRequest('/api/admin/players',
      { id: '77', field: 'xp', value: 150 }), { ...env, SHOPIFY_DASHBOARD_EDITOR_IDS: '12345' }, '', fetcher);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ changed: 'xp', value: 150 });
    const saved = fetcher.mock.calls.find(([, init]) => requestBody(init).includes('PfuschAdminSave'))!;
    const fields = JSON.parse(requestBody(saved[1])).variables.fields as { ownerId: string; value: string }[];
    expect(fields[0].ownerId).toBe('gid://shopify/Customer/77');
    expect(JSON.parse(fields[0].value)).toMatchObject({ xp: 150 });
  });

  it('keeps the customer-free shell public without Shopify requests', async () => {
    const fetcher = adminFetch();
    const response = await handleOxygenRequest(new Request(origin + '/admin'), env, '', fetcher);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('customer@example.invalid');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
