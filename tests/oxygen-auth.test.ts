import { describe, expect, it, vi } from 'vitest';
import { authenticateOxygen, finishLogin, openCookie, readOxygenAuth, safeReturn, sealCookie, SESSION_COOKIE, startLogin } from '../server/oxygen/auth';
import { handleOxygenRequest } from '../server/oxygen/runtime';

const env = { OXYGEN_APP_ORIGIN: 'https://game.pfusch-clothing.ch', SHOPIFY_STOREFRONT_ORIGIN: 'https://pfusch-clothing.ch',
  SHOPIFY_SHOP_DOMAIN: 'gkhnzi-gc.myshopify.com', CUSTOMER_ACCOUNT_CLIENT_ID: 'customer-client', OXYGEN_SESSION_SECRET: 'a'.repeat(64),
  SHOPIFY_API_SECRET: 'test-admin-secret', SHOPIFY_ADMIN_ACCESS_TOKEN: 'test-admin-token' };
const config = readOxygenAuth(env)!;
const now = 1800000000000;
const endpoint = 'https://account.pfusch-clothing.ch';
function mockFetch() {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.endsWith('/.well-known/openid-configuration')) return Response.json({ authorization_endpoint: `${endpoint}/oauth/authorize`, token_endpoint: `${endpoint}/oauth/token` });
    if (url.endsWith('/.well-known/customer-account-api')) return Response.json({ graphql_api: `${endpoint}/customer/api/2026-10/graphql` });
    if (url.endsWith('/oauth/token')) return Response.json({ access_token: 'customer-access-secret', expires_in: 3600, id_token: 'unused-untrusted-id-token' });
    if (url.endsWith('/graphql')) return Response.json({ data: { customer: { id: 'gid://shopify/Customer/123' } } });
    throw new Error(`Unexpected fetch: ${url}`);
  });
}
function request(path: string, cookie?: string) {
  return new Request(config.origin + path, { headers: cookie ? { cookie } : {} });
}
describe('Oxygen Customer Account authentication', () => {
  it('uses state and PKCE, verifies customer through GraphQL, and issues only an encrypted HttpOnly cookie', async () => {
    const fetcher = mockFetch();
    const returnTo = 'https://pfusch-clothing.ch/?view=wheelie-escape&preview_theme_id=189577920841';
    const start = await startLogin(request(`/auth/login?return_to=${encodeURIComponent(returnTo)}`), config, fetcher, now);
    const authorize = new URL(start.headers.get('location')!);
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('code_challenge')).toHaveLength(43);
    const flowCookie = start.headers.get('set-cookie')!.split(';')[0];
    expect(flowCookie).not.toContain('verifier');
    const result = await finishLogin(request(`/auth/callback?code=one-use-code&state=${authorize.searchParams.get('state')}`, flowCookie), config, fetcher, now);
    expect(result.headers.get('location')).toBe(returnTo);
    const cookies = result.headers.getSetCookie();
    const session = cookies.find(value => value.startsWith(SESSION_COOKIE + '='))!;
    expect(session).toContain('Secure; HttpOnly; SameSite=None');
    expect(session).not.toContain('customer-access-secret');
    const exchange = fetcher.mock.calls.find(([url]) => String(url).endsWith('/oauth/token'))!;
    const verifier = new URLSearchParams(String(exchange[1]?.body)).get('code_verifier')!;
    const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
    expect(challenge).toBe(authorize.searchParams.get('code_challenge'));
    expect(await authenticateOxygen(request('/api/player?logged_in_customer_id=999', session.split(';')[0]), config, fetcher, now + 1000))
      .toEqual({ shop: config.shop, customerId: '123' });
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/graphql'))).toHaveLength(2);
  });

  it('rejects wrong state before exchanging any token', async () => {
    const fetcher = mockFetch();
    const start = await startLogin(request('/auth/login'), config, fetcher, now);
    const cookie = start.headers.get('set-cookie')!.split(';')[0];
    await expect(finishLogin(request('/auth/callback?code=code&state=wrong', cookie), config, fetcher, now)).rejects.toMatchObject({ code: 'invalid_oauth_state' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects replay of expired flow and duplicated callback parameters', async () => {
    const fetcher = mockFetch();
    const start = await startLogin(request('/auth/login'), config, fetcher, now);
    const state = new URL(start.headers.get('location')!).searchParams.get('state');
    const cookie = start.headers.get('set-cookie')!.split(';')[0];
    await expect(finishLogin(request(`/auth/callback?code=x&state=${state}`, cookie), config, fetcher, now + 600001)).rejects.toMatchObject({ code: 'invalid_oauth_state' });
    await expect(finishLogin(request(`/auth/callback?code=x&state=${state}&state=${state}`, cookie), config, fetcher, now)).rejects.toMatchObject({ code: 'invalid_oauth_state' });
  });

  it('binds encrypted cookies to purpose and application origin, and rejects tampering', async () => {
    const sealed = await sealCookie(config, 'session', { accessToken: 'secret', expires: now + 1000 });
    expect(await openCookie(config, 'flow', sealed)).toBeNull();
    expect(await openCookie({ ...config, origin: 'https://other.pfusch-clothing.ch' }, 'session', sealed)).toBeNull();
    const parts = sealed.split('.'); parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    expect(await openCookie(config, 'session', parts.join('.'))).toBeNull();
    await expect(sealCookie(config, 'session', { token: 'x'.repeat(2601) })).rejects.toMatchObject({ code: 'session_too_large' });
  });

  it('rejects expired sessions and identity changes without accepting a browser customer ID', async () => {
    const fetcher = mockFetch();
    const expired = await sealCookie(config, 'session', { accessToken: 'secret', expires: now - 1, customerId: '123' });
    await expect(authenticateOxygen(request('/api/player', `${SESSION_COOKIE}=${expired}`), config, fetcher, now)).rejects.toMatchObject({ status: 401 });
    expect(fetcher).not.toHaveBeenCalled();
    const mismatched = await sealCookie(config, 'session', { accessToken: 'secret', expires: now + 50000, customerId: '999' });
    await expect(authenticateOxygen(request('/api/player', `${SESSION_COOKIE}=${mismatched}`), config, fetcher, now)).rejects.toMatchObject({ status: 401 });
  });

  it('allows only exact trusted return origins and secure configuration', () => {
    expect(() => safeReturn('https://pfusch-clothing.ch.evil.example/', config)).toThrow();
    expect(() => safeReturn('https://evil.example/', config)).toThrow();
    expect(() => safeReturn(config.origin + '/auth/login', config)).toThrow();
    expect(readOxygenAuth({ ...env, OXYGEN_APP_ORIGIN: 'http://game.pfusch-clothing.ch' })).toBeNull();
    expect(readOxygenAuth({ ...env, OXYGEN_SESSION_SECRET: 'weak' })).toBeNull();
  });

  it('does not trust an off-domain discovery endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ authorization_endpoint: 'https://evil.example/authorize' }));
    await expect(startLogin(request('/auth/login'), config, fetcher, now)).rejects.toMatchObject({ code: 'invalid_discovery' });
  });
});

describe('Oxygen worker route boundaries', () => {
  it('injects only the fixed public transport configuration into the SPA', async () => {
    const response = await handleOxygenRequest(request('/'), env, '<html><head></head><body>GAME</body></html>', mockFetch());
    const html = await response.text();
    expect(html).toContain('id="pfusch-runtime-config">{"version":1,"mode":"oxygen"}');
    expect(html).not.toContain('test-admin-secret');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'self' https://pfusch-clothing.ch");
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('returns unauthenticated guest status without fetching any customer data', async () => {
    const fetcher = mockFetch();
    const response = await handleOxygenRequest(request('/api/player?logged_in_customer_id=123'), env, '', fetcher);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'login_required' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects cross-origin saves and logout before calling Shopify', async () => {
    const fetcher = mockFetch();
    for (const path of ['/api/player', '/auth/logout']) {
      const response = await handleOxygenRequest(new Request(config.origin + path, { method: 'POST', headers: { Origin: 'https://evil.example' } }), env, '', fetcher);
      expect(response.status).toBe(403);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
