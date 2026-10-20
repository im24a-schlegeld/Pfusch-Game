import { afterEach, describe, expect, it, vi } from 'vitest';
import * as replayModule from '../app/game/verifiedRun';
import { ApiError, createCsrf, type ShopifyConfig } from '../server/shopify/auth';
import { handleRewardRequest, signRunChallenge, type RewardAction } from '../server/shopify/rewardEndpoint';
import { emptyRewardLedger, loadRewardLedger, REWARD_KEY, saveRewardLedger, type RewardLedger, type RunChallenge } from '../server/shopify/rewardStore';
import { reserveRewardDiscount, verifyRewardDiscount } from '../server/shopify/rewardDiscount';
import { PLAYER_NAMESPACE } from '../server/shopify/playerStore';
import { currentRewardOffer, freshRewardCampaign, REWARD_ATTEMPT_MS } from '../server/shopify/rewardCampaign';
import { hmacSha256 } from '../server/shopify/crypto';

const now = Date.UTC(2026, 9, 7, 12);
const config: ShopifyConfig = { shop: 'reward-test.myshopify.com', secret: 'test-only-reward-secret', adminToken: 'test-only-token' };
const identity = { shop: config.shop, customerId: '123' };
const json = (data: unknown) => Response.json({ data });
function discountNode(input: Record<string, unknown>) {
  const context = input.context as { customers: { add: string[] } };
  const amount = (input.customerGets as { value: { discountAmount: { amount: string } } }).value.discountAmount.amount;
  return { id: 'gid://shopify/DiscountCodeNode/345', codeDiscount: {
    __typename: 'DiscountCodeBasic', title: input.title, startsAt: input.startsAt, endsAt: input.endsAt,
    usageLimit: input.usageLimit, appliesOncePerCustomer: input.appliesOncePerCustomer,
    codes: { nodes: [{ code: input.code }] }, combinesWith: input.combinesWith,
    context: { __typename: 'DiscountCustomers', customers: context.customers.add.map(id => ({ id })) },
    customerGets: { value: { __typename: 'DiscountAmount', amount: { amount, currencyCode: 'CHF' }, appliesOnEachItem: false },
      items: { __typename: 'AllDiscountItems', allItems: true } },
    minimumRequirement: { __typename: 'DiscountMinimumSubtotal', greaterThanOrEqualToSubtotal: { amount: '50.00', currencyCode: 'CHF' } },
  } };
}
function fixture() {
  const state = { value: null as string | null, digest: null as string | null, writes: 0,
    currency: 'CHF', scopes: ['write_customers', 'write_discounts'], discount: null as ReturnType<typeof discountNode> | null,
    creates: 0, ambiguousCreate: false, failIssuedSave: false, firstSaveConflict: false, clock: now,
    creationUserErrors: null as unknown[] | null, failRecoveryLookup: false,
    discounts: new Map<string, ReturnType<typeof discountNode>>() };
  const request = vi.fn<typeof fetch>(async (_url, options) => {
    if (typeof options?.body !== 'string') throw new Error('Expected a JSON request body');
    const { query, variables } = JSON.parse(options.body) as { query: string; variables: Record<string, unknown> };
    if (query.includes('query GameRewardLedger')) {
      expect(variables.namespace).toBe(PLAYER_NAMESPACE);
      expect(variables.key).toBe(REWARD_KEY);
      return json({ shop: { currencyCode: state.currency }, currentAppInstallation: { accessScopes: state.scopes.map(handle => ({ handle })) },
        customer: { id: variables.id, metafield: state.value === null ? null : { value: state.value, compareDigest: state.digest } } });
    }
    if (query.includes('mutation SaveGameRewardLedger')) {
      const field = (variables.metafields as { key: string; value: string; compareDigest: string | null }[])[0];
      expect(field.key).toBe(REWARD_KEY);
      if (state.firstSaveConflict) { state.firstSaveConflict = false; return json({ metafieldsSet: { metafields: [], userErrors: [{ code: 'STALE_OBJECT' }] } }); }
      if (field.compareDigest !== state.digest) return json({ metafieldsSet: { metafields: [], userErrors: [{ code: 'INVALID_COMPARE_DIGEST' }] } });
      if (state.failIssuedSave && JSON.parse(field.value).ledger.reward?.state === 'issued') throw new Error('test network outage');
      state.value = field.value; state.writes++;
      state.digest = state.writes.toString(16).padStart(64, '0');
      return json({ metafieldsSet: { metafields: [{ compareDigest: state.digest }], userErrors: [] } });
    }
    if (query.includes('query GameRewardDiscount')) {
      if (state.failRecoveryLookup && state.creates > 0) throw new ApiError(503, 'shopify_admin_timeout');
      return json({ codeDiscountNodeByCode: state.discounts.get(String(variables.code)) ?? null });
    }
    if (query.includes('mutation CreateGameRewardDiscount')) {
      state.creates++;
      // The reservation must already be durable before any financial mutation.
      const persisted = JSON.parse(state.value!).ledger;
      expect([persisted.reward, ...(persisted.rewardHistory ?? [])].some((reward: { state: string } | null) => reward?.state === 'reserved')).toBe(true);
      const input = variables.discount as Record<string, unknown>;
      expect(input).toMatchObject({ usageLimit: 1, appliesOncePerCustomer: true,
        context: { customers: { add: ['gid://shopify/Customer/123'] } },
        customerGets: { value: { discountAmount: { appliesOnEachItem: false } }, items: { all: true } },
        minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: '50.00' } },
        combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false } });
      if (state.creationUserErrors) return json({ discountCodeBasicCreate: { codeDiscountNode: null, userErrors: state.creationUserErrors } });
      if (state.discounts.has(String(input.code))) return json({ discountCodeBasicCreate: { codeDiscountNode: null, userErrors: [{ code: 'TAKEN' }] } });
      state.discount = discountNode(input);
      state.discounts.set(String(input.code), state.discount);
      if (state.ambiguousCreate) throw new Error('test response lost after commit');
      return json({ discountCodeBasicCreate: { codeDiscountNode: state.discount, userErrors: [] } });
    }
    throw new Error('Unexpected mock query');
  });
  const dependencies = { config, enabled: true, request, now: () => state.clock, authenticate: async () => identity };
  const call = async (action: RewardAction, payload: Record<string, unknown> = {}) => handleRewardRequest(action, {
    method: action === 'status' ? 'GET' : 'POST', url: `https://game.invalid/api/rewards/${action}`, contentType: 'application/json',
    readBody: async () => ({ csrfToken: await createCsrf(identity, config.secret, state.clock), ...payload }),
  }, dependencies);
  const seedLedger = async (changes: Partial<RewardLedger> = {}) => {
    const offer = await currentRewardOffer(config, state.clock);
    const campaign = freshRewardCampaign(offer);
    if (changes.points) {
      campaign.progress = Math.min(campaign.target, changes.points); campaign.attempt = 1;
      campaign.startedAt = state.clock; campaign.expiresAt = state.clock + REWARD_ATTEMPT_MS;
      campaign.completedAt = campaign.progress === campaign.target ? state.clock : null;
    }
    const ledger = { ...emptyRewardLedger(state.clock), campaign, ...changes };
    await saveRewardLedger(config, '123', ledger, state.digest, request);
    return ledger;
  };
  const active = async (changes: Partial<RewardLedger> = {}) => {
    const challenge: RunChallenge = { version: 1, runId: 'a'.repeat(32), seed: 42, bikeId: '125', startedAt: now, expiresAt: now + 1_800_000 };
    await seedLedger({ ...changes, active: challenge });
    return { challenge, token: await signRunChallenge(challenge, identity, config.secret) };
  };
  return { state, request, dependencies, call, seedLedger, active };
}
afterEach(() => vi.restoreAllMocks());

describe('server-verified Shopify reward authority', () => {
  it('starts exactly 48 hours on the first signed, score-positive proof including short runs', async () => {
    const f = fixture();
    const start = await f.call('run/start', { bikeId: '125' });
    expect((await f.call('status')).body.campaign).toMatchObject({ startedAt: null, expiresAt: null, attempt: 0 });
    const challenge = start.body.challenge as replayModule.VerifiedRunChallenge;
    f.state.clock += 2_000;
    const short = await f.call('run/finish', { token: challenge.token, proof: { ticks: 60, events: [{ tick: 60, input: { type: 'end' } }] } });
    const firstAcceptedAt = f.state.clock;
    expect(short.body).toMatchObject({ creditedPoints: 2, verifiedPoints: 2, verifiedRuns: 1 });
    expect(short.body.campaign).toMatchObject({ startedAt: new Date(firstAcceptedAt).toISOString(), expiresAt: new Date(firstAcceptedAt + REWARD_ATTEMPT_MS).toISOString(), attempt: 1, progress: 2 });
    f.state.clock += 30_000;
    const next = (await f.call('run/start', { bikeId: '125' })).body.challenge as replayModule.VerifiedRunChallenge;
    vi.spyOn(replayModule, 'replayVerifiedRunDetailed').mockReturnValue({ score: 9999, ticks: 1200, crashed: true, jumps: 4, nearMisses: 7, policeEscapes: 1 });
    f.state.clock += 25_000;
    // A subsequent ride must add score without restarting the first 48-hour window.
    const finished = await f.call('run/finish', { token: next.token, proof: { ticks: 1200, events: [] } });
    expect(finished.status).toBe(200);
    expect(finished.body.campaign).toMatchObject({ progress: 10001, attempt: 1, startedAt: new Date(firstAcceptedAt).toISOString(), expiresAt: new Date(firstAcceptedAt + REWARD_ATTEMPT_MS).toISOString() });
    expect(finished.body.creditedPoints).toBe(9999);
    const writes = f.state.writes;
    expect((await f.call('run/finish', { token: next.token, proof: { ticks: 1200, events: [] } })).body.campaign).toEqual(finished.body.campaign);
    expect(f.state.writes).toBe(writes);
  });

  it('credits the entire 25k score after a short verified ride, not seconds multiplied by 100', async () => {
    vi.spyOn(replayModule, 'replayVerifiedRunDetailed').mockReturnValue({ score: 25000, ticks: 120, crashed: true, jumps: 0, nearMisses: 0, policeEscapes: 0 });
    const f = fixture(), { token } = await f.active();
    f.state.clock += 3_000;
    const finish = await f.call('run/finish', { token, proof: { ticks: 120, events: [] } });
    expect(finish.status).toBe(200);
    expect(finish.body.creditedPoints).toBe(25000);
    expect(finish.body.campaign).toMatchObject({ progress: 25000 });
    expect((await f.call('run/finish', { token, proof: { ticks: 120, events: [] } })).body.creditedPoints).toBe(25000);
  });

  it('restarts an expired attempt only with another qualifying proof and resets progress', async () => {
    const f = fixture(), offer = await currentRewardOffer(config, now);
    const campaign = { ...freshRewardCampaign(offer), progress: 900000, startedAt: now - REWARD_ATTEMPT_MS - 1, expiresAt: now - 1, attempt: 2 };
    const { token } = await f.active({ campaign });
    expect((await f.call('status')).body.campaign).toMatchObject({ phase: 'expired', progress: 900000, attempt: 2 });
    vi.spyOn(replayModule, 'replayVerifiedRunDetailed').mockReturnValue({ score: 100, ticks: 1200, crashed: true, jumps: 1, nearMisses: 2, policeEscapes: 0 });
    f.state.clock += 21000;
    expect((await f.call('run/finish', { token, proof: { ticks: 1200, events: [] } })).body.campaign).toMatchObject({ phase: 'active', progress: 100, attempt: 3, startedAt: new Date(f.state.clock).toISOString() });
  });

  it('keeps the full active 48-hour grace across Monday, then offers the current week', async () => {
    const f = fixture(); f.state.clock = Date.UTC(2026, 9, 25, 23);
    const startedAt = f.state.clock, offer = await currentRewardOffer(config, startedAt);
    await f.seedLedger({ campaign: { ...freshRewardCampaign(offer), startedAt, expiresAt: startedAt + REWARD_ATTEMPT_MS, progress: 500, attempt: 1 } });
    f.state.clock = Date.UTC(2026, 9, 26, 12);
    const grace = await f.call('status');
    expect(grace.body.campaign).toMatchObject({ id: 'launch-million-2026', progress: 500, phase: 'active', expiresAt: new Date(startedAt + REWARD_ATTEMPT_MS).toISOString() });
    expect(grace.body.nextCampaign).toMatchObject({ id: 'week:2026-10-26' });
    f.state.clock = startedAt + REWARD_ATTEMPT_MS + 1;
    expect((await f.call('status')).body.campaign).toMatchObject({ id: 'week:2026-10-26', phase: 'not_started', startedAt: null, progress: 0 });
  });

  it('accepts a valid first proof prepared before Monday and starts the current offer at acceptance', async () => {
    const f = fixture(); f.state.clock = Date.UTC(2026, 9, 25, 23, 50);
    const started = (await f.call('run/start', { bikeId: '125' })).body.challenge as replayModule.VerifiedRunChallenge;
    vi.spyOn(replayModule, 'replayVerifiedRunDetailed').mockReturnValue({ score: 100, ticks: 1200, crashed: true, jumps: 1, nearMisses: 2, policeEscapes: 1 });
    f.state.clock = Date.UTC(2026, 9, 26, 0, 10);
    const result = await f.call('run/finish', { token: started.token, proof: { ticks: 1200, events: [] } });
    expect(result.status).toBe(200);
    expect(result.body.campaign).toMatchObject({ id: 'week:2026-10-26', phase: 'active', attempt: 1, startedAt: new Date(f.state.clock).toISOString(), expiresAt: new Date(f.state.clock + REWARD_ATTEMPT_MS).toISOString() });
  });

  it.each(['jumps', 'nearMisses', 'policeEscapes'] as const)('credits %s only from replay, reserves once at the target, and defers financial creation to claim', async metric => {
    const f = fixture();
    const campaign = { ...freshRewardCampaign(await currentRewardOffer(config, now)), metric, target: 2 };
    const { token } = await f.active({ campaign }); f.state.clock += 21000;
    vi.spyOn(replayModule, 'replayVerifiedRunDetailed').mockReturnValue({ score: 100, ticks: 1200, crashed: true, jumps: 2, nearMisses: 2, policeEscapes: 2 });
    const finish = await f.call('run/finish', { token, proof: { ticks: 1200, events: [] } });
    expect(finish.body.campaign).toMatchObject({ metric, progress: 2, phase: 'completed' });
    expect(finish.body).toMatchObject({ pending: true, eligible: false, reward: null });
    expect(f.state.creates).toBe(0);
    expect((await f.call('claim')).status).toBe(200);
    expect((await f.call('claim')).status).toBe(200);
    expect(f.state.creates).toBe(1);
  });

  it('preserves an earlier legitimate coupon while issuing distinct bounded weekly rewards', async () => {
    const f = fixture(); await f.seedLedger({ points: 1000000 });
    const first = await f.call('claim'), firstReward = first.body.reward;
    const reservation = JSON.parse(f.state.value!).ledger.reward;
    f.state.clock = Date.UTC(2026, 9, 26, 12);
    const current = await currentRewardOffer(config, f.state.clock);
    const fresh = await f.call('status');
    expect(fresh.body.reward).toEqual(firstReward);
    expect(fresh.body.campaign).toMatchObject({ id: current.id, phase: 'not_started' });
    await f.seedLedger({ campaign: { ...freshRewardCampaign(current), progress: current.target, startedAt: f.state.clock, expiresAt: f.state.clock + REWARD_ATTEMPT_MS, completedAt: f.state.clock, attempt: 1 }, rewardHistory: [reservation] });
    const second = await f.call('claim');
    expect(second.status).toBe(200);
    expect(second.body.rewards).toEqual(expect.arrayContaining([{ code: reservation.code, expiresAt: reservation.expiresAt, amountCHF: 5, campaignId: 'launch-million-2026' }, expect.objectContaining({ amountCHF: current.rewardCHF, campaignId: current.id })]));
    expect(second.body.reward).not.toEqual(firstReward);
    expect(f.state.creates).toBe(2);
    expect(Number(f.state.discount!.codeDiscount.customerGets.value.amount.amount)).toBe(current.rewardCHF);
  });

  it('verifies the original signed v1 ledger before migrating and recovers its pending legacy coupon without changing dates or value', async () => {
    const f = fixture(), legacyReward = await reserveRewardDiscount(config, '123', now);
    const { campaign: _campaign, rewardHistory: _history, ...legacy } = emptyRewardLedger(now);
    legacy.reward = legacyReward;
    const canonical = JSON.stringify(legacy, (_key, entry: unknown) => entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right))) : entry);
    f.state.value = JSON.stringify({ ledger: legacy, signature: await hmacSha256(`pfusch-verified-ledger-v1\n${config.shop}\n123\n${canonical}`, config.secret) });
    f.state.digest = '1'.repeat(64);
    expect((await f.call('status')).body).toMatchObject({ pending: true, campaign: { phase: 'not_started' } });
    const claim = await f.call('claim');
    expect(claim.status).toBe(200);
    expect(claim.body.reward).toEqual({ code: legacyReward.code, expiresAt: legacyReward.expiresAt });
    const loaded = await loadRewardLedger(config, '123', now, f.request);
    expect(loaded.ledger.rewardHistory).toEqual([{ ...legacyReward, state: 'issued', discountId: 'gid://shopify/DiscountCodeNode/345' }]);
    expect(loaded.ledger.campaign?.progress).toBe(0);
  });

  it('repairs an older pending reservation even when the current campaign already has an issued coupon', async () => {
    const f = fixture();
    const older = await reserveRewardDiscount(config, '123', now, await currentRewardOffer(config, now));
    f.state.clock = Date.UTC(2026, 9, 26, 12);
    const offer = await currentRewardOffer(config, f.state.clock);
    const current = { ...await reserveRewardDiscount(config, '123', f.state.clock, offer), state: 'issued' as const, discountId: 'gid://shopify/DiscountCodeNode/456' };
    await f.seedLedger({ campaign: { ...freshRewardCampaign(offer), progress: offer.target, startedAt: f.state.clock,
      expiresAt: f.state.clock + REWARD_ATTEMPT_MS, completedAt: f.state.clock, attempt: 1 }, reward: current, rewardHistory: [older] });
    expect((await f.call('status')).body).toMatchObject({ pending: true, campaign: { phase: 'claimed' } });
    const claim = await f.call('claim');
    expect(claim.status).toBe(200);
    expect(claim.body).toMatchObject({ pending: false, reward: { code: current.code, expiresAt: current.expiresAt } });
    const saved = await loadRewardLedger(config, '123', f.state.clock, f.request);
    expect(saved.ledger.reward).toEqual(current);
    expect(saved.ledger.rewardHistory[0]).toMatchObject({ ...older, state: 'issued' });
    const dates = saved.ledger.rewardHistory[0].expiresAt;
    expect((await f.call('claim')).status).toBe(200);
    expect(f.state.creates).toBe(1);
    expect(dates).toBe(older.expiresAt);
  });
  it('requires enablement, authentication and CSRF before any upstream write or body trust', async () => {
    const f = fixture();
    f.dependencies.enabled = false;
    expect((await f.call('status')).body).toMatchObject({ available: false, reason: 'rewards_disabled', verifiedPoints: 0, reward: null });
    expect(f.request).not.toHaveBeenCalled();
    f.dependencies.enabled = true;
    f.dependencies.authenticate = async () => { throw new ApiError(401, 'unauthorized'); };
    expect((await f.call('claim')).status).toBe(401);
    expect(f.request).not.toHaveBeenCalled();
    f.dependencies.authenticate = async () => identity;
    expect((await f.call('claim', { csrfToken: 'forged' })).status).toBe(403);
    expect((await f.call('claim', { player: { coins: 999999, xp: 999999, highScore: 999999 } })).status).toBe(400);
    expect(f.request).not.toHaveBeenCalled();
  });

  it('fails closed for missing discount permission and non-CHF shops', async () => {
    const f = fixture(); f.state.scopes = ['write_customers'];
    expect((await f.call('status')).body).toMatchObject({ available: false, reason: 'discount_scope_missing' });
    expect((await f.call('claim')).status).toBe(503);
    f.state.scopes.push('write_discounts'); f.state.currency = 'EUR';
    expect((await f.call('status')).body).toMatchObject({ available: false, reason: 'currency_not_chf' });
    expect((await f.call('run/start', { bikeId: '125' })).status).toBe(503);
    expect(f.state.writes).toBe(0); expect(f.state.creates).toBe(0);
  });

  it('signs server-generated bike/seed/time/customer runs and rate-limits new starts', async () => {
    const f = fixture();
    const start = await f.call('run/start', { bikeId: '450' });
    expect(start.status).toBe(200);
    expect(start.body.challenge).toMatchObject({ version: 1, bikeId: '450', startedAt: now, expiresAt: now + 1_800_000 });
    const challenge = start.body.challenge as replayModule.VerifiedRunChallenge;
    expect(challenge.runId).toMatch(/^[a-f0-9]{32}$/);
    expect((await f.call('run/start', { bikeId: '125' })).status).toBe(429);
    const forged = challenge.token.slice(0, -1) + (challenge.token.endsWith('0') ? '1' : '0');
    expect((await f.call('run/finish', { token: forged, proof: { ticks: 0, events: [] } })).body.error).toBe('invalid_run_token');
    await expect(loadRewardLedger(config, '999', now, f.request)).rejects.toThrow('invalid_reward_ledger');
    f.state.value = null; f.state.digest = null;
    f.dependencies.authenticate = async () => ({ ...identity, customerId: '999' });
    const badCustomer = await handleRewardRequest('run/finish', { method: 'POST', url: '/', contentType: 'application/json', readBody: async () => ({
      csrfToken: await createCsrf({ ...identity, customerId: '999' }, config.secret, now), token: challenge.token, proof: { ticks: 0, events: [] },
    }) }, f.dependencies);
    expect(badCustomer.body.error).toBe('invalid_run_token');
    expect(f.state.creates).toBe(0);
  });

  it('reuses an unfinished same-bike preparation without another write or consuming the daily allowance', async () => {
    const f = fixture();
    const first = await f.call('run/start', { bikeId: '450' });
    const writes = f.state.writes;
    f.state.clock += 10_000;
    const repeated = await f.call('run/start', { bikeId: '450' });
    expect(repeated.status).toBe(200);
    expect(repeated.body.challenge).toEqual(first.body.challenge);
    expect(f.state.writes).toBe(writes);
    expect((await loadRewardLedger(config, '123', f.state.clock, f.request)).ledger.dailyStarts).toBe(1);
  });

  it('converges concurrent duplicate preparations to one signed challenge and one counted start', async () => {
    const f = fixture();
    const preparations = await Promise.all(Array.from({ length: 5 }, () => f.call('run/start', { bikeId: '450' })));
    expect(preparations.map(result => result.status)).toEqual([200, 200, 200, 200, 200]);
    expect(new Set(preparations.map(result => JSON.stringify(result.body.challenge))).size).toBe(1);
    expect((await loadRewardLedger(config, '123', f.state.clock, f.request)).ledger.dailyStarts).toBe(1);
    expect(f.state.writes).toBe(1);
  });

  it('allows the next genuine short-crash ride without waiting thirty seconds', async () => {
    const f = fixture();
    const first = (await f.call('run/start', { bikeId: '125' })).body.challenge as replayModule.VerifiedRunChallenge;
    f.state.clock += 2_000;
    const finish = await f.call('run/finish', { token: first.token, proof: { ticks: 60, events: [{ tick: 60, input: { type: 'end' } }] } });
    expect(finish.status).toBe(200);
    const next = await f.call('run/start', { bikeId: '125' });
    expect(next.status).toBe(200);
    expect((next.body.challenge as replayModule.VerifiedRunChallenge).runId).not.toBe(first.runId);
    expect((await loadRewardLedger(config, '123', f.state.clock, f.request)).ledger.dailyStarts).toBe(2);
  });

  it('retains legacy starts while allowing more than forty legitimate rides in a day', async () => {
    const f = fixture();
    await f.seedLedger({ dailyStarts: 40, lastStartAt: now - 31_000 });
    expect((await f.call('run/start', { bikeId: '125' })).status).toBe(200);
    expect((await loadRewardLedger(config, '123', f.state.clock, f.request)).ledger.dailyStarts).toBe(41);
  });

  it('keeps bounded new issuance while allowing the existing proof to be recovered at the allowance', async () => {
    const f = fixture();
    const { challenge } = await f.active({ dailyStarts: 2_000, lastStartAt: now - 31_000 });
    const writes = f.state.writes;
    const recovered = await f.call('run/start', { bikeId: '125' });
    expect(recovered.status).toBe(200);
    expect(recovered.body.challenge).toMatchObject(challenge);
    expect((await f.call('run/start', { bikeId: '450' })).body.error).toBe('reward_run_limit');
    expect(f.state.writes).toBe(writes);
    f.state.clock += 86_400_000;
    expect((await f.call('run/start', { bikeId: '450' })).status).toBe(200);
    expect((await loadRewardLedger(config, '123', f.state.clock, f.request)).ledger.dailyStarts).toBe(1);
  });

  it('replaces expired challenges and permits a deliberate bike change after the short issuance guard', async () => {
    const f = fixture();
    const first = (await f.call('run/start', { bikeId: '125' })).body.challenge as replayModule.VerifiedRunChallenge;
    expect((await f.call('run/start', { bikeId: '450' })).body).toEqual({ error: 'reward_run_cooldown', retryAfterMs: 1_000 });
    f.state.clock += 1_001;
    const changed = await f.call('run/start', { bikeId: '450' });
    expect(changed.status).toBe(200);
    expect(changed.body.challenge).toMatchObject({ bikeId: '450', startedAt: now + 1_001 });
    f.state.clock = now + 1_801_002;
    const fresh = await f.call('run/start', { bikeId: '450' });
    expect(fresh.status).toBe(200);
    expect((fresh.body.challenge as replayModule.VerifiedRunChallenge).runId).not.toBe(first.runId);
    expect(fresh.body.challenge).not.toEqual(changed.body.challenge);
  });

  it('returns the precise remaining short cooldown and renews preparations too close to expiry', async () => {
    const f = fixture();
    const first = (await f.call('run/start', { bikeId: '125' })).body.challenge as replayModule.VerifiedRunChallenge;
    f.state.clock += 400;
    const limited = await f.call('run/start', { bikeId: '450' });
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: 'reward_run_cooldown', retryAfterMs: 600 });
    f.state.clock = now + 1_740_001;
    const renewed = await f.call('run/start', { bikeId: '125' });
    expect(renewed.status).toBe(200);
    expect((renewed.body.challenge as replayModule.VerifiedRunChallenge).runId).not.toBe(first.runId);
    expect(renewed.body.challenge).toMatchObject({ startedAt: f.state.clock, expiresAt: f.state.clock + 1_800_000 });
  });

  it('rejects fabricated scores, excess ticks, time travel, altered tokens and expired runs', async () => {
    const f = fixture(), { token } = await f.active();
    f.state.clock += 1000;
    expect((await f.call('run/finish', { token, proof: { ticks: 18001, events: [] } })).status).toBe(422);
    expect((await f.call('run/finish', { token, proof: { ticks: 600, events: [] } })).status).toBe(422);
    expect((await f.call('run/finish', { token, proof: { ticks: 60, events: [], score: 999999 } })).status).toBe(422);
    expect((await f.call('run/finish', { token, proof: { ticks: 60, events: [{ tick: 0, input: { type: 'skill', value: 999999 } }] } })).status).toBe(422);
    f.state.clock = now + 1_800_001;
    expect((await f.call('run/finish', { token, proof: { ticks: 0, events: [] } })).body.error).toBe('run_expired');
  });

  it('replays a real short run, credits its signed score exactly once', async () => {
    const f = fixture(), { token } = await f.active(); f.state.clock += 2000;
    // Shopify's JSON storage can reorder keys without changing the signed data.
    f.state.value = JSON.stringify(JSON.parse(f.state.value!), (_key, value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse()) : value);
    const proof = { ticks: 60, events: [{ tick: 60, input: { type: 'end' } }] };
    const finish = await f.call('run/finish', { token, proof });
    expect(finish.status).toBe(200);
    expect(finish.body).toMatchObject({ accepted: true, creditedPoints: 2, verifiedRuns: 1, verifiedPoints: 2 });
    const writes = f.state.writes;
    expect((await f.call('run/finish', { token, proof })).body.creditedPoints).toBe(2);
    expect(f.state.writes).toBe(writes);
  });

  it('CAS-settles concurrent verified finishes once, without clipping daily points', async () => {
    // Isolate ledger concurrency from physics, which has its own deterministic replay tests above/in verified-run.test.ts.
    vi.spyOn(replayModule, 'replayVerifiedRunDetailed').mockReturnValue({ score: 5000, ticks: 1800, crashed: true, jumps: 0, nearMisses: 0, policeEscapes: 0 });
    const f = fixture(), { token } = await f.active({ points: 12000, runs: 3, dailyPoints: 999800 }); f.state.clock += 31_000;
    const responses = await Promise.all([f.call('run/finish', { token, proof: { ticks: 1800, events: [] } }),
      f.call('run/finish', { token, proof: { ticks: 1800, events: [] } })]);
    expect(responses.every(response => response.status === 200)).toBe(true);
    const saved = await loadRewardLedger(config, '123', f.state.clock, f.request);
    expect(saved.ledger).toMatchObject({ points: 17000, runs: 4, dailyPoints: 1004800, active: null });
    expect(saved.ledger.consumed).toHaveLength(1);
    expect((await f.call('run/start', { bikeId: '125' })).status).toBe(200);
    f.state.clock += 86_400_000;
    expect((await f.call('status')).body).toMatchObject({ verifiedPoints: 17000, dailyPoints: 0, dailyCap: null });
  });

  it('never imports an untrusted ledger or treats invalid stored data as a fresh reward account', async () => {
    const f = fixture(); await f.seedLedger({ points: 49900, runs: 9 });
    const stored = JSON.parse(f.state.value!); stored.ledger.points = 999999; f.state.value = JSON.stringify(stored);
    expect((await f.call('claim')).body.error).toBe('invalid_reward_ledger');
    expect(f.state.creates).toBe(0);
  });

  it('requires the campaign target alone and issues exactly one customer-bound CHF5 reward with the persisted 30-day expiry', async () => {
    const f = fixture(); await f.seedLedger({ points: 999999, runs: 9 });
    expect((await f.call('claim')).body.error).toBe('reward_not_eligible');
    await f.seedLedger({ points: 1000000, runs: 1 });
    const claim = await f.call('claim');
    expect(claim.status).toBe(200);
    expect(claim.body.reward).toEqual({ code: f.state.discount!.codeDiscount.codes.nodes[0].code, expiresAt: new Date(now + 30 * 86_400_000).toISOString() });
    const firstCode = (claim.body.reward as { code: string }).code;
    f.state.clock += 31 * 86_400_000;
    expect((await f.call('claim')).body.reward).toEqual(claim.body.reward);
    expect(f.state.creates).toBe(1);
    expect(firstCode).toMatch(/^PFUSCH5-[A-F0-9]{24}$/);
  });

  it('omits recurringCycleLimit when creating a one-time shop reward and reuses the confirmed reservation', async () => {
    const f = fixture(); await f.seedLedger({ points: 1000000, runs: 1 });
    const claimed = await f.call('claim');
    expect(claimed.status).toBe(200);
    const createInputs = f.request.mock.calls.flatMap(([, options]) => {
      if (typeof options?.body !== 'string') return [];
      const { query, variables } = JSON.parse(options.body) as { query: string; variables: { discount: Record<string, unknown> } };
      return query.includes('mutation CreateGameRewardDiscount') ? [variables.discount] : [];
    });
    expect(createInputs).toHaveLength(1);
    expect(createInputs[0]).not.toHaveProperty('recurringCycleLimit');
    expect(createInputs[0]).toMatchObject({ usageLimit: 1, appliesOncePerCustomer: true,
      startsAt: '2026-10-07T12:00:00.000Z', endsAt: '2026-11-06T12:00:00.000Z',
      context: { customers: { add: ['gid://shopify/Customer/123'] } },
      customerGets: { value: { discountAmount: { amount: '5.00', appliesOnEachItem: false } }, items: { all: true } },
      minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: '50.00' } },
      combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false } });
    const confirmed = (await loadRewardLedger(config, '123', now, f.request)).ledger.reward;
    expect(confirmed).toMatchObject({ state: 'issued' });
    expect(claimed.body.reward).toMatchObject({ code: confirmed!.code, expiresAt: confirmed!.expiresAt });
    const writes = f.state.writes;
    expect((await f.call('claim')).body.reward).toEqual(claimed.body.reward);
    expect(f.state.creates).toBe(1);
    expect(f.state.writes).toBe(writes);
  });

  it.each([
    { name: 'allowlisted context rejection even when recovery lookup fails',
      userError: { code: 'INVALID', field: ['basicCodeDiscount', 'context', 'customers', 'add', '0'], message: 'Private buyer buyer@example.test was rejected' },
      expected: 'reward_discount_create_failed_invalid_context', failRecoveryLookup: true },
    { name: 'malformed upstream error code',
      userError: { code: 'INVALID buyer@example.test', field: ['basicCodeDiscount', 'context'], message: 'Private buyer buyer@example.test was rejected' },
      expected: 'reward_discount_create_failed_unknown', failRecoveryLookup: false },
    { name: 'unsafe upstream field path',
      userError: { code: 'INVALID', field: ['basicCodeDiscount', 'buyer@example.test'], message: 'Private buyer buyer@example.test was rejected' },
      expected: 'reward_discount_create_failed_invalid', failRecoveryLookup: false },
  ])('reports only a safe discount creation diagnostic for $name and preserves the reservation for retry', async ({ userError, expected, failRecoveryLookup }) => {
    const f = fixture(); await f.seedLedger({ points: 1000000, runs: 1 });
    f.state.creationUserErrors = [userError]; f.state.failRecoveryLookup = failRecoveryLookup;
    const rejected = await f.call('claim');
    expect(rejected).toEqual({ status: 503, body: { error: expected } });
    expect(JSON.stringify(rejected.body)).not.toContain('buyer@example.test');
    expect(f.state.discount).toBeNull();
    expect(f.state.discounts.size).toBe(0);
    const reserved = (await loadRewardLedger(config, '123', now, f.request)).ledger.reward;
    expect(reserved).toMatchObject({ state: 'reserved' });
    expect(reserved).not.toHaveProperty('discountId');
    expect((await f.call('status')).body).toMatchObject({ pending: true, reward: null });
    f.state.creationUserErrors = null; f.state.failRecoveryLookup = false;
    const retried = await f.call('claim');
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ pending: false, reward: { code: reserved!.code, expiresAt: reserved!.expiresAt } });
    expect((await loadRewardLedger(config, '123', now, f.request)).ledger.reward).toMatchObject({ ...reserved, state: 'issued' });
  });

  it('recovers ambiguous Shopify creation and ledger acknowledgement without minting another code', async () => {
    const f = fixture(); await f.seedLedger({ points: 1000000, runs: 1 });
    f.state.ambiguousCreate = true; f.state.failIssuedSave = true;
    expect((await f.call('claim')).status).toBe(503);
    const pending = await f.call('status');
    expect(pending.body).toMatchObject({ pending: true, reward: null, eligible: false });
    const original = JSON.parse(f.state.value!).ledger.reward;
    f.state.failIssuedSave = false; f.state.clock += 86_400_000;
    const retry = await f.call('claim');
    expect(retry.status).toBe(200);
    expect(retry.body.reward).toEqual({ code: original.code, expiresAt: original.expiresAt });
    expect(f.state.creates).toBe(1);
  });

  it('concurrent claims converge on one reservation and one redeemable code', async () => {
    const f = fixture(); await f.seedLedger({ points: 1000000, runs: 1 });
    const results = await Promise.all([f.call('claim'), f.call('claim')]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect(results[0].body.reward).toEqual(results[1].body.reward);
    const stored = await loadRewardLedger(config, '123', now, f.request);
    expect(stored.ledger.reward).toMatchObject({ state: 'issued', code: (results[0].body.reward as { code: string }).code });
    expect(f.state.creates).toBeLessThanOrEqual(2); // A duplicate create can race, but Shopify accepts the unique code only once.
  });

  it('retries CAS conflicts before reservation and validates restrictions on any existing code', async () => {
    const f = fixture(); await f.seedLedger({ points: 1000000, runs: 1 }); f.state.firstSaveConflict = true;
    expect((await f.call('claim')).status).toBe(200);
    expect(f.state.creates).toBe(1);
    const reservation = await reserveRewardDiscount(config, '123', now);
    const wrong = structuredClone(f.state.discount!); wrong.codeDiscount.usageLimit = 99;
    expect(() => verifyRewardDiscount(wrong, reservation, '123')).toThrow('reward_discount_mismatch');
    const wrongBuyer = structuredClone(f.state.discount!); wrongBuyer.codeDiscount.context.customers[0].id = 'gid://shopify/Customer/999';
    expect(() => verifyRewardDiscount(wrongBuyer, reservation, '123')).toThrow('reward_discount_mismatch');
  });
});
