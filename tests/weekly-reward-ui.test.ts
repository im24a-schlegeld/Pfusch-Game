import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { WeeklyRewardProgress, RewardCodeHistory } from '../app/ui/RealRewardCard';
import type { RealRewardStatus, RealRewardCampaign } from '../app/services/verifiedRewards';

vi.mock('../app/ui/shared', () => ({ fmt: (value: number) => value.toLocaleString('de-CH') }));
const now = Date.parse('2026-10-26T12:00:00Z');
const campaign: RealRewardCampaign = { id: 'intro', metric: 'points', target: 1000000, progress: 250000,
  rewardCHF: 5, minimumSubtotalCHF: 50, offerEndsAt: '2026-10-26T00:00:00Z',
  startedAt: '2026-10-25T18:00:00Z', expiresAt: '2026-10-27T18:00:00Z', completedAt: null, attempt: 1, phase: 'active' };
const status = (value: RealRewardCampaign): RealRewardStatus => ({ available: true, verifiedPoints: 0, verifiedRuns: 0,
  pointsRequired: 0, runsRequired: 0, dailyPoints: 0, dailyCap: 10000, eligible: false, pending: false, reward: null, campaign: value });
const render = (value: RealRewardStatus, time = now) => renderToStaticMarkup(createElement(WeeklyRewardProgress,
  { status: value, now: time, busy: false, onClaim() {} })).replaceAll('&#x27;', "'");

it.each([
  ['points', 1000000, 5, 'Punkte'], ['jumps', 700, 7, 'Sprünge'],
  ['nearMisses', 900, 3, 'knappe Manöver'], ['policeEscapes', 120, 5, 'Polizei-Fluchten'],
] as const)('displays the real single %s target and discount without the legacy run requirement', (metric, target, amount, label) => {
  const html = render(status({ ...campaign, metric, target, progress: 0, rewardCHF: amount }));
  expect(html).toContain(label); expect(html).toContain(`CHF ${amount}`);
  expect(html).toContain(target.toLocaleString('de-CH'));
  expect(html).not.toContain('mindestens 10'); expect(html).not.toContain('50’000');
  expect(html).toContain('disabled=""');
});

it('keeps the full active deadline across Monday and shows the server-provided next offer separately', () => {
  const html = render({ ...status(campaign), nextCampaign: { id: 'week-2', metric: 'jumps', target: 700,
    rewardCHF: 7, minimumSubtotalCHF: 50, offerEndsAt: '2026-11-02T00:00:00Z' } });
  expect(html).toContain('Noch 30 Std. 0 Min.');
  expect(html).toContain('2026-10-27T18:00:00Z'); expect(html).toContain('UTC');
  expect(html).toContain(`${(250000).toLocaleString('de-CH')} / ${(1000000).toLocaleString('de-CH')}`);
  expect(html).toContain('CHF 7'); expect(html).toContain('700 Sprünge');
});

it('starts no client deadline for an unstarted offer and explains retry after expiration', () => {
  const unstarted = render(status({ ...campaign, phase: 'not_started', startedAt: null, expiresAt: null, progress: 0 }),
    Date.parse('2026-10-20T12:00:00Z'));
  expect(unstarted).toContain('erste gültige Fahrt bestätigt'); expect(unstarted).toContain('48 Stunden');
  expect(unstarted).not.toContain('Noch 48 Std.');
  const expired = render(status({ ...campaign, phase: 'expired', expiresAt: '2026-10-26T11:00:00Z', offerEndsAt: '2026-11-02T00:00:00Z' }));
  expect(expired).toContain('neuen Versuch bei null'); expect(expired).toContain('disabled=""');
});

it('keeps coupon eligibility server-owned even when displayed progress reaches the target', () => {
  expect(render(status({ ...campaign, progress: campaign.target }))).toContain('disabled=""');
  const complete = render({ ...status({ ...campaign, phase: 'completed', completedAt: '2026-10-26T10:00:00Z' }), eligible: true });
  expect(complete).toContain('CODE ABHOLEN'); expect(complete).not.toContain('disabled=""');
});

it('permits confirming a durable server reservation even after its completed attempt deadline', () => {
  const html = render({ ...status({ ...campaign, phase: 'completed', progress: campaign.target,
    completedAt: '2026-10-25T23:00:00Z', expiresAt: '2026-10-26T10:00:00Z' }), eligible: false, pending: true });
  expect(html).toContain('CODE BESTÄTIGEN'); expect(html).not.toContain('disabled=""');
  expect(html).not.toContain('neuen Versuch bei null');
});

it('shows earlier legitimate server coupons while excluding expired codes', () => {
  const html = renderToStaticMarkup(createElement(RewardCodeHistory, { now, onCopy() {}, rewards: [
    { code: 'PFUSCH-OLD5', expiresAt: '2026-11-01T00:00:00Z', amountCHF: 5, campaignId: 'legacy' },
    { code: 'PFUSCH-NEW7', expiresAt: '2026-11-15T00:00:00Z', amountCHF: 7, campaignId: 'week-1' },
    { code: 'PFUSCH-EXPIRED', expiresAt: '2026-10-01T00:00:00Z', amountCHF: 5, campaignId: 'past' },
  ] }));
  expect(html).toContain('PFUSCH-OLD5'); expect(html).toContain('PFUSCH-NEW7'); expect(html).toContain('CHF 7');
  expect(html).not.toContain('PFUSCH-EXPIRED'); expect(html).not.toContain('disabled=""');
});
