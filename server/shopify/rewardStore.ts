import { ApiError, type ShopifyConfig } from './auth.js';
import { hmacSha256, verifyHmacHex } from './crypto.js';
import { isRecord } from './playerValidation.js';
import { PLAYER_NAMESPACE, shopifyGraphql, type ShopifyFetch } from './playerStore.js';
import type { VerifiedRunChallenge } from '../../app/game/verifiedRun.js';
import { BIKES } from '../../app/domain/config.js';
import { shopifyAdminToken } from './adminToken.js';
import { validRewardCampaign, type RewardCampaign } from './rewardCampaign.js';

export const REWARD_KEY = 'verified_rewards_v1';
export const VERIFIED_POINTS_REQUIRED = 1_000_000;
export const VERIFIED_RUNS_REQUIRED = 0;
export const DAILY_VERIFIED_CAP = 1_000_000;
/** Bounds durable challenge issuance without cutting off legitimate short-crash sessions. */
export const DAILY_REWARD_START_CAP = 2_000;
export type RunChallenge = Omit<VerifiedRunChallenge, 'token'>;
export interface DiscountReservation {
  state: 'reserved' | 'issued'; code: string; startsAt: string; expiresAt: string; discountId?: string;
  /** Absent on legitimate legacy CHF5 reservations; those values remain immutable. */
  campaignId?: string; amountCHF?: number;
}
export interface RewardLedger {
  version: 1;
  points: number;
  runs: number;
  day: string;
  dailyPoints: number;
  dailyStarts: number;
  lastStartAt: number;
  active: RunChallenge | null;
  consumed: { runId: string; points: number }[];
  reward: DiscountReservation | null;
  campaign: RewardCampaign | null;
  rewardHistory: DiscountReservation[];
}
export interface SavedRewardLedger {
  ledger: RewardLedger;
  compareDigest: string | null;
  unavailableReason?: 'discount_scope_missing' | 'customer_scope_missing' | 'currency_not_chf';
}
export const rewardDay = (now: number) => new Date(now).toISOString().slice(0, 10);
export const emptyRewardLedger = (now: number): RewardLedger => ({ version: 1, points: 0, runs: 0,
  day: rewardDay(now), dailyPoints: 0, dailyStarts: 0, lastStartAt: 0, active: null, consumed: [], reward: null, campaign: null, rewardHistory: [] });
export const rollRewardDay = (ledger: RewardLedger, now: number): RewardLedger => ledger.day === rewardDay(now)
  ? ledger : { ...ledger, day: rewardDay(now), dailyPoints: 0, dailyStarts: 0 };
const ownerId = (customerId: string) => `gid://shopify/Customer/${customerId}`;
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
// JSON metafields may normalize object key order; signatures cover data, not formatting.
const canonicalJson = (value: unknown) => JSON.stringify(value, (_key, entry: unknown) =>
  isRecord(entry) ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
const ledgerMessage = (config: ShopifyConfig, customerId: string, ledger: unknown) =>
  `pfusch-verified-ledger-v1\n${config.shop}\n${customerId}\n${canonicalJson(ledger)}`;

function validLedger(value: unknown): value is RewardLedger {
  const legacyKeys = ['version', 'points', 'runs', 'day', 'dailyPoints', 'dailyStarts', 'lastStartAt', 'active', 'consumed', 'reward'];
  const keys = isRecord(value) ? Object.keys(value) : [];
  if (!isRecord(value) || value.version !== 1 || ![10, 12].includes(Object.keys(value).length) ||
    keys.some(key => ![...legacyKeys, 'campaign', 'rewardHistory'].includes(key)) || legacyKeys.some(key => !Object.hasOwn(value, key)) ||
    (keys.length === 12 && (!Object.hasOwn(value, 'campaign') || !Object.hasOwn(value, 'rewardHistory'))) ||
    !integer(value.points) || !integer(value.runs) || typeof value.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.day) ||
    !integer(value.dailyPoints, DAILY_VERIFIED_CAP) || !integer(value.dailyStarts, DAILY_REWARD_START_CAP) || !integer(value.lastStartAt) ||
    !Array.isArray(value.consumed) || value.consumed.length > 100 || !value.consumed.every(entry =>
      isRecord(entry) && Object.keys(entry).length === 2 && typeof entry.runId === 'string' && /^[a-f0-9]{32}$/.test(entry.runId) && integer(entry.points, DAILY_VERIFIED_CAP))) return false;
  if (value.active !== null) {
    const active = value.active;
    if (!isRecord(active) || Object.keys(active).length !== 6 || active.version !== 1 ||
      typeof active.runId !== 'string' || !/^[a-f0-9]{32}$/.test(active.runId) || !integer(active.seed, 0xffffffff) ||
      typeof active.bikeId !== 'string' || !BIKES.some(bike => bike.id === active.bikeId) ||
      !integer(active.startedAt) || !integer(active.expiresAt) || active.expiresAt - active.startedAt !== 1_800_000) return false;
  }
  if (value.campaign !== undefined && value.campaign !== null && !validRewardCampaign(value.campaign)) return false;
  if (value.rewardHistory !== undefined && (!Array.isArray(value.rewardHistory) || value.rewardHistory.length > 8)) return false;
  for (const reward of [value.reward, ...(Array.isArray(value.rewardHistory) ? value.rewardHistory : [])]) if (reward !== null) {
    if (!isRecord(reward) || !['reserved', 'issued'].includes(String(reward.state)) ||
      typeof reward.code !== 'string' || !/^PFUSCH[3-7]-[A-F0-9]{24}$/.test(reward.code) ||
      typeof reward.startsAt !== 'string' || !Number.isFinite(Date.parse(reward.startsAt)) ||
      typeof reward.expiresAt !== 'string' || Date.parse(reward.expiresAt) - Date.parse(reward.startsAt) !== 30 * 86_400_000 ||
      (reward.state === 'issued' && (typeof reward.discountId !== 'string' || !/^gid:\/\/shopify\/DiscountCodeNode\/\d+$/.test(reward.discountId))) ||
      reward.amountCHF !== undefined && (!integer(reward.amountCHF, 7) || reward.amountCHF < 3) ||
      reward.code.slice(0, 8) !== `PFUSCH${reward.amountCHF ?? 5}-` ||
      (reward.amountCHF === undefined) !== (reward.campaignId === undefined) ||
      reward.campaignId !== undefined && (typeof reward.campaignId !== 'string' || !/^(launch-million-2026|week:\d{4}-\d{2}-\d{2})$/.test(reward.campaignId))) return false;
  }
  const rewards = [value.reward, ...(Array.isArray(value.rewardHistory) ? value.rewardHistory : [])].filter(isRecord);
  if (new Set(rewards.map(reward => reward.code)).size !== rewards.length) return false;
  return true;
}

/** Separate, authenticated server ledger. Client player_v1 fields never enter this read path. */
export async function loadRewardLedger(config: ShopifyConfig, customerId: string, now: number, request: ShopifyFetch, recheckScopes = true): Promise<SavedRewardLedger> {
  const data = await shopifyGraphql(config, `query GameRewardLedger($id: ID!, $namespace: String!, $key: String!) {
    shop { currencyCode }
    currentAppInstallation { accessScopes { handle } }
    customer(id: $id) { id metafield(namespace: $namespace, key: $key) { value compareDigest } }
  }`, { id: ownerId(customerId), namespace: PLAYER_NAMESPACE, key: REWARD_KEY }, request);
  if (data.customer === null) throw new ApiError(401, 'unauthorized');
  if (!isRecord(data.customer) || data.customer.id !== ownerId(customerId) || !isRecord(data.shop) ||
    !isRecord(data.currentAppInstallation) || !Array.isArray(data.currentAppInstallation.accessScopes)) throw new ApiError(502, 'invalid_reward_response');
  const scopes = data.currentAppInstallation.accessScopes.filter(isRecord).map(scope => scope.handle);
  const unavailableReason = !scopes.includes('write_discounts') ? 'discount_scope_missing'
    : !scopes.includes('write_customers') ? 'customer_scope_missing' : data.shop.currencyCode !== 'CHF' ? 'currency_not_chf' : undefined;
  if (recheckScopes && (unavailableReason === 'discount_scope_missing' || unavailableReason === 'customer_scope_missing')
    && await shopifyAdminToken.refreshAfterScopeChange(config, request))
    return loadRewardLedger(config, customerId, now, request, false);
  const field = data.customer.metafield;
  if (field === null) return { ledger: emptyRewardLedger(now), compareDigest: null, unavailableReason };
  if (!isRecord(field) || !digest(field.compareDigest) || typeof field.value !== 'string' || field.value.length > 32768)
    throw new ApiError(502, 'invalid_reward_ledger');
  let stored: unknown;
  try { stored = JSON.parse(field.value); } catch { throw new ApiError(502, 'invalid_reward_ledger'); }
  if (!isRecord(stored) || Object.keys(stored).length !== 2 || typeof stored.signature !== 'string' || !validLedger(stored.ledger) ||
    !await verifyHmacHex(stored.signature, ledgerMessage(config, customerId, stored.ledger), config.secret)) throw new ApiError(502, 'invalid_reward_ledger');
  // Verify the original signed v1 bytes above before adding the new fields.
  // Old reservations/codes, dates and spending restrictions stay unchanged.
  const migrated = { ...stored.ledger, campaign: stored.ledger.campaign ?? null, rewardHistory: stored.ledger.rewardHistory ?? [] };
  return { ledger: rollRewardDay(migrated, now), compareDigest: field.compareDigest, unavailableReason };
}

export async function saveRewardLedger(config: ShopifyConfig, customerId: string, ledger: RewardLedger, compareDigest: string | null, request: ShopifyFetch) {
  const signature = await hmacSha256(ledgerMessage(config, customerId, ledger), config.secret);
  const data = await shopifyGraphql(config, `mutation SaveGameRewardLedger($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { metafields { compareDigest } userErrors { code } }
  }`, { metafields: [{ ownerId: ownerId(customerId), namespace: PLAYER_NAMESPACE, key: REWARD_KEY,
    type: 'json', value: JSON.stringify({ ledger, signature }), compareDigest }] }, request);
  const result = data.metafieldsSet;
  if (!isRecord(result) || !Array.isArray(result.userErrors)) throw new ApiError(502, 'invalid_reward_response');
  if (result.userErrors.some(value => isRecord(value) && ['STALE_OBJECT', 'INVALID_COMPARE_DIGEST'].includes(String(value.code)))) throw new ApiError(409, 'reward_conflict');
  if (result.userErrors.length) throw new ApiError(503, 'reward_save_rejected');
  if (!Array.isArray(result.metafields) || result.metafields.length !== 1 || !isRecord(result.metafields[0]) || !digest(result.metafields[0].compareDigest))
    throw new ApiError(502, 'invalid_reward_response');
  return result.metafields[0].compareDigest;
}
