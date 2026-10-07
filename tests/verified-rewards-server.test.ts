import { afterEach, describe, expect, it, vi } from 'vitest';
import * as replayModule from '../app/game/verifiedRun';
import { ApiError, createCsrf, type ShopifyConfig } from '../server/shopify/auth';
import { handleRewardRequest, signRunChallenge, type RewardAction } from '../server/shopify/rewardEndpoint';
import { emptyRewardLedger, loadRewardLedger, REWARD_KEY, saveRewardLedger, type RewardLedger, type RunChallenge } from '../server/shopify/rewardStore';
import { reserveRewardDiscount, verifyRewardDiscount } from '../server/shopify/rewardDiscount';
import { PLAYER_NAMESPACE } from '../server/shopify/playerStore';

const now = Date.UTC(2026, 9, 7, 12);
const config: ShopifyConfig = { shop: 'reward-test.myshopify.com', secret: 'test-only-reward-secret', adminToken: 'test-only-token' };
const identity = { shop: config.shop, customerId: '123' };
const json = (data: unknown) => Response.json({ data });
function discountNode(input: Record<string, unknown>) {
  const context = input.context as { customers: { add: string[] } };
  return { id: 'gid://shopify/DiscountCodeNode/345', codeDiscount: {
    __typename: 'DiscountCodeBasic', title: input.title, startsAt: input.startsAt, endsAt: input.endsAt,
    usageLimit: input.usageLimit, appliesOncePerCustomer: input.appliesOncePerCustomer,
    codes: { nodes: [{ code: input.code }] }, combinesWith: input.combinesWith,
    context: { __typename: 'DiscountCustomers', customers: context.customers.add.map(id => ({ id })) },
    customerGets: { value: { __typename: 'DiscountAmount', amount: { amount: '5.00', currencyCode: 'CHF' }, appliesOnEachItem: false },
      items: { __typename: 'AllDiscountItems', allItems: true } },
    minimumRequirement: { __typename: 'DiscountMinimumSubtotal', greaterThanOrEqualToSubtotal: { amount: '50.00', currencyCode: 'CHF' } },
  } };
}
function fixture() {
  const state = { value: null as string | null, digest: null as string | null, writes: 0,
    currency: 'CHF', scopes: ['write_customers', 'write_discounts'], discount: null as ReturnType<typeof discountNode> | null,
    creates: 0, ambiguousCreate: false, failIssuedSave: false, firstSaveConflict: false, clock: now };
  const request = vi.fn<typeof fetch>(async (_url, options) => {
    const { query, variables } = JSON.parse(String(options!.body)) as { query: string; variables: Record<string, unknown> };
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
    if (query.includes('query GameRewardDiscount')) return json({ codeDiscountNodeByCode: state.discount });
    if (query.includes('mutation CreateGameRewardDiscount')) {
      state.creates++;
      // The reservation must already be durable before any financial mutation.
      expect(JSON.parse(state.value!).ledger.reward.state).toBe('reserved');
      const input = variables.discount as Record<string, unknown>;
      expect(input).toMatchObject({ usageLimit: 1, appliesOncePerCustomer: true,
        context: { customers: { add: ['gid://shopify/Customer/123'] } },
        customerGets: { value: { discountAmount: { amount: '5.00', appliesOnEachItem: false } }, items: { all: true } },
        minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: '50.00' } },
        combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false } });
      if (state.discount) return json({ discountCodeBasicCreate: { codeDiscountNode: null, userErrors: [{ code: 'TAKEN' }] } });
      state.discount = discountNode(input);
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
    const ledger = { ...emptyRewardLedger(state.clock), ...changes };
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

  it('replays a real short run, consumes it once, and grants no qualifying run credit', async () => {
    const f = fixture(), { token } = await f.active(); f.state.clock += 2000;
    // Shopify's JSON storage can reorder keys without changing the signed data.
    f.state.value = JSON.stringify(JSON.parse(f.state.value!), (_key, value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse()) : value);
    const proof = { ticks: 60, events: [{ tick: 60, input: { type: 'end' } }] };
    const finish = await f.call('run/finish', { token, proof });
    expect(finish.status).toBe(200);
    expect(finish.body).toMatchObject({ accepted: true, creditedPoints: 0, verifiedRuns: 0, verifiedPoints: 0 });
    const writes = f.state.writes;
    expect((await f.call('run/finish', { token, proof })).body.creditedPoints).toBe(0);
    expect(f.state.writes).toBe(writes);
  });

  it('CAS-settles concurrent verified finishes once, clips the daily cap, and ignores claimed client points', async () => {
    // Isolate ledger concurrency from physics, which has its own deterministic replay tests above/in verified-run.test.ts.
    vi.spyOn(replayModule, 'replayVerifiedRun').mockReturnValue({ score: 5000, ticks: 1800, crashed: true });
    const f = fixture(), { token } = await f.active({ points: 12000, runs: 3, dailyPoints: 9800 }); f.state.clock += 31_000;
    const responses = await Promise.all([f.call('run/finish', { token, proof: { ticks: 1800, events: [] } }),
      f.call('run/finish', { token, proof: { ticks: 1800, events: [] } })]);
    expect(responses.every(response => response.status === 200)).toBe(true);
    const saved = await loadRewardLedger(config, '123', f.state.clock, f.request);
    expect(saved.ledger).toMatchObject({ points: 12200, runs: 4, dailyPoints: 10000, active: null });
    expect(saved.ledger.consumed).toHaveLength(1);
    expect((await f.call('run/start', { bikeId: '125' })).body.error).toBe('reward_daily_limit');
    f.state.clock += 86_400_000;
    expect((await f.call('status')).body).toMatchObject({ verifiedPoints: 12200, dailyPoints: 0 });
  });

  it('never imports an untrusted ledger or treats invalid stored data as a fresh reward account', async () => {
    const f = fixture(); await f.seedLedger({ points: 49900, runs: 9 });
    const stored = JSON.parse(f.state.value!); stored.ledger.points = 999999; f.state.value = JSON.stringify(stored);
    expect((await f.call('claim')).body.error).toBe('invalid_reward_ledger');
    expect(f.state.creates).toBe(0);
  });

  it('requires both thresholds and issues exactly one customer-bound CHF5 reward with the persisted 30-day expiry', async () => {
    const f = fixture(); await f.seedLedger({ points: 50000, runs: 9 });
    expect((await f.call('claim')).body.error).toBe('reward_not_eligible');
    await f.seedLedger({ points: 50000, runs: 10 });
    const claim = await f.call('claim');
    expect(claim.status).toBe(200);
    expect(claim.body.reward).toEqual({ code: f.state.discount!.codeDiscount.codes.nodes[0].code, expiresAt: new Date(now + 30 * 86_400_000).toISOString() });
    const firstCode = (claim.body.reward as { code: string }).code;
    f.state.clock += 31 * 86_400_000;
    expect((await f.call('claim')).body.reward).toEqual(claim.body.reward);
    expect(f.state.creates).toBe(1);
    expect(firstCode).toMatch(/^PFUSCH5-[A-F0-9]{24}$/);
  });

  it('recovers ambiguous Shopify creation and ledger acknowledgement without minting another code', async () => {
    const f = fixture(); await f.seedLedger({ points: 50000, runs: 10 });
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
    const f = fixture(); await f.seedLedger({ points: 50000, runs: 10 });
    const results = await Promise.all([f.call('claim'), f.call('claim')]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect(results[0].body.reward).toEqual(results[1].body.reward);
    const stored = await loadRewardLedger(config, '123', now, f.request);
    expect(stored.ledger.reward).toMatchObject({ state: 'issued', code: (results[0].body.reward as { code: string }).code });
    expect(f.state.creates).toBeLessThanOrEqual(2); // A duplicate create can race, but Shopify accepts the unique code only once.
  });

  it('retries CAS conflicts before reservation and validates restrictions on any existing code', async () => {
    const f = fixture(); await f.seedLedger({ points: 50000, runs: 10 }); f.state.firstSaveConflict = true;
    expect((await f.call('claim')).status).toBe(200);
    expect(f.state.creates).toBe(1);
    const reservation = await reserveRewardDiscount(config, '123', now);
    const wrong = structuredClone(f.state.discount!); wrong.codeDiscount.usageLimit = 99;
    expect(() => verifyRewardDiscount(wrong, reservation, '123')).toThrow('reward_discount_mismatch');
    const wrongBuyer = structuredClone(f.state.discount!); wrongBuyer.codeDiscount.context.customers[0].id = 'gid://shopify/Customer/999';
    expect(() => verifyRewardDiscount(wrongBuyer, reservation, '123')).toThrow('reward_discount_mismatch');
  });
});
