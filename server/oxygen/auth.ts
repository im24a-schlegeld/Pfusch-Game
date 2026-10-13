import { ApiError, type CustomerIdentity } from '../shopify/auth.js';

export const SHOP_ORIGINS = ['https://pfusch-clothing.ch', 'https://www.pfusch-clothing.ch'];
export const SESSION_COOKIE = '__Host-wheelie_session';
export const REFRESH_COOKIE = '__Host-wheelie_refresh';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const FLOW_COOKIE = '__Host-wheelie_flow';
const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const bytes = (value: string) => new TextEncoder().encode(value);
const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export interface OxygenAuthConfig { origin: string; storefront: string; customerAccountOrigin: string; clientId: string; clientSecret?: string; sessionSecret: string; shop: string }
export function readOxygenAuth(env: Record<string, string | undefined>): OxygenAuthConfig | null {
  try {
    const origin = new URL(env.OXYGEN_APP_ORIGIN ?? ''), storefront = new URL(env.SHOPIFY_STOREFRONT_ORIGIN ?? 'https://pfusch-clothing.ch');
    const shop = env.SHOPIFY_SHOP_DOMAIN ?? '', customerAccountOrigin = new URL(env.CUSTOMER_ACCOUNT_ORIGIN ?? storefront.href);
    const clientId = env.CUSTOMER_ACCOUNT_CLIENT_ID ?? env.PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID ?? '', sessionSecret = env.OXYGEN_SESSION_SECRET ?? '';
    const trustedAccountHost = (host: string) => host === shop || host.endsWith('.shopify.com') || host === 'pfusch-clothing.ch' || host.endsWith('.pfusch-clothing.ch');
    if (origin.protocol !== 'https:' || origin.href !== origin.origin + '/' || origin.username || origin.password
      || !SHOP_ORIGINS.includes(storefront.origin) || storefront.href !== storefront.origin + '/'
      || customerAccountOrigin.protocol !== 'https:' || customerAccountOrigin.href !== customerAccountOrigin.origin + '/' || customerAccountOrigin.username || customerAccountOrigin.password
      || !trustedAccountHost(customerAccountOrigin.hostname)
      || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) || !clientId || clientId.length > 200
      || !/^[a-f0-9]{64}$/i.test(sessionSecret)) return null;
    return { origin: origin.origin, storefront: storefront.origin, customerAccountOrigin: customerAccountOrigin.origin, clientId, sessionSecret, shop,
      clientSecret: env.CUSTOMER_ACCOUNT_CLIENT_SECRET || undefined };
  } catch { return null; }
}
async function key(config: OxygenAuthConfig) {
  const raw = Uint8Array.from(config.sessionSecret.match(/../g)!, value => parseInt(value, 16));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function sealCookie(config: OxygenAuthConfig, purpose: string, value: object) {
  const plain = bytes(JSON.stringify(value));
  if (plain.length > 2600) throw new ApiError(503, 'session_too_large');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: bytes(`${purpose}:${config.origin}`) }, await key(config), plain);
  return `v1.${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}
export async function openCookie(config: OxygenAuthConfig, purpose: string, value: string | null): Promise<Record<string, unknown> | null> {
  if (!value || value.length > 3600 || !/^v1\.[\w-]{16}\.[\w-]+$/.test(value)) return null;
  try {
    const [, iv, encrypted] = value.split('.');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: bytes(`${purpose}:${config.origin}`) }, await key(config), decode(encrypted));
    const result: unknown = JSON.parse(new TextDecoder().decode(plain));
    return record(result) ? result : null;
  } catch { return null; }
}
function cookie(request: Request, name: string) {
  const header = request.headers.get('cookie') ?? '';
  if (header.length > 16384) return null;
  const matches = header.split(';').map(value => value.trim()).filter(value => value.startsWith(name + '='));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : null;
}
export const sessionCookie = (value: string, seconds: number) => `${SESSION_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=${seconds}`;
const refreshCookie = (value: string, seconds: number) => `${REFRESH_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=${seconds}`;
export const clearSessionCookies = () => [sessionCookie('', 0), refreshCookie('', 0)];
const flowCookie = (value: string, seconds: number) => `${FLOW_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
export function safeReturn(value: string | null, config: OxygenAuthConfig) {
  if (!value) return config.origin + '/';
  if (value.length > 2048) throw new ApiError(400, 'invalid_return');
  let target: URL;
  try { target = new URL(value); } catch { throw new ApiError(400, 'invalid_return'); }
  if (![config.origin, ...SHOP_ORIGINS].includes(target.origin) || target.username || target.password
    || (target.origin === config.origin && /^\/(?:auth|api)(?:\/|$)/.test(target.pathname))) throw new ApiError(400, 'invalid_return');
  return target.href;
}
function endpoint(value: unknown, config: OxygenAuthConfig) {
  if (typeof value !== 'string') throw new ApiError(503, 'discovery_unavailable');
  const url = new URL(value), host = url.hostname;
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    !(host === 'shopify.com' || host.endsWith('.shopify.com') || host === config.shop
      || host === 'pfusch-clothing.ch' || host.endsWith('.pfusch-clothing.ch'))) throw new ApiError(503, 'invalid_discovery');
  return url.href;
}
function trustedHost(host: string, config: OxygenAuthConfig) {
  return host === 'shopify.com' || host.endsWith('.shopify.com') || host === config.shop
    || host === 'pfusch-clothing.ch' || host.endsWith('.pfusch-clothing.ch');
}
async function trustedRequest(url: string, config: OxygenAuthConfig, fetcher: typeof fetch, init: RequestInit) {
  // Never forward an OAuth token/body through a 307/308 before checking its destination.
  const response = await fetcher(url, { ...init, redirect: 'manual' });
  if (response.url) {
    let final: URL;
    try { final = new URL(response.url); } catch { throw new ApiError(503, 'invalid_discovery'); }
    if (final.protocol !== 'https:' || !trustedHost(final.hostname, config)) throw new ApiError(503, 'invalid_discovery');
  }
  return response;
}
async function objectResponse(response: Response, oauthError = false) {
  if (!response.ok && !(oauthError && response.status === 400)) throw new ApiError(response.status === 401 ? 401 : 503, response.status === 401 ? 'login_required' : 'customer_account_unavailable');
  const text = await response.text();
  if (text.length > 65536) throw new ApiError(503, 'invalid_customer_response');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ApiError(503, 'invalid_customer_response'); }
  if (!record(value)) throw new ApiError(503, 'invalid_customer_response');
  return value;
}
async function discovery(config: OxygenAuthConfig, fetcher: typeof fetch, kind: 'openid-configuration' | 'customer-account-api') {
  // A shop's vanity domain can redirect or omit the Customer Account
  // discovery document. Shopify's canonical myshopify domain is the stable
  // fallback while the configured storefront remains the preferred origin.
  const origins = [...new Set([config.customerAccountOrigin, config.storefront, `https://${config.shop}`])];
  let failure: unknown;
  for (const origin of origins) {
    try {
      const response = await fetcher(`${origin}/.well-known/${kind}`, { redirect: 'follow', headers: { Accept: 'application/json', 'User-Agent': 'WheelieEscape/1.0' } });
      if (response.url) {
        const final = new URL(response.url);
        const trusted = final.protocol === 'https:' && (final.hostname === config.shop
          || final.hostname.endsWith('.shopify.com') || final.hostname === 'pfusch-clothing.ch'
          || final.hostname.endsWith('.pfusch-clothing.ch'));
        if (!trusted) throw new ApiError(503, 'invalid_discovery');
      }
      return await objectResponse(response);
    } catch (error) {
      failure = error;
    }
  }
  throw failure instanceof ApiError ? failure : new ApiError(503, 'discovery_unavailable');
}
export async function startLogin(request: Request, config: OxygenAuthConfig, fetcher: typeof fetch, now = Date.now()) {
  const parameters = new URL(request.url).searchParams;
  if (parameters.getAll('return_to').length > 1) throw new ApiError(400, 'invalid_return');
  const returnTo = safeReturn(parameters.get('return_to'), config), state = random(), verifier = random();
  const info = await discovery(config, fetcher, 'openid-configuration');
  const authorize = new URL(endpoint(info.authorization_endpoint, config));
  authorize.search = new URLSearchParams({ client_id: config.clientId, response_type: 'code', scope: 'openid email customer-account-api:full',
    redirect_uri: config.origin + '/auth/callback', state, code_challenge_method: 'S256',
    code_challenge: encode(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(verifier)))) }).toString();
  const sealed = await sealCookie(config, 'flow', { state, verifier, returnTo, expires: now + 600000 });
  return new Response(null, { status: 302, headers: { Location: authorize.href, 'Set-Cookie': flowCookie(sealed, 600) } });
}
async function customerId(accessToken: string, config: OxygenAuthConfig, fetcher: typeof fetch): Promise<string> {
  const info = await discovery(config, fetcher, 'customer-account-api');
  const data = await objectResponse(await trustedRequest(endpoint(info.graphql_api, config), config, fetcher, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: accessToken, Origin: config.origin, 'User-Agent': 'WheelieEscape/1.0' },
    body: JSON.stringify({ query: 'query WheelieIdentity { customer { id } }' }) }));
  // Shopify can return throttling and internal failures as GraphQL 200 errors.
  // They cannot establish identity, but must not expire a valid login cookie.
  if (data.errors !== undefined && (!Array.isArray(data.errors) || data.errors.length > 0))
    throw new ApiError(503, 'customer_account_unavailable');
  const customer = record(data.data) && record(data.data.customer) ? data.data.customer : null;
  const match = typeof customer?.id === 'string' && /^gid:\/\/shopify\/Customer\/([1-9]\d{0,19})$/.exec(customer.id);
  if (!match) throw new ApiError(401, 'login_required');
  return match[1];
}
function tokenHeaders(config: OxygenAuthConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Origin: config.origin, 'User-Agent': 'WheelieEscape/1.0' };
  if (config.clientSecret) headers.Authorization = `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`;
  return headers;
}
function validTokens(tokens: Record<string, unknown>): tokens is Record<string, unknown> & { access_token: string; expires_in: number } {
  return typeof tokens.access_token === 'string' && tokens.access_token.length > 0 && tokens.access_token.length <= 2300
    && typeof tokens.expires_in === 'number' && Number.isFinite(tokens.expires_in) && tokens.expires_in >= 1;
}
async function loginCookies(tokens: Record<string, unknown>, customer: string, config: OxygenAuthConfig, now: number, previousRefresh?: string) {
  if (!validTokens(tokens)) throw new ApiError(503, 'invalid_token_response');
  const refresh = typeof tokens.refresh_token === 'string' && tokens.refresh_token ? tokens.refresh_token : previousRefresh;
  if (refresh && refresh.length > 2300) throw new ApiError(503, 'invalid_token_response');
  const accessSeconds = Math.min(SESSION_SECONDS, Math.floor(tokens.expires_in));
  const seconds = refresh ? SESSION_SECONDS : accessSeconds;
  const refreshId = refresh ? random() : undefined;
  const sealed = await sealCookie(config, 'session', { accessToken: tokens.access_token, customerId: customer,
    expires: now + accessSeconds * 1000, validUntil: now + seconds * 1000, ...(refreshId ? { refreshId } : {}) });
  // Split encrypted cookies keep an access JWT plus refresh token below the browser's per-cookie limit.
  const refreshed = refresh ? await sealCookie(config, 'refresh', { refreshToken: refresh, customerId: customer, refreshId, expires: now + seconds * 1000 }) : '';
  return [sessionCookie(sealed, seconds), refreshCookie(refreshed, refresh ? seconds : 0)];
}
// Simultaneous player/ranking/reward requests share one rotation in this worker.
// Only a short, bounded cache of successful rotations is retained server-side.
const rotations = new Map<string, { until: number; promise: Promise<{ id: string; cookies: string[] }> }>();
async function rotateSession(raw: string, refreshToken: string, customer: string, config: OxygenAuthConfig, fetcher: typeof fetch, now: number, accessExpires: number) {
  const cacheKey = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(`${config.origin}:${config.clientId}:${raw}`))));
  for (const [id, value] of rotations) if (value.until <= now) rotations.delete(id);
  const cached = rotations.get(cacheKey);
  if (cached) return cached.promise;
  const promise = (async () => {
    const info = await discovery(config, fetcher, 'openid-configuration');
    const response = await trustedRequest(endpoint(info.token_endpoint, config), config, fetcher, { method: 'POST', headers: tokenHeaders(config),
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: config.clientId, refresh_token: refreshToken }) });
    if (response.status === 400) {
      const error = await objectResponse(response, true);
      if (['invalid_grant', 'invalid_token'].includes(String(error.error))) {
        // A concurrent worker may already have rotated this token. Briefly keep
        // the cookie so its successful response can arrive; never grant access
        // on this error, and require login after the bounded one-minute grace.
        if (accessExpires <= now + 30000 && now - accessExpires < 60000) throw new ApiError(503, 'customer_account_unavailable');
        throw new ApiError(401, 'login_required');
      }
      throw new ApiError(503, 'customer_account_unavailable');
    }
    const tokens = await objectResponse(response);
    if (!validTokens(tokens)) throw new ApiError(503, 'invalid_token_response');
    const cachedRotation = rotations.get(cacheKey);
    if (cachedRotation) cachedRotation.until = Math.min(cachedRotation.until, now + Math.floor(tokens.expires_in) * 1000);
    // A successful OAuth refresh keeps the principal of this encrypted,
    // session-bound refresh token. Identity was verified during the code flow;
    // no browser or unverified JWT claim supplies it. Do not risk discarding a
    // rotated token because a second, unrelated GraphQL request times out.
    return { id: customer, cookies: await loginCookies(tokens, customer, config, now, refreshToken) };
  })();
  if (rotations.size >= 128) rotations.delete(rotations.keys().next().value!);
  rotations.set(cacheKey, { until: now + 60000, promise });
  try { return await promise; } catch (error) { rotations.delete(cacheKey); throw error; }
}
export async function finishLogin(request: Request, config: OxygenAuthConfig, fetcher: typeof fetch, now = Date.now()) {
  const params = new URL(request.url).searchParams, flow = await openCookie(config, 'flow', cookie(request, FLOW_COOKIE));
  if (!flow || typeof flow.expires !== 'number' || flow.expires < now || flow.expires > now + 600000
    || typeof flow.state !== 'string' || typeof flow.verifier !== 'string' || typeof flow.returnTo !== 'string'
    || params.getAll('state').length !== 1 || params.getAll('code').length !== 1 || params.has('error')
    || params.get('state') !== flow.state || !params.get('code') || params.get('code')!.length > 4096) throw new ApiError(400, 'invalid_oauth_state');
  const info = await discovery(config, fetcher, 'openid-configuration');
  const tokens = await objectResponse(await trustedRequest(endpoint(info.token_endpoint, config), config, fetcher, { method: 'POST', headers: tokenHeaders(config),
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId, redirect_uri: config.origin + '/auth/callback', code: params.get('code')!, code_verifier: flow.verifier }) }));
  if (!validTokens(tokens)) throw new ApiError(503, 'invalid_token_response');
  // Identity comes from the authenticated API, never an unverified ID-token claim.
  const id = await customerId(tokens.access_token, config, fetcher);
  const response = new Response(null, { status: 302, headers: { Location: safeReturn(flow.returnTo, config) } });
  response.headers.append('Set-Cookie', flowCookie('', 0));
  for (const value of await loginCookies(tokens, id, config, now)) response.headers.append('Set-Cookie', value);
  return response;
}
export async function authenticateOxygen(request: Request, config: OxygenAuthConfig, fetcher: typeof fetch, now = Date.now(), onCookies?: (cookies: string[]) => void): Promise<CustomerIdentity> {
  const session = await openCookie(config, 'session', cookie(request, SESSION_COOKIE));
  const validUntil = session?.validUntil ?? session?.expires;
  if (!session || typeof session.accessToken !== 'string' || typeof session.expires !== 'number'
    || typeof session.customerId !== 'string' || typeof validUntil !== 'number' || validUntil <= now
    || validUntil > now + SESSION_SECONDS * 1000 || session.expires > validUntil) throw new ApiError(401, 'login_required');
  const rawRefresh = cookie(request, REFRESH_COOKIE);
  const refresh = typeof session.refreshId === 'string' ? await openCookie(config, 'refresh', rawRefresh) : null;
  const canRefresh = refresh && typeof refresh.refreshToken === 'string' && refresh.refreshToken.length > 0
    && refresh.refreshToken.length <= 2300 && refresh.customerId === session.customerId && refresh.refreshId === session.refreshId
    && typeof refresh.expires === 'number' && refresh.expires === validUntil;
  const renew = async () => {
    if (!canRefresh) throw new ApiError(401, 'login_required');
    const rotated = await rotateSession(rawRefresh!, refresh.refreshToken as string, session.customerId as string, config, fetcher, now, session.expires as number);
    onCookies?.(rotated.cookies);
    return { shop: config.shop, customerId: rotated.id };
  };
  if (session.expires <= now || canRefresh && session.expires <= now + 30000) return renew();
  let id: string;
  try { id = await customerId(session.accessToken, config, fetcher); }
  catch (error) { if (canRefresh && error instanceof ApiError && error.status === 401) return renew(); throw error; }
  if (id !== session.customerId) throw new ApiError(401, 'login_required');
  return { shop: config.shop, customerId: id };
}
