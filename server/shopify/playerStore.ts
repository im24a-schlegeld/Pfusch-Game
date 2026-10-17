import type { Player } from '../../app/domain/types.js';
import { ApiError, type ShopifyConfig } from './auth.js';
import { isRecord, MAX_BODY_BYTES, sanitizeDigitalPlayer } from './playerValidation.js';
import { readMarketingState, type MarketingState } from './storagePolicy.js';
import { shopifyAdminToken } from './adminToken.js';
import { byteLength } from './crypto.js';
import { GIFT_KEY, pendingGifts, readGiftLedger, type GiftNotification } from './giftLedger.js';

// Pinned stable version, reviewed against the official reference on 2026-10-05.
export const SHOPIFY_API_VERSION = '2026-10';
export const PLAYER_NAMESPACE = '$app:pfusch_game';
export const PLAYER_KEY = 'player_v1';
export type ShopifyFetch = typeof fetch;
export interface SavedPlayer { player: Player | null; compareDigest: string | null }
export interface CustomerPlayer extends SavedPlayer { marketingState: MarketingState; gifts: GiftNotification[] }
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const ownerId = (customerId: string) => `gid://shopify/Customer/${customerId}`;

export async function shopifyGraphql(config: ShopifyConfig, query: string, variables: Record<string, unknown>, request: ShopifyFetch) {
  try {
    const adminToken = await shopifyAdminToken(config, request);
    const response = await request(`https://${config.shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      // workerd supports manual redirects; !ok below rejects them without
      // forwarding the Admin token or customer data to another destination.
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': adminToken },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) throw new ApiError(503, `shopify_admin_http_${response.status}`);
    const raw = await response.text();
    if (byteLength(raw) > MAX_BODY_BYTES * 4) throw new ApiError(502, 'invalid_shopify_response');
    let result: unknown;
    try { result = JSON.parse(raw); } catch { throw new ApiError(502, 'invalid_shopify_response'); }
    if (!isRecord(result)) throw new ApiError(502, 'invalid_shopify_response');
    if (Array.isArray(result.errors) && result.errors.length) {
      // GraphQL messages can include customer data; expose fixed classifications only.
      const codes = result.errors.map(error => isRecord(error) && isRecord(error.extensions) ? error.extensions.code : null);
      throw new ApiError(503, codes.includes('ACCESS_DENIED') ? 'shopify_admin_access_denied'
        : codes.includes('THROTTLED') ? 'shopify_admin_throttled' : 'shopify_admin_query_failed');
    }
    if (!isRecord(result.data)) throw new ApiError(502, 'invalid_shopify_response');
    return result.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Never expose upstream error payloads, API tokens, or customer details.
    throw new ApiError(503, error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)
      ? 'shopify_admin_timeout' : 'shopify_admin_request_failed');
  }
}

export async function loadCustomerPlayer(config: ShopifyConfig, customerId: string, request: ShopifyFetch, verifiedItems: string[] = []): Promise<CustomerPlayer> {
  const data = await shopifyGraphql(config, `query GamePlayer($id: ID!, $namespace: String!, $key: String!, $gifts: String!) {
    customer(id: $id) {
      id emailMarketingConsent { marketingState }
      metafield(namespace: $namespace, key: $key) { value compareDigest }
      gifts: metafield(namespace: $namespace, key: $gifts) { value compareDigest }
    }
  }`, { id: ownerId(customerId), namespace: PLAYER_NAMESPACE, key: PLAYER_KEY, gifts: GIFT_KEY }, request);
  if (data.customer === null) throw new ApiError(401, 'unauthorized');
  if (!isRecord(data.customer) || data.customer.id !== ownerId(customerId)) throw new ApiError(502, 'invalid_shopify_response');
  const marketingState = readMarketingState(data.customer.emailMarketingConsent);
  const gifts = pendingGifts(readGiftLedger(data.customer.gifts).ledger);
  const field = data.customer.metafield;
  if (field === null) return { player: null, compareDigest: null, marketingState, gifts };
  if (!isRecord(field) || typeof field.value !== 'string' || !digest(field.compareDigest) || byteLength(field.value) > MAX_BODY_BYTES)
    throw new ApiError(502, 'invalid_saved_player');
  try {
    return { player: sanitizeDigitalPlayer(JSON.parse(field.value), customerId, verifiedItems), compareDigest: field.compareDigest, marketingState, gifts };
  } catch { throw new ApiError(502, 'invalid_saved_player'); }
}

export async function saveCustomerPlayer(config: ShopifyConfig, customerId: string, player: Player,
  compareDigest: string | null, request: ShopifyFetch): Promise<{ player: Player; compareDigest: string }> {
  const data = await shopifyGraphql(config, `mutation SaveGamePlayer($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { metafields { compareDigest } userErrors { code } }
  }`, { metafields: [{ ownerId: ownerId(customerId), namespace: PLAYER_NAMESPACE, key: PLAYER_KEY,
    type: 'json', value: JSON.stringify({ ...player, irlItems: [] }), compareDigest }] }, request);
  const result = data.metafieldsSet;
  if (!isRecord(result) || !Array.isArray(result.userErrors)) throw new ApiError(502, 'invalid_shopify_response');
  if (result.userErrors.some(value => isRecord(value) && ['STALE_OBJECT', 'INVALID_COMPARE_DIGEST'].includes(String(value.code))))
    throw new ApiError(409, 'conflict');
  if (result.userErrors.length) throw new ApiError(503, 'shopify_admin_save_rejected');
  const fields = result.metafields;
  if (!Array.isArray(fields) || fields.length !== 1 || !isRecord(fields[0]) || !digest(fields[0].compareDigest))
    throw new ApiError(502, 'invalid_shopify_response');
  return { player, compareDigest: fields[0].compareDigest };
}
