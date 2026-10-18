import type { Product } from '../../app/domain/types.js';
import { digitalPrice } from '../../app/domain/progression.js';
import { ApiError, type ShopifyConfig } from './auth.js';
import { shopifyGraphql, PLAYER_NAMESPACE, type ShopifyFetch } from './playerStore.js';
import { isRecord } from './playerValidation.js';
import catalog from '../../public/catalog/products.json' with { type: 'json' };

export const GAME_PRICE_KEY = 'game_prices_v1';
export const GAME_PRICE_LIMIT = 10000;
const products = catalog as Product[];
const eligible = new Map(products.map(product => [product.id, product]));
const PUBLIC_CACHE_MS = 30_000;
const MAX_CACHED_SHOPS = 8;
const publicPrices = new Map<string, { expiresAt: number; pending: Promise<Record<string, number>> }>();
const validDigest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const validPrice = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= GAME_PRICE_LIMIT;

/** Override records contain only known catalog IDs and integer coin prices. */
export function parseGamePrices(raw: unknown): Record<string, number> {
  if (!isRecord(raw) || !Object.hasOwn(raw, 'version') || raw.version !== 1
    || !Object.hasOwn(raw, 'prices') || !isRecord(raw.prices) || Object.keys(raw.prices).length > products.length
    || Object.keys(raw).some(key => key !== 'version' && key !== 'prices'))
    throw new ApiError(502, 'invalid_game_prices');
  const prices: Record<string, number> = {};
  for (const [id, price] of Object.entries(raw.prices)) {
    if (!eligible.has(id) || !validPrice(price)) throw new ApiError(502, 'invalid_game_prices');
    prices[id] = price;
  }
  return prices;
}

export function gamePriceCatalog() {
  return products.map(product => ({ id: product.id, title: product.title, category: product.category,
    shopPrice: product.price, currency: product.currency,
    defaultPrice: digitalPrice(product), editable: eligible.has(product.id) }));
}

export async function loadGamePrices(config: ShopifyConfig, request: ShopifyFetch) {
  const data = await shopifyGraphql(config, `query PfuschGamePrices($ns:String!,$key:String!){
    shop { id field:metafield(namespace:$ns,key:$key) { value compareDigest } }
  }`, { ns: PLAYER_NAMESPACE, key: GAME_PRICE_KEY }, request);
  if (!isRecord(data.shop) || typeof data.shop.id !== 'string' || !/^gid:\/\/shopify\/Shop\/\d+$/.test(data.shop.id))
    throw new ApiError(502, 'invalid_game_prices');
  if (data.shop.field === null) return { shopId: data.shop.id, prices: {} as Record<string, number>, digest: null as string | null };
  const field = data.shop.field;
  if (!isRecord(field) || typeof field.value !== 'string' || field.value.length > 30000 || !validDigest(field.compareDigest))
    throw new ApiError(502, 'invalid_game_prices');
  let decoded: unknown;
  try { decoded = JSON.parse(field.value); } catch { throw new ApiError(502, 'invalid_game_prices'); }
  return { shopId: data.shop.id, prices: parseGamePrices(decoded), digest: field.compareDigest as string | null };
}

/** Warm workers coalesce public reads, including failures, for a bounded interval. */
export function readPublicGamePrices(config: ShopifyConfig, request: ShopifyFetch, now = Date.now()): Promise<Record<string, number>> {
  const cached = publicPrices.get(config.shop);
  if (cached && cached.expiresAt > now) return cached.pending;
  if (publicPrices.size >= MAX_CACHED_SHOPS && !publicPrices.has(config.shop))
    publicPrices.delete(publicPrices.keys().next().value!);
  const pending = loadGamePrices(config, request).then(saved => saved.prices);
  publicPrices.set(config.shop, { expiresAt: now + PUBLIC_CACHE_MS, pending });
  return pending;
}

/** Price writes use Shopify compareDigest CAS; no customer data or CHF prices change. */
export async function saveGamePrice(config: ShopifyConfig, request: ShopifyFetch,
  id: unknown, value: unknown, expected: unknown) {
  if (typeof id !== 'string' || !eligible.has(id) || (value !== null && !validPrice(value)) ||
    (expected !== null && !validDigest(expected))) throw new ApiError(400, 'invalid_game_price');
  const saved = await loadGamePrices(config, request);
  if (expected !== saved.digest) throw new ApiError(409, 'game_price_conflict_reload');
  const prices = { ...saved.prices };
  if (value === null) delete prices[id]; else prices[id] = value as number;
  if (JSON.stringify(prices) === JSON.stringify(saved.prices)) {
    publicPrices.delete(config.shop);
    return { changed: id, prices, digest: saved.digest };
  }
  const data = await shopifyGraphql(config, `mutation PfuschGamePriceSave($fields:[MetafieldsSetInput!]!){
    metafieldsSet(metafields:$fields) { userErrors { code } metafields { key compareDigest } }
  }`, { fields: [{ ownerId: saved.shopId, namespace: PLAYER_NAMESPACE, key: GAME_PRICE_KEY,
    type: 'json', value: JSON.stringify({ version: 1, prices }), compareDigest: saved.digest }] }, request);
  const response = data.metafieldsSet;
  if (!isRecord(response) || !Array.isArray(response.userErrors)) throw new ApiError(502, 'invalid_game_price_response');
  if (response.userErrors.some(error => isRecord(error) &&
    ['STALE_OBJECT', 'INVALID_COMPARE_DIGEST'].includes(String(error.code)))) throw new ApiError(409, 'game_price_conflict_reload');
  if (response.userErrors.length) throw new ApiError(503, 'game_price_save_rejected');
  publicPrices.delete(config.shop);
  if (!Array.isArray(response.metafields) || !isRecord(response.metafields[0]) || !validDigest(response.metafields[0].compareDigest))
    throw new ApiError(502, 'invalid_game_price_response');
  return { changed: id, prices, digest: response.metafields[0].compareDigest as string };
}
