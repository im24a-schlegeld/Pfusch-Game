import catalog from '../../public/catalog/products.json';
import type { Product } from '../../app/domain/types.js';
import { productColorKey } from '../../app/domain/productOwnership.js';
import { ApiError, type ShopifyConfig } from './auth.js';
import { shopifyGraphql, type ShopifyFetch } from './playerStore.js';
import { isRecord } from './playerValidation.js';

export interface VerifiedPurchases { items: string[]; available: boolean; reason?: 'orders_scope_missing' | 'orders_unavailable'; history: 'all' | 'recent' }
type Connection = { nodes: unknown[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
const products = catalog as Product[];
const numericId = (value: unknown, type: string) => typeof value === 'string' && new RegExp(`^gid://shopify/${type}/[1-9]\\d*$`).test(value) ? value.split('/').at(-1)! : '';
function connection(value: unknown): Connection {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !isRecord(value.pageInfo) || typeof value.pageInfo.hasNextPage !== 'boolean' ||
      (value.pageInfo.endCursor !== null && typeof value.pageInfo.endCursor !== 'string') ||
      (value.pageInfo.hasNextPage && !value.pageInfo.endCursor)) throw new ApiError(502, 'invalid_purchase_response');
  return value as unknown as Connection;
}
const lineFields = 'nodes { currentQuantity product { id } variant { id } } pageInfo { hasNextPage endCursor }';

/** Trusted customer identity only. No names, addresses or order prices leave this adapter. */
export async function readCustomerPurchases(config: ShopifyConfig, customerId: string, request: ShopifyFetch): Promise<VerifiedPurchases> {
  try {
    if (!/^[1-9]\d{0,19}$/.test(customerId)) throw new ApiError(401, 'unauthorized');
    const owner = `gid://shopify/Customer/${customerId}`;
    const permissions = await shopifyGraphql(config, 'query GamePurchaseScopes { currentAppInstallation { accessScopes { handle } } }', {}, request);
    if (!isRecord(permissions.currentAppInstallation) || !Array.isArray(permissions.currentAppInstallation.accessScopes)) throw new ApiError(502, 'invalid_purchase_response');
    const scopes = permissions.currentAppInstallation.accessScopes.filter(isRecord).map(scope => scope.handle);
    const history = scopes.includes('read_all_orders') ? 'all' : 'recent';
    if (!scopes.includes('read_orders') && !scopes.includes('write_orders')) return { items: [], available: false, reason: 'orders_scope_missing', history };
    const items = new Set<string>();
    const consume = (lines: Connection) => {
      for (const value of lines.nodes) {
        if (!isRecord(value) || typeof value.currentQuantity !== 'number') throw new ApiError(502, 'invalid_purchase_response');
        if (value.currentQuantity <= 0 || !isRecord(value.product) || !isRecord(value.variant)) continue;
        const productId = numericId(value.product.id, 'Product');
        const product = products.find(product => product.id === productId);
        const variant = numericId(value.variant.id, 'ProductVariant');
        const key = product && productColorKey(product, variant);
        if (product && key) { items.add(product.id); items.add(key); }
      }
    };
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const data = await shopifyGraphql(config, `query GamePurchases($id: ID!, $after: String) {
        customer(id: $id) { id orders(first: 50, after: $after) { nodes {
          id cancelledAt test displayFinancialStatus lineItems(first: 100) { ${lineFields} }
        } pageInfo { hasNextPage endCursor } } }
      }`, { id: owner, after: cursor }, request);
      if (!isRecord(data.customer) || data.customer.id !== owner) throw new ApiError(502, 'invalid_purchase_response');
      const orders = connection(data.customer.orders);
      for (const value of orders.nodes) {
        if (!isRecord(value) || !numericId(value.id, 'Order')) throw new ApiError(502, 'invalid_purchase_response');
        if (value.cancelledAt !== null || value.test !== false || !['PAID', 'PARTIALLY_REFUNDED'].includes(String(value.displayFinancialStatus))) continue;
        let lines = connection(value.lineItems);
        consume(lines);
        let linePages = 0;
        while (lines.pageInfo.hasNextPage) {
          if (++linePages > 20) throw new ApiError(503, 'purchase_scan_limit');
          const extra = await shopifyGraphql(config, `query GamePurchaseLines($id: ID!, $after: String!) {
            order(id: $id) { id customer { id } lineItems(first: 100, after: $after) { ${lineFields} } }
          }`, { id: value.id, after: lines.pageInfo.endCursor }, request);
          if (!isRecord(extra.order) || extra.order.id !== value.id || !isRecord(extra.order.customer) || extra.order.customer.id !== owner) throw new ApiError(502, 'invalid_purchase_response');
          lines = connection(extra.order.lineItems); consume(lines);
        }
      }
      if (!orders.pageInfo.hasNextPage) return { items: [...items], available: true, history };
      if (orders.pageInfo.endCursor === cursor) throw new ApiError(502, 'invalid_purchase_response');
      cursor = orders.pageInfo.endCursor;
    }
    throw new ApiError(503, 'purchase_scan_limit');
  } catch (error) {
    return { items: [], available: false, reason: error instanceof ApiError && error.code === 'shopify_admin_access_denied'
      ? 'orders_scope_missing' : 'orders_unavailable', history: 'recent' };
  }
}

/** A short bounded server cache avoids order scans for every garage save. */
const cache = new Map<string, { expires: number; value: Promise<VerifiedPurchases> }>();
export async function loadCustomerPurchases(config: ShopifyConfig, customerId: string, request: ShopifyFetch): Promise<VerifiedPurchases> {
  const key = `${config.shop}:${config.clientId ?? 'legacy'}:${customerId}`, current = cache.get(key), now = Date.now();
  if (current && current.expires > now) return current.value;
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  const value = readCustomerPurchases(config, customerId, request);
  cache.set(key, { expires: now + 60_000, value });
  return value;
}
