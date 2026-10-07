import { describe, expect, it, vi } from 'vitest';
import { createShopifyAdminTokenProvider } from '../server/shopify/adminToken';
import type { ShopifyConfig } from '../server/shopify/auth';
import { handlePlayerRequest, type PlayerRequest } from '../server/shopify/playerEndpoint';
import { shopifyGraphql } from '../server/shopify/playerStore';

let configurationId = 0;
const configuration = (): ShopifyConfig => ({
  shop: 'diagnostics-test.myshopify.com',
  clientId: `diagnostics-client-${++configurationId}`,
  secret: 'diagnostics-private-client-secret',
});
const privateDetails = 'customer@example.invalid diagnostics-private-client-secret private-access-token';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const token = () => json({ access_token: 'private-access-token', expires_in: 86399, scope: 'write_customers' });
const input = (): PlayerRequest => ({ method: 'GET', url: '/api/player', readBody: vi.fn() });
const authenticated = (config: ShopifyConfig, request: typeof fetch) => ({ config, request,
  authenticate: vi.fn(async () => ({ shop: config.shop, customerId: '123' })),
});

describe('Safe Shopify Admin diagnostics', () => {
  it.each(['shop_not_permitted', 'app_not_installed', 'application_cannot_be_found', 'invalid_client',
    'invalid_grant', 'unsupported_grant_type', 'invalid_request', 'access_denied'])
  ('preserves the known token error %s without the response description', async error => {
    const config = configuration();
    const request = vi.fn<typeof fetch>(async () => json({ error, error_description: privateDetails }, 400));
    await expect(createShopifyAdminTokenProvider()(config, request))
      .rejects.toMatchObject({ status: 503, code: `shopify_token_${error}`, message: `shopify_token_${error}` });
  });

  it.each([
    { error: privateDetails, error_description: privateDetails },
    { error: { message: privateDetails } },
    { error: 'invalid_client ' + privateDetails },
  ])('reduces unknown token errors to an HTTP status code', async response => {
    const request = vi.fn<typeof fetch>(async () => json(response, 401));
    await expect(createShopifyAdminTokenProvider()(configuration(), request))
      .rejects.toMatchObject({ status: 503, code: 'shopify_token_http_401', message: 'shopify_token_http_401' });
  });

  it('distinguishes an Admin HTTP failure from a token exchange failure', async () => {
    const request = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => token())
      .mockImplementationOnce(async () => new Response(privateDetails, { status: 403 }));
    await expect(shopifyGraphql(configuration(), 'query { shop { id } }', {}, request))
      .rejects.toMatchObject({ status: 503, code: 'shopify_admin_http_403' });
    expect(request).toHaveBeenCalledTimes(2);
    expect(String(request.mock.calls[0][0])).toContain('/admin/oauth/access_token');
    expect(String(request.mock.calls[1][0])).toContain('/graphql.json');
  });

  it.each([
    ['ACCESS_DENIED', 'shopify_admin_access_denied'],
    ['THROTTLED', 'shopify_admin_throttled'],
    ['UNKNOWN_UPSTREAM_CODE', 'shopify_admin_query_failed'],
  ])('classifies GraphQL %s without exposing customer data or partial results', async (code, diagnostic) => {
    const request = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => token())
      .mockImplementationOnce(async () => json({ data: { customer: { email: privateDetails } },
        errors: [{ message: privateDetails, extensions: { code, privateDetails } }] }));
    await expect(shopifyGraphql(configuration(), 'query { customer { id } }', {}, request))
      .rejects.toMatchObject({ status: 503, code: diagnostic, message: diagnostic });
  });

  it('stops before GraphQL when the token exchange is denied', async () => {
    const request = vi.fn<typeof fetch>(async () => json({ error: 'shop_not_permitted', error_description: privateDetails }, 400));
    await expect(shopifyGraphql(configuration(), 'query { shop { id } }', {}, request))
      .rejects.toMatchObject({ status: 503, code: 'shopify_token_shop_not_permitted' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(String(request.mock.calls[0][0])).toContain('/admin/oauth/access_token');
  });

  it.each([
    ['token', 'shopify_token_invalid_client'],
    ['http', 'shopify_admin_http_403'],
    ['graphql', 'shopify_admin_access_denied'],
  ])('returns only the safe %s diagnostic from an authenticated player request', async (stage, diagnostic) => {
    const config = configuration();
    const request = vi.fn<typeof fetch>(async url => {
      if (String(url).endsWith('/admin/oauth/access_token'))
        return stage === 'token' ? json({ error: 'invalid_client', error_description: privateDetails }, 401) : token();
      return stage === 'http' ? new Response(privateDetails, { status: 403 })
        : json({ data: { customer: { email: privateDetails } }, errors: [{ message: privateDetails,
          extensions: { code: 'ACCESS_DENIED' } }] });
    });
    const dependencies = authenticated(config, request);
    const result = await handlePlayerRequest(input(), dependencies);
    expect(dependencies.authenticate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 503, body: { error: diagnostic } });
    expect(JSON.stringify(result)).not.toContain(privateDetails);
    expect(request).toHaveBeenCalledTimes(stage === 'token' ? 1 : 2);
  });

  it('continues loading the verified customer after successful token and GraphQL responses', async () => {
    const config = configuration();
    const request = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => token())
      .mockImplementationOnce(async (_url, options) => {
        expect(new Headers(options?.headers).get('X-Shopify-Access-Token')).toBe('private-access-token');
        expect(JSON.parse(options!.body as string).variables.id).toBe('gid://shopify/Customer/123');
        return json({ data: { customer: { id: 'gid://shopify/Customer/123',
          emailMarketingConsent: { marketingState: 'SUBSCRIBED' }, metafield: null } } });
      });
    const result = await handlePlayerRequest(input(), authenticated(config, request));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ customer: { id: '123' }, player: null, compareDigest: null });
    expect(result.body.csrfToken).toEqual(expect.any(String));
    expect(result.body).not.toHaveProperty('error');
    expect(JSON.stringify(result)).not.toContain('private-access-token');
    expect(JSON.stringify(result)).not.toContain(config.secret);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('loads the player on a worker that rejects the error redirect mode', async () => {
    const config = configuration();
    const request = vi.fn<typeof fetch>(async (url, options) => {
      if (options?.redirect === 'error') throw new TypeError('Unsupported redirect mode: error');
      if (String(url).endsWith('/admin/oauth/access_token')) return token();
      return json({ data: { customer: { id: 'gid://shopify/Customer/123',
        emailMarketingConsent: { marketingState: 'SUBSCRIBED' }, metafield: null } } });
    });
    const result = await handlePlayerRequest(input(), authenticated(config, request));
    expect(result.status).toBe(200);
    expect(result.body.customer).toEqual({ id: '123' });
    expect(request).toHaveBeenCalledTimes(2);
    for (const [, options] of request.mock.calls) expect(options?.redirect).toBe('manual');
  });

  it.each([302, 307])('rejects a token HTTP %s redirect without forwarding credentials or exposing its body', async status => {
    const config = configuration();
    const redirectTarget = 'https://untrusted.example.invalid/capture';
    const request = vi.fn<typeof fetch>(async () => new Response(privateDetails, {
      status, headers: { Location: redirectTarget },
    }));
    const result = await handlePlayerRequest(input(), authenticated(config, request));
    expect(result).toEqual({ status: 503, body: { error: `shopify_token_http_${status}` } });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe(`https://${config.shop}/admin/oauth/access_token`);
    expect(request.mock.calls[0][1]?.redirect).toBe('manual');
    expect(JSON.stringify(result)).not.toContain(redirectTarget);
  });

  it.each([302, 307])('rejects an Admin HTTP %s redirect without forwarding the token or exposing its body', async status => {
    const config = configuration();
    const redirectTarget = 'https://untrusted.example.invalid/capture';
    const request = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => token())
      .mockImplementationOnce(async () => new Response(privateDetails, {
        status, headers: { Location: redirectTarget },
      }));
    const result = await handlePlayerRequest(input(), authenticated(config, request));
    expect(result).toEqual({ status: 503, body: { error: `shopify_admin_http_${status}` } });
    expect(request).toHaveBeenCalledTimes(2);
    for (const [url, options] of request.mock.calls) {
      expect(new URL(String(url)).hostname).toBe(config.shop);
      expect(options?.redirect).toBe('manual');
    }
    expect(String(request.mock.calls[1][0])).toContain('/graphql.json');
    expect(JSON.stringify(result)).not.toContain(redirectTarget);
  });
});
