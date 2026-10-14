import type { RealRewardMetric, RealRewardOffer } from '../../app/services/verifiedRewards.js';
import type { ShopifyConfig } from './auth.js';
import { hmacSha256 } from './crypto.js';

export const REWARD_ATTEMPT_MS = 48 * 3_600_000;
export const INTRO_CAMPAIGN_END = Date.UTC(2026, 9, 26);
export interface RewardOffer { id: string; metric: RealRewardMetric; target: number; rewardCHF: number; offerEndsAt: number }
export interface RewardCampaign extends RewardOffer {
  progress: number; startedAt: number | null; expiresAt: number | null; completedAt: number | null; attempt: number;
}
const metrics = ['points', 'jumps', 'nearMisses', 'policeEscapes'] as const;
// Initial balancing estimates against 10,000 seconds of capped point effort.
const baseTargets: Record<RealRewardMetric, number> = { points: 1_000_000, jumps: 500, nearMisses: 1500, policeEscapes: 120 };

/** Runtime weekly randomizer shared by all customers, stable across workers/retries.
 * The secret HMAC makes future selections unavailable to public callers. */
export async function currentRewardOffer(config: ShopifyConfig, now: number): Promise<RewardOffer> {
  if (now < INTRO_CAMPAIGN_END) return { id: 'launch-million-2026', metric: 'points', target: 1_000_000, rewardCHF: 5, offerEndsAt: INTRO_CAMPAIGN_END };
  const date = new Date(now); date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  const week = date.toISOString().slice(0, 10);
  const random = await hmacSha256(`pfusch-weekly-challenge-v1\n${config.shop}\n${week}`, config.secret);
  const metric = metrics[Number.parseInt(random.slice(0, 2), 16) % metrics.length];
  const rewardCHF = 3 + Number.parseInt(random.slice(2, 4), 16) % 5;
  return { id: `week:${week}`, metric, target: Math.round(baseTargets[metric] * rewardCHF / 5), rewardCHF,
    offerEndsAt: date.getTime() + 7 * 86_400_000 };
}
export const freshRewardCampaign = (offer: RewardOffer): RewardCampaign => ({ ...offer,
  progress: 0, startedAt: null, expiresAt: null, completedAt: null, attempt: 0 });
export const publicRewardOffer = (offer: RewardOffer): RealRewardOffer => ({ id: offer.id, metric: offer.metric, target: offer.target, rewardCHF: offer.rewardCHF, minimumSubtotalCHF: 50,
  offerEndsAt: new Date(offer.offerEndsAt).toISOString() });

export function validRewardCampaign(value: unknown): value is RewardCampaign {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>, integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  return Object.keys(v).length === 10 && typeof v.id === 'string' && /^(launch-million-2026|week:\d{4}-\d{2}-\d{2})$/.test(v.id) &&
    metrics.includes(v.metric as RealRewardMetric) && integer(v.target) && v.target > 0 && v.target <= 1_400_000 &&
    integer(v.rewardCHF) && v.rewardCHF >= 3 && v.rewardCHF <= 7 && integer(v.offerEndsAt) &&
    integer(v.progress) && v.progress <= v.target && integer(v.attempt) &&
    ((v.startedAt === null && v.expiresAt === null && v.completedAt === null && v.progress === 0 && v.attempt === 0) ||
      (integer(v.startedAt) && integer(v.expiresAt) && v.expiresAt - v.startedAt === REWARD_ATTEMPT_MS &&
        v.attempt > 0 && (v.completedAt === null && v.progress < v.target || integer(v.completedAt) && v.progress === v.target && v.completedAt >= v.startedAt && v.completedAt <= v.expiresAt)));
}
