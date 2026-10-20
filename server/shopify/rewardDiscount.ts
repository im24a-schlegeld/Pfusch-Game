import { ApiError, type ShopifyConfig } from './auth.js';
import { hmacSha256 } from './crypto.js';
import { isRecord } from './playerValidation.js';
import { shopifyGraphql, type ShopifyFetch } from './playerStore.js';
import type { DiscountReservation } from './rewardStore.js';

export async function reserveRewardDiscount(config: ShopifyConfig, customerId: string, now: number,
  campaign?: { id: string; rewardCHF: number }): Promise<DiscountReservation> {
  now = Math.floor(now / 1000) * 1000;
  const amount = campaign?.rewardCHF ?? 5;
  if (!Number.isInteger(amount) || amount < 3 || amount > 7 || campaign && !/^(launch-million-2026|week:\d{4}-\d{2}-\d{2})$/.test(campaign.id))
    throw new ApiError(503, 'invalid_reward_campaign');
  const message = campaign ? `pfusch-weekly-coupon-v1\n${config.shop}\n${customerId}\n${campaign.id}\n${amount}`
    : `pfusch-chf5-once-v1\n${config.shop}\n${customerId}`;
  const code = `PFUSCH${amount}-${(await hmacSha256(message, config.secret)).slice(0, 24).toUpperCase()}`;
  return { state: 'reserved', code, startsAt: new Date(now).toISOString(), expiresAt: new Date(now + 30 * 86_400_000).toISOString(),
    ...(campaign ? { campaignId: campaign.id, amountCHF: amount } : {}) };
}
const selection = `id codeDiscount { __typename ... on DiscountCodeBasic {
  title startsAt endsAt usageLimit appliesOncePerCustomer
  codes(first: 2) { nodes { code } }
  combinesWith { orderDiscounts productDiscounts shippingDiscounts }
  context { __typename ... on DiscountCustomers { customers { id } } }
  customerGets { value { __typename ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem } }
    items { __typename ... on AllDiscountItems { allItems } } }
  minimumRequirement { __typename ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } } }
} }`;
const titleFor = (reward: DiscountReservation) => `PFUSCH Wheelie Escape · CHF ${reward.amountCHF ?? 5}`;
const discountInputFields = new Set(['title', 'code', 'startsAt', 'endsAt', 'context', 'customerGets',
  'minimumRequirement', 'usageLimit', 'appliesOncePerCustomer', 'combinesWith', 'recurringCycleLimit']);
/** Only schema error enums and known field names may enter the public diagnostic. */
function creationFailure(errors: unknown[]): ApiError {
  const issue = errors.find(isRecord);
  const reason = typeof issue?.code === 'string' && /^[A-Z][A-Z_]{1,63}$/.test(issue.code)
    ? issue.code.toLowerCase() : 'unknown';
  const field = reason !== 'unknown' && Array.isArray(issue?.field)
    ? issue.field.find((part: unknown): part is string => typeof part === 'string' && discountInputFields.has(part)) : undefined;
  return new ApiError(503, `reward_discount_create_failed_${reason}${field ? `_${field.toLowerCase()}` : ''}`);
}

/** A matching code alone is insufficient: verify amount, buyer, dates and all restrictions. */
export function verifyRewardDiscount(node: unknown, reward: DiscountReservation, customerId: string): string {
  const invalid = (): never => { throw new ApiError(503, 'reward_discount_mismatch'); };
  if (!isRecord(node) || typeof node.id !== 'string' || !/^gid:\/\/shopify\/DiscountCodeNode\/\d+$/.test(node.id) || !isRecord(node.codeDiscount)) return invalid();
  const discount = node.codeDiscount;
  const combinations = discount.combinesWith;
  if (discount.__typename !== 'DiscountCodeBasic' || discount.title !== titleFor(reward) || discount.usageLimit !== 1 || discount.appliesOncePerCustomer !== true ||
    typeof discount.startsAt !== 'string' || Date.parse(discount.startsAt) !== Date.parse(reward.startsAt) ||
    typeof discount.endsAt !== 'string' || Date.parse(discount.endsAt) !== Date.parse(reward.expiresAt) ||
    !isRecord(discount.codes) || !Array.isArray(discount.codes.nodes) || discount.codes.nodes.length !== 1 ||
    !isRecord(discount.codes.nodes[0]) || discount.codes.nodes[0].code !== reward.code ||
    !isRecord(combinations) || ['orderDiscounts', 'productDiscounts', 'shippingDiscounts'].some(key => combinations[key] !== false)) return invalid();
  const context = discount.context, gets = discount.customerGets, minimum = discount.minimumRequirement;
  if (!isRecord(context) || context.__typename !== 'DiscountCustomers' || !Array.isArray(context.customers) || context.customers.length !== 1 ||
    !isRecord(context.customers[0]) || context.customers[0].id !== `gid://shopify/Customer/${customerId}` ||
    !isRecord(gets) || !isRecord(gets.value) || gets.value.__typename !== 'DiscountAmount' || gets.value.appliesOnEachItem !== false ||
    !isRecord(gets.value.amount) || gets.value.amount.currencyCode !== 'CHF' || Number(gets.value.amount.amount) !== (reward.amountCHF ?? 5) ||
    !isRecord(gets.items) || gets.items.__typename !== 'AllDiscountItems' || gets.items.allItems !== true ||
    !isRecord(minimum) || minimum.__typename !== 'DiscountMinimumSubtotal' || !isRecord(minimum.greaterThanOrEqualToSubtotal) ||
    minimum.greaterThanOrEqualToSubtotal.currencyCode !== 'CHF' || Number(minimum.greaterThanOrEqualToSubtotal.amount) !== 50) return invalid();
  return node.id;
}

/** Call only after the reservation is durable. A timeout never means "try a new code". */
export async function issueRewardDiscount(config: ShopifyConfig, customerId: string, reward: DiscountReservation, request: ShopifyFetch): Promise<string> {
  const lookup = async () => {
    const data = await shopifyGraphql(config, `query GameRewardDiscount($code: String!) { codeDiscountNodeByCode(code: $code) { ${selection} } }`, { code: reward.code }, request);
    if (data.codeDiscountNodeByCode === null) return null;
    return verifyRewardDiscount(data.codeDiscountNodeByCode, reward, customerId);
  };
  const existing = await lookup();
  if (existing) return existing;
  try {
    const data = await shopifyGraphql(config, `mutation CreateGameRewardDiscount($discount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $discount) { codeDiscountNode { ${selection} } userErrors { code field } }
    }`, { discount: { title: titleFor(reward), code: reward.code, startsAt: reward.startsAt, endsAt: reward.expiresAt,
      context: { customers: { add: [`gid://shopify/Customer/${customerId}`] } },
      customerGets: { value: { discountAmount: { amount: (reward.amountCHF ?? 5).toFixed(2), appliesOnEachItem: false } }, items: { all: true } },
      minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: '50.00' } },
      usageLimit: 1, appliesOncePerCustomer: true,
      combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false }, recurringCycleLimit: 1,
    } }, request);
    const result = data.discountCodeBasicCreate;
    if (!isRecord(result) || !Array.isArray(result.userErrors)) throw new ApiError(503, 'reward_discount_create_failed_invalid_response');
    if (result.userErrors.length) throw creationFailure(result.userErrors);
    return verifyRewardDiscount(result.codeDiscountNode, reward, customerId);
  } catch (error) {
    // Includes duplicate-code races and ambiguous network failures after Shopify committed.
    try {
      const recovered = await lookup();
      if (recovered) return recovered;
    } catch { /* Preserve the original failure when recovery is also unavailable. */ }
    throw error;
  }
}
