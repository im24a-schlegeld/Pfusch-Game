import { describe, expect, it, vi } from 'vitest';
import { authenticateOxygen, finishLogin, openCookie, readOxygenAuth, REFRESH_COOKIE, safeReturn, sealCookie, SESSION_COOKIE, startLogin } from '../server/oxygen/auth';
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

  it('accepts an empty GraphQL errors list only with a verified customer', async () => {
    const fetcher = mockFetch();
    fetcher.mockImplementation(async (input) => String(input).endsWith('/.well-known/customer-account-api')
      ? Response.json({ graphql_api: `${endpoint}/customer/api/2026-10/graphql` })
      : Response.json({ errors: [], data: { customer: { id: 'gid://shopify/Customer/123' } } }));
    const session = await sealCookie(config, 'session', { accessToken: 'secret', expires: now + 50000, customerId: '123' });
    expect(await authenticateOxygen(request('/api/player', `${SESSION_COOKIE}=${session}`), config, fetcher, now))
      .toEqual({ shop: config.shop, customerId: '123' });
  });
});

describe('renewable Oxygen sessions', () => {
  async function renewableCookies(id = '123', time = now) {
    const refreshId = crypto.randomUUID(), validUntil = time + 86400000;
    const session = await sealCookie(config, 'session', { accessToken: 'old-access', customerId: id,
      expires: time - 1, validUntil, refreshId });
    const refresh = await sealCookie(config, 'refresh', { refreshToken: 'rotating-refresh', customerId: id, expires: validUntil, refreshId });
    return `${SESSION_COOKIE}=${session}; ${REFRESH_COOKIE}=${refresh}`;
  }
  function refreshingFetch(status = 200, customer = '123') {
    return vi.fn<typeof fetch>(async input => {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration')) return Response.json({ token_endpoint: `${endpoint}/oauth/token` });
      if (url.endsWith('/.well-known/customer-account-api')) return Response.json({ graphql_api: `${endpoint}/graphql` });
      if (url.endsWith('/oauth/token')) return status === 200
        ? Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 })
        : Response.json({ error: status === 400 ? 'invalid_grant' : 'temporarily_unavailable' }, { status });
      if (url.endsWith('/graphql')) return Response.json({ data: { customer: { id: `gid://shopify/Customer/${customer}` } } });
      throw new Error('Unexpected auth request');
    });
  }
  it('keeps refresh-capable login for 30 days while encrypting both tokens in separate HttpOnly cookies', async () => {
    const fetcher = mockFetch();
    const initial = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (input, init) => String(input).endsWith('/oauth/token')
      ? Response.json({ access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600 }) : initial(input, init));
    const start = await startLogin(request('/auth/login'), config, fetcher, now);
    const state = new URL(start.headers.get('location')!).searchParams.get('state');
    const finish = await finishLogin(request(`/auth/callback?code=code&state=${state}`, start.headers.getSetCookie()[0].split(';')[0]), config, fetcher, now);
    const cookies = finish.headers.getSetCookie().filter(value => value.startsWith(SESSION_COOKIE + '=') || value.startsWith(REFRESH_COOKIE + '='));
    expect(cookies).toHaveLength(2);
    for (const value of cookies) {
      expect(value).toContain('Secure; HttpOnly; SameSite=None; Max-Age=2592000');
      expect(value).not.toContain('secret'); expect(value.length).toBeLessThan(4096);
    }
  });
  it('renews expired access and shares one rotation across concurrent protected requests', async () => {
    const cookies = await renewableCookies(), fetcher = refreshingFetch(), updateA = vi.fn(), updateB = vi.fn();
    const [a, b] = await Promise.all([
      authenticateOxygen(request('/api/player', cookies), config, fetcher, now, updateA),
      authenticateOxygen(request('/api/leaderboard', cookies), config, fetcher, now, updateB),
    ]);
    expect(a).toEqual({ shop: config.shop, customerId: '123' }); expect(b).toEqual(a);
    const exchanges = fetcher.mock.calls.filter(([url]) => String(url).endsWith('/oauth/token'));
    expect(exchanges).toHaveLength(1);
    expect(new URLSearchParams(String(exchanges[0][1]?.body)).get('grant_type')).toBe('refresh_token');
    expect(updateA).toHaveBeenCalledWith(updateB.mock.calls[0][0]);
    const updated = updateA.mock.calls[0][0] as string[];
    const session = updated.find(value => value.startsWith(SESSION_COOKIE + '='))!.split(';')[0].slice(SESSION_COOKIE.length + 1);
    expect(await openCookie(config, 'session', session)).toMatchObject({ customerId: '123', accessToken: 'new-access', expires: now + 3600000 });
  });
  it.each([400, 503])('distinguishes a revoked refresh from an upstream failure (%s)', async status => {
    const update = vi.fn();
    await expect(authenticateOxygen(request('/api/player', await renewableCookies()), config, refreshingFetch(status), now + 60001, update))
      .rejects.toMatchObject({ status: status === 400 ? 401 : 503 });
    expect(update).not.toHaveBeenCalled();
  });
  it('does not erase another worker\'s newly rotated cookie during a short concurrent-refresh race', async () => {
    const update = vi.fn();
    await expect(authenticateOxygen(request('/api/player', await renewableCookies()), config, refreshingFetch(400), now, update))
      .rejects.toMatchObject({ status: 503 });
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects a refresh cookie belonging to another session', async () => {
    const a = await renewableCookies(), b = await renewableCookies(), fetcher = refreshingFetch();
    await expect(authenticateOxygen(request('/api/player', `${a.split('; ')[0]}; ${b.split('; ')[1]}`), config, fetcher, now))
      .rejects.toMatchObject({ status: 401 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not lose a successfully rotated token to an unrelated identity API outage', async () => {
    const fetcher = refreshingFetch(), underlying = fetcher.getMockImplementation()!, update = vi.fn();
    fetcher.mockImplementation(async (input, init) => String(input).includes('/graphql') || String(input).endsWith('/.well-known/customer-account-api')
      ? Response.json({ errors: 'temporarily unavailable' }, { status: 503 }) : underlying(input, init));
    expect(await authenticateOxygen(request('/api/player', await renewableCookies()), config, fetcher, now, update))
      .toEqual({ shop: config.shop, customerId: '123' });
    expect(update).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/graphql'))).toBe(false);
  });
  it('returns both rotated cookies even when the subsequent player service is unavailable', async () => {
    const time = Date.now(), fetcher = refreshingFetch(), underlying = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (input, init) => String(input).includes('/admin/api/')
      ? Response.json({ errors: 'temporarily unavailable' }, { status: 503 }) : underlying(input, init));
    const result = await handleOxygenRequest(request('/api/player', await renewableCookies('123', time)), env, '', fetcher);
    expect(result.status).toBe(503);
    expect(result.headers.getSetCookie()).toHaveLength(2);
    expect(result.headers.getSetCookie().every(value => value.includes('Max-Age=2592000'))).toBe(true);
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

  it.each(['THROTTLED', 'INTERNAL_SERVER_ERROR', 'SHOP_INACTIVE', 'UNEXPECTED_UPSTREAM_ERROR'])
    ('retains the login cookie and fails closed on a GraphQL %s error', async (code) => {
      const session = await sealCookie(config, 'session', { accessToken: 'valid-customer-token', expires: Date.now() + 60000, customerId: '123' });
      const fetcher = vi.fn<typeof fetch>(async (input) => {
        if (String(input).endsWith('/.well-known/customer-account-api'))
          return Response.json({ graphql_api: `${endpoint}/customer/api/2026-10/graphql` });
        if (String(input).endsWith('/graphql'))
          return Response.json({ errors: [{ message: 'Customer API could not complete the query', extensions: { code } }] });
        throw new Error(`Unexpected fetch: ${input}`);
      });
      const response = await handleOxygenRequest(request('/api/player', `${SESSION_COOKIE}=${session}`), env, '', fetcher);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'customer_account_unavailable' });
      expect(response.headers.get('set-cookie')).toBeNull();
      // No customer save or reward request may follow an unverified identity.
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

  it('clears the login cookie when the Customer Account API rejects credentials with HTTP 401', async () => {
    const session = await sealCookie(config, 'session', { accessToken: 'rejected-customer-token', expires: Date.now() + 60000, customerId: '123' });
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).endsWith('/.well-known/customer-account-api')
      ? Response.json({ graphql_api: `${endpoint}/customer/api/2026-10/graphql` })
      : Response.json({ errors: 'User does not have access' }, { status: 401 }));
    const response = await handleOxygenRequest(request('/api/player', `${SESSION_COOKIE}=${session}`), env, '', fetcher);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'login_required' });
    expect(response.headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=;`);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
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
