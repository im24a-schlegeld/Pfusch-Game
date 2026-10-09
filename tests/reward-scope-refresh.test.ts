import { describe, expect, it, vi } from 'vitest';
import { handleRewardRequest } from '../server/shopify/rewardEndpoint';
import type { ShopifyConfig } from '../server/shopify/auth';

function fixture(id: string, grantDiscounts: boolean) {
  const config: ShopifyConfig = { shop: 'scope-test.myshopify.com', clientId: id, secret: 'test-only-scope-secret' };
  let exchanges = 0, reads = 0;
  const request = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/oauth/access_token')) {
      exchanges++;
      return Response.json({ access_token: `scope-token-${exchanges}`, expires_in: 86399,
        scope: grantDiscounts && exchanges > 1 ? 'write_customers,write_discounts' : 'write_customers' });
    }
    const body = JSON.parse(String(options?.body)) as { query: string; variables: { id: string } };
    expect(body.query).toContain('query GameRewardLedger');
    expect(body.query).not.toContain('mutation');
    reads++;
    const token = new Headers(options?.headers).get('X-Shopify-Access-Token');
    const granted = grantDiscounts && token !== 'scope-token-1';
    return Response.json({ data: { shop: { currencyCode: 'CHF' },
      currentAppInstallation: { accessScopes: (granted ? ['write_customers', 'write_discounts'] : ['write_customers']).map(handle => ({ handle })) },
      customer: { id: body.variables.id, metafield: null } } });
  });
  const status = () => handleRewardRequest('status', { method: 'GET', url: 'https://game.invalid/api/rewards/status', readBody: async () => ({}) },
    { config, enabled: true, request, authenticate: async () => ({ shop: config.shop, customerId: '123' }) });
  return { config, request, status, counts: () => ({ exchanges, reads }) };
}

describe('newly granted Shopify discount permission', () => {
  it('replaces an older cached token and rechecks scopes without any financial mutation', async () => {
    const f = fixture('scope-refresh-success-client', true);
    expect((await f.status()).body).toMatchObject({ available: true, eligible: false, reward: null });
    expect(f.counts()).toEqual({ exchanges: 2, reads: 2 });
    expect((await f.status()).body).toMatchObject({ available: true });
    expect(f.counts()).toEqual({ exchanges: 2, reads: 3 });
  });
  it('keeps issuance blocked after one refresh, exposes only the public app ID and bounds repeated exchanges', async () => {
    const f = fixture('scope-refresh-denied-client', false);
    const first = await f.status();
    expect(first.body).toMatchObject({ available: false, reason: 'discount_scope_missing',
      diagnostics: { adminClientId: f.config.clientId }, eligible: false, reward: null });
    const output = JSON.stringify(first.body);
    expect(output).not.toContain(f.config.secret);
    expect(output).not.toContain('scope-token-');
    expect((await f.status()).body).toMatchObject({ available: false, reason: 'discount_scope_missing' });
    expect(f.counts()).toEqual({ exchanges: 2, reads: 3 });
  });
});
