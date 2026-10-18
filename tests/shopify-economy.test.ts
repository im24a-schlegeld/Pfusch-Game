import { describe, expect, it, vi } from 'vitest';
import { handleAdminEconomy } from '../server/oxygen/adminEconomy';
import { readPublicEconomy, loadEconomy, saveEconomy } from '../server/shopify/economyStore';
import { handleOxygenRequest } from '../server/oxygen/runtime';
import type { ShopifyConfig } from '../server/shopify/auth';

const digest = 'a'.repeat(64), nextDigest = 'b'.repeat(64);
const fetchUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
  return init.body;
}
let shopSequence = 0;
function fixture(stored: unknown = null, errors: unknown[] = []) {
  const config: ShopifyConfig = { shop: `economy-${++shopSequence}.myshopify.com`, clientId: 'test-admin', secret: 'test-secret', adminToken: 'test-token' };
  const network = vi.fn<typeof fetch>(async (url, init) => {
    if (fetchUrl(url).endsWith('/oauth/access_token')) return Response.json({ access_token: 'test-token', expires_in: 7200, scope: 'write_customers' });
    const body = JSON.parse(requestBody(init)) as { query: string; variables: Record<string, unknown> };
    if (body.query.includes('SaveGameEconomy')) return Response.json({ data: { metafieldsSet: {
      userErrors: errors, metafields: errors.length ? [] : [{ compareDigest: nextDigest }],
    } } });
    return Response.json({ data: { shop: { id: 'gid://shopify/Shop/77', economy: stored === null ? null : {
      value: JSON.stringify(stored), compareDigest: digest,
    } } } });
  });
  return { config, network };
}
const graphCalls = (network: ReturnType<typeof fixture>['network']) => network.mock.calls.filter(([, init]) => init?.headers && (init.headers as Record<string, string>)['Content-Type'] === 'application/json');
async function token(config: ShopifyConfig, staff = '12345') {
  const encode = (data: unknown) => Buffer.from(JSON.stringify(data)).toString('base64url');
  const now = Math.floor(Date.now() / 1000), header = encode({ alg: 'HS256' });
  const claims = encode({ aud: config.clientId, dest: `https://${config.shop}`, iss: `https://${config.shop}/admin`,
    sub: staff, iat: now, nbf: now, exp: now + 60 });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(config.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${Buffer.from(signature).toString('base64url')}`;
}
async function adminRequest(config: ShopifyConfig, body?: unknown, staff = '12345') {
  return new Request('https://game.example/api/admin/economy', { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${await token(config, staff)}`, Origin: 'https://game.example', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

describe('Shopify flag economy configuration', () => {
  it('rejects guests and non-allowlisted staff before any Shopify call', async () => {
    const { config, network } = fixture();
    expect((await handleAdminEconomy(new Request('https://game.example/api/admin/economy'), config, network, '12345')).status).toBe(401);
    expect((await handleAdminEconomy(await adminRequest(config, undefined, '999'), config, network, '12345')).status).toBe(403);
    expect((await handleAdminEconomy(await adminRequest(config, { version: 1, flagCoinPrice: 6000, compareDigest: null }, '999'), config, network, '12345')).status).toBe(403);
    expect(network).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, '6000', 1_000_000_001])('rejects invalid amounts without Shopify calls: %s', async flagCoinPrice => {
    const { config, network } = fixture();
    const response = await handleAdminEconomy(await adminRequest(config, { version: 1, flagCoinPrice, compareDigest: null }), config, network, '12345');
    expect(response.status).toBe(400);
    expect(network).not.toHaveBeenCalled();
  });

  it('starts with 5000 without creating any metafield', async () => {
    const { config, network } = fixture();
    expect(await loadEconomy(config, network)).toMatchObject({ economy: { version: 1, flagCoinPrice: 5000 }, compareDigest: null });
    expect(graphCalls(network)).toHaveLength(1);
  });

  it('stores only the game setting and server-attributed audit with a CAS digest', async () => {
    const { config, network } = fixture({ version: 1, flagCoinPrice: 5000, audit: [] });
    const response = await handleAdminEconomy(await adminRequest(config, { version: 1, flagCoinPrice: 6250, compareDigest: digest }), config, network, '12345');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 1, flagCoinPrice: 6250, compareDigest: nextDigest });
    const saved = JSON.parse(requestBody(network.mock.calls.at(-1)?.[1]));
    expect(saved.query).toContain('metafieldsSet');
    const field = saved.variables.metafields[0];
    expect(field).toMatchObject({ ownerId: 'gid://shopify/Shop/77', namespace: '$app:pfusch_game', key: 'economy_v1', type: 'json', compareDigest: digest });
    expect(JSON.parse(field.value)).toMatchObject({ version: 1, flagCoinPrice: 6250, audit: [{ actor: '12345', before: 5000, after: 6250 }] });
    expect(saved.query).not.toMatch(/productUpdate|order|discount/i);
  });

  it('rejects a stale dashboard snapshot and Shopify CAS conflicts', async () => {
    const stale = fixture({ version: 1, flagCoinPrice: 6000, audit: [] });
    await expect(saveEconomy(stale.config, stale.network, 7000, null, '12345')).rejects.toMatchObject({ status: 409, code: 'edit_conflict_reload' });
    expect(graphCalls(stale.network)).toHaveLength(1);
    const racing = fixture(null, [{ code: 'INVALID_COMPARE_DIGEST' }]);
    await expect(saveEconomy(racing.config, racing.network, 7000, null, '12345')).rejects.toMatchObject({ status: 409 });
  });

  it('rejects corrupt saved configuration instead of masking it as the default', async () => {
    const { config, network } = fixture({ version: 1, flagCoinPrice: -1, audit: [] });
    await expect(loadEconomy(config, network)).rejects.toMatchObject({ status: 502 });
  });

  it('coalesces public reads for 30 seconds and invalidates them after an admin save', async () => {
    const { config, network } = fixture();
    const start = Date.now();
    const results = await Promise.all(Array.from({ length: 10 }, () => readPublicEconomy(config, network, start)));
    expect(results.every(value => value.flagCoinPrice === 5000)).toBe(true);
    expect(graphCalls(network)).toHaveLength(1);
    await readPublicEconomy(config, network, start + 29_999);
    expect(graphCalls(network)).toHaveLength(1);
    await readPublicEconomy(config, network, start + 30_001);
    expect(graphCalls(network)).toHaveLength(2);
    await saveEconomy(config, network, 7000, null, '12345');
    await readPublicEconomy(config, network, start + 30_002);
    expect(graphCalls(network)).toHaveLength(5);
  });

  it('serves only the public price without customer authentication and rejects public writes', async () => {
    const { config, network } = fixture({ version: 1, flagCoinPrice: 6250, audit: [{ at: 1000, actor: '12345', before: 5000, after: 6250 }] });
    const env = { OXYGEN_APP_ORIGIN: 'https://game.example', SHOPIFY_SHOP_DOMAIN: config.shop,
      SHOPIFY_CLIENT_ID: config.clientId, SHOPIFY_CLIENT_SECRET: config.secret, SHOPIFY_ADMIN_ACCESS_TOKEN: config.adminToken,
      CUSTOMER_ACCOUNT_CLIENT_ID: 'customer-test', OXYGEN_SESSION_SECRET: 'a'.repeat(64) };
    const response = await handleOxygenRequest(new Request('https://game.example/api/game/economy'), env, '', network);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 1, flagCoinPrice: 6250 });
    expect(response.headers.get('cache-control')).toContain('no-store');
    const count = network.mock.calls.length;
    expect((await handleOxygenRequest(new Request('https://game.example/api/game/economy', { method: 'POST' }), env, '', network)).status).toBe(405);
    expect(network).toHaveBeenCalledTimes(count);
  });

  it('isolates public prices by configured shop and bounds failed-read retries', async () => {
    const first = fixture({ version: 1, flagCoinPrice: 6000, audit: [] });
    const second = fixture({ version: 1, flagCoinPrice: 7000, audit: [] });
    expect((await readPublicEconomy(first.config, first.network)).flagCoinPrice).toBe(6000);
    expect((await readPublicEconomy(second.config, second.network)).flagCoinPrice).toBe(7000);
    const bad = fixture({ version: 1, flagCoinPrice: -1, audit: [] });
    await expect(readPublicEconomy(bad.config, bad.network)).rejects.toMatchObject({ status: 502 });
    await expect(readPublicEconomy(bad.config, bad.network)).rejects.toMatchObject({ status: 502 });
    expect(graphCalls(bad.network)).toHaveLength(1);
  });
});
