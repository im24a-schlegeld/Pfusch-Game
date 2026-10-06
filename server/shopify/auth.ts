import { hmacSha256, randomHex, verifyHmacHex } from './crypto.js';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export interface ShopifyConfig { shop: string; secret: string; adminToken?: string; clientId?: string }
export interface CustomerIdentity { shop: string; customerId: string }
/** Supplied only by a server adapter after it verifies a session or proxy. */
export type CustomerAuthenticator = (url: string, config: ShopifyConfig, now: number) => Promise<CustomerIdentity>;
export function assertCustomerIdentity(identity: CustomerIdentity, config: ShopifyConfig): CustomerIdentity {
  if (!identity || identity.shop !== config.shop || typeof identity.customerId !== 'string' || !/^[1-9]\d{0,19}$/.test(identity.customerId))
    throw new ApiError(401, 'unauthorized');
  return identity;
}
type ShopifyEnvironment = Partial<Record<
  'SHOPIFY_SHOP_DOMAIN' | 'SHOPIFY_CLIENT_ID' | 'SHOPIFY_CLIENT_SECRET' | 'SHOPIFY_API_SECRET' | 'SHOPIFY_ADMIN_ACCESS_TOKEN', string>>;
export function readShopifyConfig(env: ShopifyEnvironment): ShopifyConfig | null {
  const shop = env.SHOPIFY_SHOP_DOMAIN?.trim().toLowerCase();
  if (!shop || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return null;
  const clientId = env.SHOPIFY_CLIENT_ID?.trim(), clientSecret = env.SHOPIFY_CLIENT_SECRET?.trim();
  // New Dev Dashboard apps use the same client secret for OAuth and proxy HMAC.
  // An incomplete new configuration must not silently use a different legacy app.
  if (clientId || clientSecret) return clientId && clientSecret ? { shop, secret: clientSecret, clientId } : null;
  const secret = env.SHOPIFY_API_SECRET?.trim(), adminToken = env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim();
  return secret && adminToken ? { shop, secret, adminToken } : null;
}

/** Shopify App Proxy canonicalization differs from OAuth: duplicates join with
 * commas, sorted key=value pairs concatenate without ampersands. */
export async function authenticateProxy(url: string, config: ShopifyConfig, now: number): Promise<CustomerIdentity> {
  if (url.length > 8192) throw new ApiError(401, 'unauthorized');
  const parameters = new URL(url, 'https://backend.invalid').searchParams;
  if ([...parameters].length > 64) throw new ApiError(401, 'unauthorized');
  for (const key of ['signature', 'shop', 'logged_in_customer_id', 'timestamp', 'path_prefix'])
    if (parameters.getAll(key).length !== 1) throw new ApiError(401, 'unauthorized');
  const signature = parameters.get('signature')!;
  const canonical = [...new Set(parameters.keys())].filter(key => key !== 'signature')
    .map(key => `${key}=${parameters.getAll(key).join(',')}`).sort().join('');
  if (!await verifyHmacHex(signature, canonical, config.secret)) throw new ApiError(401, 'unauthorized');
  const shop = parameters.get('shop')!, customerId = parameters.get('logged_in_customer_id')!;
  const timestamp = parameters.get('timestamp')!;
  if (shop !== config.shop || !/^[1-9]\d{0,19}$/.test(customerId) || !/^\d{10}$/.test(timestamp))
    throw new ApiError(401, 'unauthorized');
  const age = Math.floor(now / 1000) - Number(timestamp);
  if (age > 300 || age < -60) throw new ApiError(401, 'unauthorized');
  return { shop, customerId };
}

/** The proxy authenticates the query, not the POST body. A short-lived token
 * obtained by the same customer's GET is required before accepting a save. */
export async function createCsrf(identity: CustomerIdentity, secret: string, now: number) {
  const payload = `${Math.floor(now / 1000) + 900}.${randomHex(18)}`;
  return `${payload}.${await hmacSha256(`pfusch-save-v1\n${identity.shop}\n${identity.customerId}\n${payload}`, secret)}`;
}
export async function verifyCsrf(token: unknown, identity: CustomerIdentity, secret: string, now: number) {
  if (typeof token !== 'string' || !/^\d{10}\.[a-f0-9]{36}\.[a-f0-9]{64}$/.test(token))
    throw new ApiError(403, 'csrf');
  const [expiry, nonce, signature] = token.split('.');
  const remaining = Number(expiry) - Math.floor(now / 1000);
  if (remaining <= 0 || remaining > 900 || !await verifyHmacHex(signature,
    `pfusch-save-v1\n${identity.shop}\n${identity.customerId}\n${expiry}.${nonce}`, secret))
    throw new ApiError(403, 'csrf');
}
