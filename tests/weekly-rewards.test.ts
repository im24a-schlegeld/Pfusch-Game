import { expect, it } from 'vitest';
import { handleRewardRequest } from '../server/shopify/rewardEndpoint';
import { type ShopifyConfig } from '../server/shopify/auth';
import { currentRewardOffer, INTRO_CAMPAIGN_END } from '../server/shopify/rewardCampaign';

const config: ShopifyConfig = { shop: 'weekly-test.myshopify.com', secret: 'weekly-test-secret', adminToken: 'test-token' };
it('describes the initial million-point campaign without starting its 48-hour timer on status or disabled preparation', async () => {
  const result = await handleRewardRequest('status', { method: 'GET', url: '/', readBody: async () => ({}) }, {
    config, enabled: false, now: () => Date.UTC(2026, 9, 14, 12),
    authenticate: async () => ({ shop: config.shop, customerId: '123' }), request: async () => { throw new Error('No upstream work expected'); },
  });
  expect(result.status).toBe(200);
  expect(result.body.campaign).toMatchObject({ metric: 'points', target: 1_000_000, rewardCHF: 5,
    offerEndsAt: '2026-10-26T00:00:00.000Z', phase: 'not_started', startedAt: null, expiresAt: null });
  expect(result.body.dailyCap).toBe(1_000_000);
});

it('randomizes at runtime on UTC Mondays, remains stable across workers, and scales bounded rewards and effort', async () => {
  const bases = { points: 1000000, jumps: 500, nearMisses: 1500, policeEscapes: 120 };
  const seen = new Set<string>();
  for (let week = 0; week < 32; week++) {
    const start = INTRO_CAMPAIGN_END + week * 7 * 86400000;
    const offer = await currentRewardOffer(config, start);
    expect(await currentRewardOffer({ ...config }, start + 6 * 86400000 + 86399999)).toEqual(offer);
    expect(offer.id).toBe(`week:${new Date(start).toISOString().slice(0, 10)}`);
    expect(offer.offerEndsAt).toBe(start + 7 * 86400000);
    expect(offer.rewardCHF).toBeGreaterThanOrEqual(3); expect(offer.rewardCHF).toBeLessThanOrEqual(7);
    expect(offer.target).toBe(Math.round(bases[offer.metric] * offer.rewardCHF / 5));
    seen.add(offer.metric);
  }
  expect(seen.size).toBe(4);
  expect((await currentRewardOffer(config, INTRO_CAMPAIGN_END - 1)).id).toBe('launch-million-2026');
});
