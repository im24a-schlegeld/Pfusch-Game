import { ApiError, type ShopifyConfig } from './auth.js';
import { byteLength, sha256 } from './crypto.js';

interface CachedToken { key: string; token?: string; expiresAt: number; pending?: Promise<string> }
const REFRESH_EARLY_MS = 60_000;
// Return only known diagnostic codes, never Shopify's free-form error text.
const TOKEN_ERRORS = new Set(['shop_not_permitted', 'app_not_installed', 'application_cannot_be_found',
  'invalid_client', 'invalid_grant', 'unsupported_grant_type', 'invalid_request', 'access_denied']);

/** A single configured shop per deployment: retain at most one credential set.
 * Warm instances share an in-flight exchange; cold starts safely request again.
 * Tokens and credentials never leave the server or enter persistent storage. */
export function createShopifyAdminTokenProvider(now: () => number = Date.now) {
  let cached: CachedToken | undefined;
  return async function adminToken(config: ShopifyConfig, request: typeof fetch): Promise<string> {
    if (!config.clientId) {
      if (config.adminToken) return config.adminToken;
      throw new ApiError(503, 'not_configured');
    }
    const key = await sha256(JSON.stringify([config.shop, config.clientId, config.secret]));
    if (cached?.key !== key) cached = { key, expiresAt: 0 };
    const entry = cached;
    if (entry.token && now() < entry.expiresAt - REFRESH_EARLY_MS) return entry.token;
    if (entry.pending) return entry.pending;
    // An expired token must never be reused when an exchange fails.
    entry.token = undefined;
    const startedAt = now();
    const exchange = async () => {
      try {
        const response = await request(`https://${config.shop}/admin/oauth/access_token`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'client_credentials', client_id: config.clientId!, client_secret: config.secret }).toString(),
        });
        const raw = await response.text();
        if (byteLength(raw) > 16_384) throw new ApiError(503, 'shopify_token_invalid_response');
        let result: unknown;
        try { result = JSON.parse(raw); } catch { /* HTML errors are classified only by HTTP status below. */ }
        if (!response.ok) {
          const code = result && typeof result === 'object' && 'error' in result ? result.error : undefined;
          throw new ApiError(503, typeof code === 'string' && TOKEN_ERRORS.has(code)
            ? `shopify_token_${code}` : `shopify_token_http_${response.status}`);
        }
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw new ApiError(503, 'shopify_token_invalid_response');
        const { access_token: token, expires_in: lifetime, scope } = result as Record<string, unknown>;
        if (typeof token !== 'string' || !/^[A-Za-z0-9._~-]{1,2048}$/.test(token)
          || typeof lifetime !== 'number' || !Number.isInteger(lifetime) || lifetime <= 60 || lifetime > 86_400
          || typeof scope !== 'string' || scope.length > 4096)
          throw new ApiError(503, 'shopify_token_invalid_response');
        if (!scope.split(',').map(value => value.trim()).includes('write_customers'))
          throw new ApiError(503, 'shopify_token_scope_missing');
        const expiresAt = startedAt + lifetime * 1000;
        if (now() >= expiresAt - REFRESH_EARLY_MS) throw new ApiError(503, 'shopify_token_expired_response');
        entry.token = token;
        entry.expiresAt = expiresAt;
        return token;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        // Never forward Shopify's error body, client secret or access token.
        throw new ApiError(503, error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)
          ? 'shopify_token_timeout' : 'shopify_token_request_failed');
      }
    };
    entry.pending = exchange();
    try { return await entry.pending; }
    finally { entry.pending = undefined; }
  };
}

export const shopifyAdminToken = createShopifyAdminTokenProvider();
