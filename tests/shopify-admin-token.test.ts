import { describe, expect, it, vi } from 'vitest';
import { newPlayer } from '../app/domain/progression';
import { readShopifyConfig, type ShopifyConfig } from '../server/shopify/auth';
import { createShopifyAdminTokenProvider } from '../server/shopify/adminToken';
import { loadCustomerPlayer, saveCustomerPlayer } from '../server/shopify/playerStore';
import { updateRanking } from '../server/shopify/leaderboard';

const config: ShopifyConfig = { shop: 'pfusch-test.myshopify.com', clientId: 'test-client', secret: 'test-client-secret' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const tokenResponse = (token = 'test-access-token') => json({ access_token: token, expires_in: 86399, scope: 'write_customers,write_app_proxy' });

describe('Dev Dashboard server authentication', () => {
  it('uses the installed app client secret for OAuth and proxy signatures, without requiring a static token', () => {
    expect(readShopifyConfig({ SHOPIFY_SHOP_DOMAIN: config.shop, SHOPIFY_CLIENT_ID: config.clientId,
      SHOPIFY_CLIENT_SECRET: config.secret })).toEqual(config);
    expect(readShopifyConfig({ SHOPIFY_SHOP_DOMAIN: config.shop, SHOPIFY_CLIENT_ID: config.clientId,
      SHOPIFY_CLIENT_SECRET: config.secret, SHOPIFY_API_SECRET: 'old-secret', SHOPIFY_ADMIN_ACCESS_TOKEN: 'old-token' })).toEqual(config);
  });
  it.each(['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'])('fails closed with incomplete %s credentials instead of using a different legacy app', key => {
    expect(readShopifyConfig({ SHOPIFY_SHOP_DOMAIN: config.shop, [key]: 'test', SHOPIFY_API_SECRET: 'old-secret',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'old-token' })).toBeNull();
  });
  it('continues to support a legacy static token without an exchange', async () => {
    const request = vi.fn<typeof fetch>();
    await expect(createShopifyAdminTokenProvider()({ shop: config.shop, secret: 'legacy-secret', adminToken: 'legacy-token' }, request))
      .resolves.toBe('legacy-token');
    expect(request).not.toHaveBeenCalled();
  });
  it('posts credentials to only the configured shop and reuses the token until one minute before expiry', async () => {
    let now = 1000;
    const getToken = createShopifyAdminTokenProvider(() => now);
    const request = vi.fn<typeof fetch>().mockImplementationOnce(async () => tokenResponse('first-token'))
      .mockImplementationOnce(async () => tokenResponse('second-token'));
    expect(await getToken(config, request)).toBe('first-token');
    const [url, options] = request.mock.calls[0];
    expect(url).toBe(`https://${config.shop}/admin/oauth/access_token`);
    expect(options).toMatchObject({ method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    expect(Object.fromEntries(new URLSearchParams(options!.body as string))).toEqual({
      grant_type: 'client_credentials', client_id: config.clientId, client_secret: config.secret,
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    now += 86_339_000 - 1;
    expect(await getToken(config, request)).toBe('first-token');
    expect(request).toHaveBeenCalledTimes(1);
    now++;
    expect(await getToken(config, request)).toBe('second-token');
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('shares one in-flight exchange for concurrent requests', async () => {
    let resolve!: (response: Response) => void;
    const request = vi.fn<typeof fetch>(() => new Promise<Response>(done => { resolve = done; }));
    const getToken = createShopifyAdminTokenProvider();
    const first = getToken(config, request), second = getToken(config, request);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    resolve(tokenResponse());
    await expect(Promise.all([first, second])).resolves.toEqual(['test-access-token', 'test-access-token']);
  });
  it('does not reuse cached credentials after a secret or shop changes', async () => {
    const getToken = createShopifyAdminTokenProvider();
    const request = vi.fn<typeof fetch>(async () => tokenResponse());
    await getToken(config, request);
    await getToken({ ...config, secret: 'rotated-secret' }, request);
    await getToken({ ...config, shop: 'other.myshopify.com' }, request);
    await getToken(config, request);
    expect(request).toHaveBeenCalledTimes(4);
  });
  it('fails closed on refresh failure, exposes no upstream secrets and retries on the next request', async () => {
    let now = 0;
    const getToken = createShopifyAdminTokenProvider(() => now);
    const request = vi.fn<typeof fetch>().mockImplementationOnce(async () => tokenResponse())
      .mockImplementationOnce(async () => json({ error: config.secret }, 401))
      .mockImplementationOnce(async () => tokenResponse('replacement-token'));
    await getToken(config, request);
    now = 86_399_000;
    await expect(getToken(config, request)).rejects.toMatchObject({ status: 503, message: 'shopify_token_http_401' });
    expect(await getToken(config, request)).toBe('replacement-token');
    expect(request).toHaveBeenCalledTimes(3);
  });
  it.each([
    null,
    { access_token: 'token', expires_in: 0, scope: 'write_customers' },
    { access_token: 'token', expires_in: 86401, scope: 'write_customers' },
    { access_token: 'token', expires_in: '86399', scope: 'write_customers' },
    { access_token: 'header\rinjection', expires_in: 86399, scope: 'write_customers' },
    { access_token: 'token', expires_in: 86399 },
    { access_token: 'x'.repeat(17000), expires_in: 86399, scope: 'write_customers' },
  ])('rejects malformed, expired or insufficiently scoped token responses', async value => {
    await expect(createShopifyAdminTokenProvider()(config, vi.fn(async () => json(value))))
      .rejects.toMatchObject({ status: 503, message: 'shopify_token_invalid_response' });
  });
  it('identifies a granted token without the required customer write scope', async () => {
    await expect(createShopifyAdminTokenProvider()(config, vi.fn(async () => json({ access_token: 'token', expires_in: 86399, scope: 'read_customers' }))))
      .rejects.toMatchObject({ status: 503, message: 'shopify_token_scope_missing' });
  });
  it('fails closed for network failures and malformed JSON', async () => {
    await expect(createShopifyAdminTokenProvider()(config, vi.fn(async () => { throw new Error(config.secret); })))
      .rejects.toMatchObject({ status: 503, message: 'shopify_token_request_failed' });
    await expect(createShopifyAdminTokenProvider()(config, vi.fn(async () => new Response('invalid'))))
      .rejects.toMatchObject({ status: 503, message: 'shopify_token_invalid_response' });
  });
  it('rejects a token already within its refresh margin when the response finally arrives', async () => {
    let now = 0;
    const request = vi.fn<typeof fetch>(async () => { now = 86_399_000; return tokenResponse(); });
    await expect(createShopifyAdminTokenProvider(() => now)(config, request)).rejects.toThrow('shopify_token_expired_response');
  });
  it('authenticates customer reads, customer saves and ranking with the same server token provider', async () => {
    const requests: string[] = [];
    const request = vi.fn<typeof fetch>(async (url, options) => {
      if (String(url).endsWith('/oauth/access_token')) return tokenResponse('integration-token');
      expect(new Headers(options?.headers).get('X-Shopify-Access-Token')).toBe('integration-token');
      const { query } = JSON.parse(options!.body as string) as { query: string };
      requests.push(query);
      if (query.includes('query GamePlayer')) return json({ data: { customer: { id: 'gid://shopify/Customer/123',
        emailMarketingConsent: { marketingState: 'SUBSCRIBED' }, metafield: null } } });
      if (query.includes('query GameRanking')) return json({ data: { shop: { id: 'gid://shopify/Shop/456', metafield: null } } });
      return json({ data: { metafieldsSet: { metafields: [{ compareDigest: 'a'.repeat(64) }], userErrors: [] } } });
    });
    const integrationConfig = { ...config, clientId: 'integration-client' };
    const player = { ...newPlayer(), highScore: 100 };
    expect((await loadCustomerPlayer(integrationConfig, '123', request)).marketingState).toBe('SUBSCRIBED');
    await saveCustomerPlayer(integrationConfig, '123', player, null, request);
    await updateRanking(integrationConfig, '123', player, request);
    expect(request).toHaveBeenCalledTimes(5);
    expect(requests).toHaveLength(4);
  });
});
