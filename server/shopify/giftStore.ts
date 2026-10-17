import { newPlayer } from '../../app/domain/progression.js';
import { MAX_GUARDIAN_BELLS } from '../../app/domain/guardianBells.js';
import { ApiError, type ShopifyConfig } from './auth.js';
import { byteLength } from './crypto.js';
import { isRecord, MAX_BODY_BYTES, retainGuardianBells, sanitizeDigitalPlayer } from './playerValidation.js';
import { PLAYER_KEY, PLAYER_NAMESPACE, shopifyGraphql, type ShopifyFetch } from './playerStore.js';
import { GIFT_KEY, MAX_GIFT_HISTORY, MAX_PENDING_GIFTS, parseGiftInput, pendingGifts, publicGift,
  readGiftLedger, validGiftDigest, validGiftId, type GiftEntry } from './giftLedger.js';

export { GIFT_KEY } from './giftLedger.js';
const owner = (id: string) => `gid://shopify/Customer/${id}`;
const fieldInput = (id: string, key: string, value: object, compareDigest: string | null) => ({
  ownerId: owner(id), namespace: PLAYER_NAMESPACE, key, type: 'json', value: JSON.stringify(value), compareDigest,
});
async function load(config: ShopifyConfig, id: string, request: ShopifyFetch) {
  const data = await shopifyGraphql(config, `query PfuschGiftPlayer($id:ID!,$namespace:String!,$player:String!,$gifts:String!){
    customer(id:$id){id player:metafield(namespace:$namespace,key:$player){value compareDigest}
      gifts:metafield(namespace:$namespace,key:$gifts){value compareDigest}}
  }`, { id: owner(id), namespace: PLAYER_NAMESPACE, player: PLAYER_KEY, gifts: GIFT_KEY }, request);
  if (!isRecord(data.customer) || data.customer.id !== owner(id)) throw new ApiError(404, 'customer_not_found');
  return { player: data.customer.player, gifts: readGiftLedger(data.customer.gifts) };
}
async function save(config: ShopifyConfig, metafields: ReturnType<typeof fieldInput>[], request: ShopifyFetch) {
  const data = await shopifyGraphql(config, `mutation SavePfuschGift($metafields:[MetafieldsSetInput!]!){
    metafieldsSet(metafields:$metafields){metafields{compareDigest} userErrors{code}}
  }`, { metafields }, request);
  const saved = data.metafieldsSet;
  if (!isRecord(saved) || !Array.isArray(saved.userErrors)) throw new ApiError(502, 'invalid_shopify_response');
  if (saved.userErrors.some(error => isRecord(error) && ['STALE_OBJECT', 'INVALID_COMPARE_DIGEST'].includes(String(error.code))))
    throw new ApiError(409, 'conflict');
  if (saved.userErrors.length) throw new ApiError(503, 'gift_save_rejected');
  if (!Array.isArray(saved.metafields) || saved.metafields.length !== metafields.length ||
    saved.metafields.some(field => !isRecord(field) || !validGiftDigest(field.compareDigest)))
    throw new ApiError(502, 'invalid_shopify_response');
}

/** Credit and its permanent idempotency receipt commit together, including offline recipients. */
export async function sendCustomerGift(config: ShopifyConfig, customerId: string, rawGift: unknown,
  actor: string, request: ShopifyFetch, now = Date.now()) {
  const gift = parseGiftInput(rawGift);
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await load(config, customerId, request);
    const previous = current.gifts.ledger.entries.find(entry => entry.id === gift.id);
    if (previous) {
      if (previous.kind !== gift.kind || previous.amount !== gift.amount || previous.message !== gift.message)
        throw new ApiError(409, 'gift_id_conflict');
      return { gift: publicGift(previous), duplicate: true };
    }
    if (current.gifts.ledger.entries.length >= MAX_GIFT_HISTORY) throw new ApiError(409, 'gift_history_full');
    let raw: unknown = { ...newPlayer(), id: `shopify:${customerId}` }, compareDigest: string | null = null;
    if (current.player !== null) {
      if (!isRecord(current.player) || typeof current.player.value !== 'string' ||
        byteLength(current.player.value) > MAX_BODY_BYTES || !validGiftDigest(current.player.compareDigest))
        throw new ApiError(502, 'invalid_saved_player');
      try { raw = JSON.parse(current.player.value); } catch { throw new ApiError(502, 'invalid_saved_player'); }
      compareDigest = current.player.compareDigest;
    }
    let player;
    try { player = sanitizeDigitalPlayer(raw, customerId); } catch { throw new ApiError(502, 'invalid_saved_player'); }
    // A Bell gift must not replace the account's pending first-save starter Bell.
    if (gift.kind === 'guardianBells') player = retainGuardianBells(player, player, false);
    const balance = gift.kind === 'coins' ? player.coins : player.guardianBells.earned;
    const maximum = gift.kind === 'coins' ? 1e12 : MAX_GUARDIAN_BELLS;
    if (!Number.isSafeInteger(balance) || balance > maximum - gift.amount) throw new ApiError(409, 'gift_balance_limit');
    // Preserve every other stored field, including server metadata and cosmetic selections.
    const next = { ...(raw as Record<string, unknown>), ...(gift.kind === 'coins' ? { coins: balance + gift.amount }
      : { guardianBells: { ...player.guardianBells, earned: balance + gift.amount } }) };
    const entry: GiftEntry = { ...gift, sentAt: new Date(now).toISOString(), actor, acknowledged: false };
    const ledger = { version: 1 as const, entries: [...current.gifts.ledger.entries, entry] };
    // Never discard old IDs: a full ledger refuses a new gift instead of permitting replay.
    if (byteLength(JSON.stringify(ledger)) > MAX_BODY_BYTES) throw new ApiError(409, 'gift_history_full');
    try {
      await save(config, [fieldInput(customerId, PLAYER_KEY, next, compareDigest),
        fieldInput(customerId, GIFT_KEY, ledger, current.gifts.compareDigest)], request);
      return { gift: publicGift(entry), duplicate: false };
    } catch (error) { if (!(error instanceof ApiError) || error.code !== 'conflict' || attempt === 2) throw error; }
  }
  throw new ApiError(409, 'conflict');
}

/** Notification acknowledgement never changes a wallet or authorizes a new gift. */
export async function acknowledgeCustomerGifts(config: ShopifyConfig, customerId: string, ids: unknown, request: ShopifyFetch) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_PENDING_GIFTS || !ids.every(validGiftId) || new Set(ids).size !== ids.length)
    throw new ApiError(400, 'invalid_gift_acknowledgement');
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await load(config, customerId, request);
    if (ids.some(id => !current.gifts.ledger.entries.some(entry => entry.id === id)))
      throw new ApiError(400, 'unknown_gift');
    const ledger = { version: 1 as const, entries: current.gifts.ledger.entries.map(entry =>
      ids.includes(entry.id) ? { ...entry, acknowledged: true } : entry) };
    if (current.gifts.ledger.entries.every((entry, index) => entry.acknowledged === ledger.entries[index].acknowledged))
      return { acknowledgedGiftIds: ids, gifts: pendingGifts(ledger) };
    try {
      await save(config, [fieldInput(customerId, GIFT_KEY, ledger, current.gifts.compareDigest)], request);
      return { acknowledgedGiftIds: ids, gifts: pendingGifts(ledger) };
    } catch (error) { if (!(error instanceof ApiError) || error.code !== 'conflict' || attempt === 2) throw error; }
  }
  throw new ApiError(409, 'conflict');
}
