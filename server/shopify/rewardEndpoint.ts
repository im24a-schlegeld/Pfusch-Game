import { BIKES } from '../../app/domain/config.js';
import { MAX_VERIFIED_TICKS, replayVerifiedRunDetailed } from '../../app/game/verifiedRun.js';
import { ApiError, assertCustomerIdentity, authenticateProxy, createCsrf, verifyCsrf, type CustomerAuthenticator, type CustomerIdentity, type ShopifyConfig } from './auth.js';
import { hmacSha256, randomHex, verifyHmacHex } from './crypto.js';
import { isRecord } from './playerValidation.js';
import type { JsonResult, PlayerRequest } from './playerEndpoint.js';
import type { ShopifyFetch } from './playerStore.js';
import { issueRewardDiscount, reserveRewardDiscount } from './rewardDiscount.js';
import { DAILY_VERIFIED_CAP, emptyRewardLedger, loadRewardLedger, saveRewardLedger,
  VERIFIED_POINTS_REQUIRED, VERIFIED_RUNS_REQUIRED, type RewardLedger, type RunChallenge } from './rewardStore.js';
import { currentRewardOffer, freshRewardCampaign, publicRewardOffer, REWARD_ATTEMPT_MS, type RewardOffer } from './rewardCampaign.js';

export type RewardAction = 'status' | 'run/start' | 'run/finish' | 'claim';
/** Full-precision touch input proofs can exceed the smaller player-save body limit. */
export const MAX_REWARD_FINISH_BODY_BYTES = 262144;
export interface RewardEndpointDependencies {
  config: ShopifyConfig | null;
  enabled: boolean;
  request: ShopifyFetch;
  now?: () => number;
  authenticate?: CustomerAuthenticator;
}
const encode = (text: string) => btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const tokenMessage = (value: string) => `pfusch-verified-run-v1\n${value}`;
const sameChallenge = (left: RunChallenge | null, right: RunChallenge) => !!left &&
  left.version === right.version && left.runId === right.runId && left.bikeId === right.bikeId && left.seed === right.seed &&
  left.startedAt === right.startedAt && left.expiresAt === right.expiresAt;
export async function signRunChallenge(challenge: RunChallenge, identity: CustomerIdentity, secret: string) {
  const payload = encode(JSON.stringify({ ...challenge, shop: identity.shop, customerId: identity.customerId }));
  return `${payload}.${await hmacSha256(tokenMessage(payload), secret)}`;
}
async function verifyRunChallenge(token: unknown, identity: CustomerIdentity, secret: string, now: number): Promise<RunChallenge> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,1200}\.[a-f0-9]{64}$/.test(token)) throw new ApiError(422, 'invalid_run_token');
  const [payload, signature] = token.split('.');
  if (!await verifyHmacHex(signature, tokenMessage(payload), secret)) throw new ApiError(422, 'invalid_run_token');
  let value: unknown;
  try { value = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))); } catch { throw new ApiError(422, 'invalid_run_token'); }
  if (!isRecord(value) || Object.keys(value).length !== 8 || value.version !== 1 || value.shop !== identity.shop || value.customerId !== identity.customerId ||
    typeof value.runId !== 'string' || !/^[a-f0-9]{32}$/.test(value.runId) || typeof value.seed !== 'number' || !Number.isInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff ||
    typeof value.bikeId !== 'string' || !BIKES.some(bike => bike.id === value.bikeId) ||
    typeof value.startedAt !== 'number' || !Number.isSafeInteger(value.startedAt) || value.startedAt > now ||
    typeof value.expiresAt !== 'number' || value.expiresAt - value.startedAt !== 1_800_000) throw new ApiError(422, 'invalid_run_token');
  if (now > value.expiresAt) throw new ApiError(409, 'run_expired');
  return { version: 1, runId: value.runId, seed: value.seed, bikeId: value.bikeId, startedAt: value.startedAt, expiresAt: value.expiresAt };
}
function normalizeCampaign(ledger: RewardLedger, offer: RewardOffer, now: number): RewardLedger {
  const current = ledger.campaign;
  const grace = current !== null && current.startedAt !== null && current.expiresAt !== null && current.completedAt === null && now <= current.expiresAt;
  if (current && (current.id === offer.id || grace)) return ledger;
  const history = [...ledger.rewardHistory];
  if (ledger.reward && !history.some(reward => reward.code === ledger.reward!.code)) history.push(ledger.reward);
  // A prepared run is independent of the offer: its proof starts/credits the
  // campaign selected at acceptance, including across the Monday boundary.
  return { ...ledger, campaign: freshRewardCampaign(offer), reward: null, rewardHistory: history.slice(-8) };
}
function status(ledger: RewardLedger, offer: RewardOffer, now: number, unavailableReason?: string) {
  const campaign = ledger.campaign!;
  const issued = [ledger.reward, ...ledger.rewardHistory.slice().reverse()].find(reward => reward?.state === 'issued');
  const phase = ledger.reward?.state === 'issued' ? 'claimed' : campaign.completedAt !== null ? 'completed'
    : campaign.startedAt === null ? 'not_started' : now > campaign.expiresAt! ? 'expired' : 'active';
  return { available: !unavailableReason, ...(unavailableReason ? { reason: unavailableReason } : {}),
    verifiedPoints: ledger.points, verifiedRuns: ledger.runs, pointsRequired: VERIFIED_POINTS_REQUIRED, runsRequired: VERIFIED_RUNS_REQUIRED,
    dailyPoints: ledger.dailyPoints, dailyCap: DAILY_VERIFIED_CAP,
    eligible: !unavailableReason && campaign.completedAt !== null && !ledger.reward,
    reward: issued ? { code: issued.code, expiresAt: issued.expiresAt } : null,
    pending: [ledger.reward, ...ledger.rewardHistory].some(reward => reward?.state === 'reserved'),
    campaign: { ...publicRewardOffer(campaign), progress: campaign.progress, attempt: campaign.attempt, phase,
      startedAt: campaign.startedAt === null ? null : new Date(campaign.startedAt).toISOString(),
      expiresAt: campaign.expiresAt === null ? null : new Date(campaign.expiresAt).toISOString(),
      completedAt: campaign.completedAt === null ? null : new Date(campaign.completedAt).toISOString() },
    nextCampaign: campaign.id === offer.id ? null : publicRewardOffer(offer),
    rewards: [ledger.reward, ...ledger.rewardHistory].filter(reward => reward?.state === 'issued' && Date.parse(reward.expiresAt) > now)
      .map(reward => ({ code: reward!.code, expiresAt: reward!.expiresAt, amountCHF: reward!.amountCHF ?? 5, campaignId: reward!.campaignId ?? 'legacy' })),
  };
}
function requestBody(value: unknown, fields: string[]): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))) throw new ApiError(400, 'invalid_request');
  return value;
}

/** All financial authority comes from a signed server challenge, replay, and a separate CAS ledger. */
export async function handleRewardRequest(action: RewardAction, input: PlayerRequest, dependencies: RewardEndpointDependencies): Promise<JsonResult> {
  try {
    if (input.method !== (action === 'status' ? 'GET' : 'POST')) throw new ApiError(405, 'method_not_allowed');
    const config = dependencies.config;
    if (!config) throw new ApiError(503, 'not_configured');
    const now = (dependencies.now ?? Date.now)();
    const identity = assertCustomerIdentity(await (dependencies.authenticate ?? authenticateProxy)(input.url, config, now), config);
    let body: Record<string, unknown> = {};
    if (input.method === 'POST') {
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(input.contentType ?? '')) throw new ApiError(415, 'json_required');
      body = requestBody(await input.readBody(), action === 'run/start' ? ['csrfToken', 'bikeId'] : action === 'run/finish' ? ['csrfToken', 'token', 'proof'] : ['csrfToken']);
      await verifyCsrf(body.csrfToken, identity, config.secret, now);
    }
    const csrfToken = await createCsrf(identity, config.secret, now);
    const offer = await currentRewardOffer(config, now);
    if (!dependencies.enabled) return { status: action === 'status' ? 200 : 503,
      body: { ...status(normalizeCampaign(emptyRewardLedger(now), offer, now), offer, now, 'rewards_disabled'), csrfToken, ...(action === 'status' ? {} : { error: 'rewards_disabled' }) } };
    const load = async () => {
      const value = await loadRewardLedger(config, identity.customerId, now, dependencies.request);
      return { ...value, ledger: normalizeCampaign(value.ledger, offer, now) };
    };
    let saved = await load();
    if (saved.unavailableReason) return { status: action === 'status' ? 200 : 503,
      body: { ...status(saved.ledger, offer, now, saved.unavailableReason), csrfToken,
        ...(action === 'status' && saved.unavailableReason.endsWith('_scope_missing')
          ? { diagnostics: { adminClientId: config.clientId ?? null } } : {}),
        ...(action === 'status' ? {} : { error: saved.unavailableReason }) } };
    if (action === 'status') return { status: 200, body: { ...status(saved.ledger, offer, now), csrfToken } };

    // Retry only compare-and-set conflicts. Every mutation is recomputed from the newer ledger.
    const persist = async (update: (ledger: RewardLedger) => RewardLedger | Promise<RewardLedger>): Promise<RewardLedger> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (saved.unavailableReason) throw new ApiError(503, saved.unavailableReason);
        const next = await update(saved.ledger);
        if (next === saved.ledger) return next;
        try {
          const compareDigest = await saveRewardLedger(config, identity.customerId, next, saved.compareDigest, dependencies.request);
          saved = { ledger: next, compareDigest };
          return next;
        } catch (error) {
          if (!(error instanceof ApiError) || error.code !== 'reward_conflict' || attempt === 2) throw error;
          saved = await load();
        }
      }
      throw new ApiError(409, 'reward_conflict');
    };
    if (action === 'run/start') {
      if (typeof body.bikeId !== 'string' || !BIKES.some(bike => bike.id === body.bikeId)) throw new ApiError(400, 'invalid_bike');
      const challenge: RunChallenge = { version: 1, runId: randomHex(16), seed: Number.parseInt(randomHex(4), 16),
        bikeId: body.bikeId, startedAt: now, expiresAt: now + 1_800_000 };
      await persist(ledger => {
        if (ledger.campaign?.completedAt !== null) throw new ApiError(409, 'reward_already_reserved');
        if (ledger.dailyStarts >= 40 || (ledger.lastStartAt && now - ledger.lastStartAt < 30_000)) throw new ApiError(429, 'reward_run_limit');
        if (ledger.dailyPoints >= DAILY_VERIFIED_CAP) throw new ApiError(429, 'reward_daily_limit');
        return { ...ledger, active: challenge, dailyStarts: ledger.dailyStarts + 1, lastStartAt: now };
      });
      return { status: 200, body: { challenge: { ...challenge, token: await signRunChallenge(challenge, identity, config.secret) }, csrfToken } };
    }
    if (action === 'run/finish') {
      const challenge = await verifyRunChallenge(body.token, identity, config.secret, now);
      const previous = saved.ledger.consumed.find(entry => entry.runId === challenge.runId);
      if (previous) return { status: 200, body: { ...status(saved.ledger, offer, now), csrfToken, accepted: true, creditedPoints: previous.points } };
      if (!sameChallenge(saved.ledger.active, challenge)) throw new ApiError(409, 'run_not_active');
      // Cheap bounds/wall-clock checks before replay prevent attacker-controlled CPU work.
      if (!isRecord(body.proof) || typeof body.proof.ticks !== 'number' || !Number.isInteger(body.proof.ticks) || body.proof.ticks < 0 || body.proof.ticks > MAX_VERIFIED_TICKS ||
        body.proof.ticks / 60 > (now - challenge.startedAt) / 1000 + 1.5) throw new ApiError(422, 'invalid_run_proof');
      const replay = replayVerifiedRunDetailed(challenge.bikeId, challenge.seed, body.proof);
      if (!replay || (!replay.crashed && replay.ticks !== MAX_VERIFIED_TICKS)) throw new ApiError(422, 'invalid_run_proof');
      const validRun = replay.ticks >= 1200 && replay.score >= 100;
      let creditedPoints = 0;
      const ledger = await persist(async current => {
        const consumed = current.consumed.find(entry => entry.runId === challenge.runId);
        if (consumed) { creditedPoints = consumed.points; return current; }
        if (!sameChallenge(current.active, challenge)) throw new ApiError(409, 'run_not_active');
        creditedPoints = validRun ? Math.max(0, Math.min(Math.floor(replay.score), Math.floor(replay.ticks / 60 * 100), DAILY_VERIFIED_CAP - current.dailyPoints)) : 0;
        let campaign = current.campaign!, reward = current.reward;
        if (validRun && campaign.completedAt === null) {
          if (campaign.startedAt === null || now > campaign.expiresAt!) {
            campaign = { ...freshRewardCampaign(campaign), attempt: campaign.attempt + 1, startedAt: now, expiresAt: now + REWARD_ATTEMPT_MS };
          }
          const gain = campaign.metric === 'points' ? creditedPoints : replay[campaign.metric];
          campaign = { ...campaign, progress: Math.min(campaign.target, campaign.progress + gain) };
          if (campaign.progress >= campaign.target) {
            campaign = { ...campaign, completedAt: now };
            reward = await reserveRewardDiscount(config, identity.customerId, now, campaign);
          }
        }
        return { ...current, campaign, reward, active: null, points: current.points + creditedPoints, runs: current.runs + (validRun && creditedPoints > 0 ? 1 : 0),
          dailyPoints: current.dailyPoints + creditedPoints,
          consumed: [...current.consumed.slice(-99), { runId: challenge.runId, points: creditedPoints }] };
      });
      return { status: 200, body: { ...status(ledger, offer, now), csrfToken, accepted: true, creditedPoints } };
    }
    const reserved = await persist(async ledger => {
      if (ledger.reward || ledger.rewardHistory.some(reward => reward.state === 'reserved')) return ledger;
      if (ledger.campaign?.completedAt === null) {
        if (ledger.rewardHistory.some(reward => reward.state === 'issued')) return ledger;
        throw new ApiError(403, 'reward_not_eligible');
      }
      return { ...ledger, active: null, reward: await reserveRewardDiscount(config, identity.customerId, now, ledger.campaign!) };
    });
    const reservation = reserved.reward?.state === 'reserved' ? reserved.reward
      : reserved.rewardHistory.slice().reverse().find(reward => reward.state === 'reserved') ?? reserved.reward;
    if (!reservation || reservation.state === 'issued') return { status: 200, body: { ...status(reserved, offer, now), csrfToken } };
    // A reserved code is never replaced or extended, even if delivery is retried after 30 days.
    const discountId = await issueRewardDiscount(config, identity.customerId, reservation, dependencies.request);
    const issued = await persist(ledger => {
      if (ledger.reward?.code === reservation.code)
        return ledger.reward.state === 'issued' ? ledger : { ...ledger, reward: { ...ledger.reward, state: 'issued', discountId } };
      if (!ledger.rewardHistory.some(reward => reward.code === reservation.code)) throw new ApiError(409, 'reward_conflict');
      return { ...ledger, rewardHistory: ledger.rewardHistory.map(reward => reward.code === reservation.code ? { ...reward, state: 'issued', discountId } : reward) };
    });
    return { status: 200, body: { ...status(issued, offer, now), csrfToken } };
  } catch (error) {
    return error instanceof ApiError ? { status: error.status, body: { error: error.code } }
      : { status: 503, body: { error: 'service_unavailable' } };
  }
}
