import { ApiError, type CustomerIdentity } from '../shopify/auth.js';

export const SHOP_ORIGINS = ['https://pfusch-clothing.ch', 'https://www.pfusch-clothing.ch'];
export const SESSION_COOKIE = '__Host-wheelie_session';
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
  const response = await fetcher(url, { ...init, redirect: 'follow' });
  if (response.url) {
    let final: URL;
    try { final = new URL(response.url); } catch { throw new ApiError(503, 'invalid_discovery'); }
    if (final.protocol !== 'https:' || !trustedHost(final.hostname, config)) throw new ApiError(503, 'invalid_discovery');
  }
  return response;
}
async function objectResponse(response: Response) {
  if (!response.ok) throw new ApiError(response.status === 401 ? 401 : 503, response.status === 401 ? 'login_required' : 'customer_account_unavailable');
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
export async function finishLogin(request: Request, config: OxygenAuthConfig, fetcher: typeof fetch, now = Date.now()) {
  const params = new URL(request.url).searchParams, flow = await openCookie(config, 'flow', cookie(request, FLOW_COOKIE));
  if (!flow || typeof flow.expires !== 'number' || flow.expires < now || flow.expires > now + 600000
    || typeof flow.state !== 'string' || typeof flow.verifier !== 'string' || typeof flow.returnTo !== 'string'
    || params.getAll('state').length !== 1 || params.getAll('code').length !== 1 || params.has('error')
    || params.get('state') !== flow.state || !params.get('code') || params.get('code')!.length > 4096) throw new ApiError(400, 'invalid_oauth_state');
  const info = await discovery(config, fetcher, 'openid-configuration');
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Origin: config.origin, 'User-Agent': 'WheelieEscape/1.0' };
  if (config.clientSecret) headers.Authorization = `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`;
  const tokens = await objectResponse(await trustedRequest(endpoint(info.token_endpoint, config), config, fetcher, { method: 'POST', headers,
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId, redirect_uri: config.origin + '/auth/callback', code: params.get('code')!, code_verifier: flow.verifier }) }));
  if (typeof tokens.access_token !== 'string' || tokens.access_token.length > 2300 || !tokens.access_token
    || typeof tokens.expires_in !== 'number' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw new ApiError(503, 'invalid_token_response');
  // Identity comes from the authenticated API, never an unverified ID-token claim.
  const id = await customerId(tokens.access_token, config, fetcher);
  const seconds = Math.min(3600, Math.floor(tokens.expires_in));
  const sealed = await sealCookie(config, 'session', { accessToken: tokens.access_token, customerId: id, expires: now + seconds * 1000 });
  const response = new Response(null, { status: 302, headers: { Location: safeReturn(flow.returnTo, config) } });
  response.headers.append('Set-Cookie', flowCookie('', 0));
  response.headers.append('Set-Cookie', sessionCookie(sealed, seconds));
  return response;
}
export async function authenticateOxygen(request: Request, config: OxygenAuthConfig, fetcher: typeof fetch, now = Date.now()): Promise<CustomerIdentity> {
  const session = await openCookie(config, 'session', cookie(request, SESSION_COOKIE));
  if (!session || typeof session.accessToken !== 'string' || typeof session.expires !== 'number' || session.expires <= now
    || session.expires > now + 3600000) throw new ApiError(401, 'login_required');
  const id = await customerId(session.accessToken, config, fetcher);
  if (id !== session.customerId) throw new ApiError(401, 'login_required');
  return { shop: config.shop, customerId: id };
}
