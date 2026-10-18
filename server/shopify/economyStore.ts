import { DEFAULT_GAME_ECONOMY, validFlagCoinPrice, type GameEconomy } from '../../app/domain/economy.js';
import { ApiError, type ShopifyConfig } from './auth.js';
import { isRecord } from './playerValidation.js';
import { PLAYER_NAMESPACE, shopifyGraphql, type ShopifyFetch } from './playerStore.js';

const KEY = 'economy_v1';
const CACHE_MS = 30_000;
const MAX_CACHED_SHOPS = 8;
const validDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
interface AuditEntry { at: number; actor: string; before: number; after: number }
interface StoredEconomy extends GameEconomy { audit: AuditEntry[] }
interface PublicCacheEntry { expiresAt: number; pending: Promise<GameEconomy> }
const publicCache = new Map<string, PublicCacheEntry>();

function decodeStoredEconomy(raw: unknown): StoredEconomy {
  if (typeof raw !== 'string' || raw.length > 16_384) throw new ApiError(502, 'invalid_game_economy');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new ApiError(502, 'invalid_game_economy'); }
  if (!isRecord(value) || value.version !== 1 || !validFlagCoinPrice(value.flagCoinPrice)
    || Object.keys(value).some(key => !['version', 'flagCoinPrice', 'audit'].includes(key))
    || !Array.isArray(value.audit) || value.audit.length > 25)
    throw new ApiError(502, 'invalid_game_economy');
  const audit = value.audit.map(entry => {
    if (!isRecord(entry) || !Number.isSafeInteger(entry.at) || Number(entry.at) < 0
      || typeof entry.actor !== 'string' || !/^[1-9]\d{0,19}$/.test(entry.actor)
      || !validFlagCoinPrice(entry.before) || !validFlagCoinPrice(entry.after))
      throw new ApiError(502, 'invalid_game_economy');
    return { at: entry.at as number, actor: entry.actor, before: entry.before, after: entry.after };
  });
  return { version: 1, flagCoinPrice: value.flagCoinPrice, audit };
}

export async function loadEconomy(config: ShopifyConfig, request: ShopifyFetch) {
  const data = await shopifyGraphql(config, `query GameEconomy($namespace:String!,$key:String!){
    shop { id economy:metafield(namespace:$namespace,key:$key){value compareDigest} }
  }`, { namespace: PLAYER_NAMESPACE, key: KEY }, request);
  if (!isRecord(data.shop) || typeof data.shop.id !== 'string' || !/^gid:\/\/shopify\/Shop\/\d+$/.test(data.shop.id))
    throw new ApiError(502, 'invalid_game_economy');
  if (data.shop.economy === null) return { ownerId: data.shop.id,
    economy: { ...DEFAULT_GAME_ECONOMY, audit: [] } as StoredEconomy, compareDigest: null };
  const field = data.shop.economy;
  if (!isRecord(field) || !validDigest(field.compareDigest)) throw new ApiError(502, 'invalid_game_economy');
  return { ownerId: data.shop.id, economy: decodeStoredEconomy(field.value), compareDigest: field.compareDigest };
}

/** One bounded, coalesced read per shop and warm worker every 30 seconds. */
export function readPublicEconomy(config: ShopifyConfig, request: ShopifyFetch, now = Date.now()): Promise<GameEconomy> {
  const cached = publicCache.get(config.shop);
  if (cached && cached.expiresAt > now) return cached.pending;
  if (publicCache.size >= MAX_CACHED_SHOPS && !publicCache.has(config.shop))
    publicCache.delete(publicCache.keys().next().value!);
  const entry: PublicCacheEntry = { expiresAt: now + CACHE_MS, pending: Promise.resolve({ ...DEFAULT_GAME_ECONOMY }) };
  // Cache failures for the same short interval too, so a Shopify outage cannot
  // turn every game startup into another Admin API call.
  entry.pending = loadEconomy(config, request).then(({ economy }) => ({ version: 1 as const, flagCoinPrice: economy.flagCoinPrice }));
  publicCache.set(config.shop, entry);
  return entry.pending;
}

/** Only the authenticated staff handler supplies actor. Real product/order APIs are never used. */
export async function saveEconomy(config: ShopifyConfig, request: ShopifyFetch, flagCoinPrice: number,
  compareDigest: string | null, actor: string, now = Date.now()) {
  if (!validFlagCoinPrice(flagCoinPrice) || !/^[1-9]\d{0,19}$/.test(actor)
    || (compareDigest !== null && !validDigest(compareDigest))) throw new ApiError(400, 'invalid_game_economy');
  const saved = await loadEconomy(config, request);
  if (saved.compareDigest !== compareDigest) throw new ApiError(409, 'edit_conflict_reload');
  const economy: StoredEconomy = { version: 1, flagCoinPrice, audit: [...saved.economy.audit.slice(-24),
    { at: now, actor, before: saved.economy.flagCoinPrice, after: flagCoinPrice }] };
  const result = await shopifyGraphql(config, `mutation SaveGameEconomy($metafields:[MetafieldsSetInput!]!){
    metafieldsSet(metafields:$metafields){userErrors{code} metafields{compareDigest}}
  }`, { metafields: [{ ownerId: saved.ownerId, namespace: PLAYER_NAMESPACE, key: KEY, type: 'json',
    value: JSON.stringify(economy), compareDigest }] }, request);
  const mutation = result.metafieldsSet;
  if (!isRecord(mutation) || !Array.isArray(mutation.userErrors)) throw new ApiError(502, 'invalid_game_economy');
  if (mutation.userErrors.some(error => isRecord(error) && ['STALE_OBJECT', 'INVALID_COMPARE_DIGEST'].includes(String(error.code))))
    throw new ApiError(409, 'edit_conflict_reload');
  if (mutation.userErrors.length) throw new ApiError(503, 'economy_save_rejected');
  publicCache.delete(config.shop);
  if (!Array.isArray(mutation.metafields) || mutation.metafields.length !== 1 || !isRecord(mutation.metafields[0])
    || !validDigest(mutation.metafields[0].compareDigest)) throw new ApiError(502, 'invalid_game_economy');
  return { version: 1 as const, flagCoinPrice, compareDigest: mutation.metafields[0].compareDigest };
}
