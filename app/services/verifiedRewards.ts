import { BIKES } from '../domain/config';
import type { VerifiedRunChallenge, VerifiedRunSubmission } from '../game/verifiedRun';

export interface RealRewardStatus {
  available: boolean;
  reason?: string;
  verifiedPoints: number;
  verifiedRuns: number;
  pointsRequired: number;
  runsRequired: number;
  dailyPoints: number;
  dailyCap: number;
  eligible: boolean;
  pending: boolean;
  reward: { code: string; expiresAt: string } | null;
}
export interface VerifiedRewardsService {
  status(): Promise<RealRewardStatus>;
  prepare(bikeId: string): Promise<void>;
  takeChallenge(bikeId: string): VerifiedRunChallenge | null;
  finish(submission: VerifiedRunSubmission): Promise<RealRewardStatus>;
  claim(): Promise<RealRewardStatus>;
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export class VerifiedRewardsError extends Error {
  constructor(readonly code: string, readonly status?: number) {
    super(code);
    this.name = 'VerifiedRewardsError';
  }
}

/** Valuable rewards are issued only by the same-origin authenticated server. */
export class OxygenVerifiedRewards implements VerifiedRewardsService {
  private csrfToken = '';
  private prepared: VerifiedRunChallenge | null = null;
  private preparing: { bikeId: string; task: Promise<void> } | null = null;
  private revision = 0;
  private settlement: Promise<RealRewardStatus> | null = null;
  private pendingSubmission: VerifiedRunSubmission | null = null;
  // Account verification and Shopify can each need an upstream round trip.
  // Preparation is background work and never delays starting a ride.
  constructor(private requestFetch: typeof fetch, private timeoutMs = 30000, private onUnauthorized?: () => void) {}

  private async request(path: string, payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new VerifiedRewardsError('network_error');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.requestFetch(`/api/rewards/${path}`, {
        method: payload ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
        ...(payload ? { body: JSON.stringify({ ...payload, csrfToken: this.csrfToken }) } : {}),
      });
      if (response.status === 401) {
        this.csrfToken = '';
        this.prepared = null;
        this.preparing = null;
        this.revision++;
        this.onUnauthorized?.();
      }
      if (!response.headers.get('content-type')?.includes('application/json'))
        throw new VerifiedRewardsError('rewards_unavailable', response.status);
      const raw = await response.text();
      if (raw.length > 32768) throw new VerifiedRewardsError('invalid_reward_response', response.status);
      let data: unknown;
      try { data = JSON.parse(raw); }
      catch { throw new VerifiedRewardsError('invalid_reward_response', response.status); }
      if (!isRecord(data) || !response.ok)
        throw new VerifiedRewardsError(isRecord(data) && typeof data.error === 'string' ? data.error : 'rewards_unavailable', response.status);
      if (typeof data.csrfToken === 'string' && data.csrfToken.length <= 2048) this.csrfToken = data.csrfToken;
      return data;
    } catch (error: unknown) {
      if (error instanceof VerifiedRewardsError) throw error;
      throw new VerifiedRewardsError(controller.signal.aborted ? 'request_timeout' : 'network_error');
    } finally { clearTimeout(timeout); }
  }
  private parseStatus(data: Record<string, unknown>): RealRewardStatus {
    const counters = ['verifiedPoints', 'verifiedRuns', 'pointsRequired', 'runsRequired', 'dailyPoints', 'dailyCap'] as const;
    if (typeof data.available !== 'boolean' || typeof data.eligible !== 'boolean' || typeof data.pending !== 'boolean'
      || counters.some(key => typeof data[key] !== 'number' || !Number.isFinite(data[key]) || (data[key] as number) < 0)
      || data.pointsRequired !== 50000 || data.runsRequired !== 10 || data.dailyCap !== 10000
      || data.reason !== undefined && typeof data.reason !== 'string'
      || data.reward !== null && (!isRecord(data.reward) || typeof data.reward.code !== 'string'
        || !/^[A-Z0-9-]{6,80}$/i.test(data.reward.code) || typeof data.reward.expiresAt !== 'string'
        || !Number.isFinite(Date.parse(data.reward.expiresAt)))) throw new VerifiedRewardsError('invalid_reward_response');
    return data as unknown as RealRewardStatus;
  }
  async status() {
    await this.settlement?.catch(() => {});
    const current = this.parseStatus(await this.request('status'));
    // Retry the same signed run after a transient network failure before
    // preparing another one. Refresh CSRF first: a paused ride can outlive it.
    // The server settles its run ID only once; failed retries retain the proof.
    if (this.pendingSubmission) return this.finish(this.pendingSubmission).catch(() => current);
    return current;
  }
  prepare(bikeId: string): Promise<void> {
    if (this.preparing?.bikeId === bikeId) return this.preparing.task;
    if (this.prepared?.bikeId === bikeId && this.prepared.expiresAt > Date.now() + 60000) return Promise.resolve();
    const revision = ++this.revision;
    this.prepared = null;
    const task = (async () => {
      try {
        await this.settlement?.catch(() => {});
        const status = await this.status();
        if (this.pendingSubmission || !status.available || status.reward || !this.csrfToken || revision !== this.revision) return;
        const data = await this.request('run/start', { bikeId });
        const challenge = data.challenge;
        if (!isRecord(challenge) || challenge.version !== 1 || challenge.bikeId !== bikeId
          || !BIKES.some(bike => bike.id === bikeId) || typeof challenge.runId !== 'string'
          || typeof challenge.token !== 'string' || challenge.token.length > 4096
          || !Number.isInteger(challenge.seed) || typeof challenge.seed !== 'number' || challenge.seed < 0 || challenge.seed > 0xffffffff
          || typeof challenge.startedAt !== 'number' || typeof challenge.expiresAt !== 'number'
          || !Number.isFinite(challenge.startedAt) || !Number.isFinite(challenge.expiresAt)
          || challenge.expiresAt <= Date.now()) return;
        if (revision === this.revision) this.prepared = challenge as unknown as VerifiedRunChallenge;
      } catch { /* Gameplay never waits for or depends on reward verification. */ }
      finally { if (revision === this.revision) this.preparing = null; }
    })();
    this.preparing = { bikeId, task };
    return task;
  }
  takeChallenge(bikeId: string) {
    const challenge = this.prepared;
    this.prepared = null;
    this.revision++;
    this.preparing = null;
    return challenge?.bikeId === bikeId && challenge.expiresAt > Date.now() + 1000 ? challenge : null;
  }
  finish(submission: VerifiedRunSubmission) {
    if (this.settlement) return this.settlement;
    this.pendingSubmission = submission;
    const task = this.request('run/finish', { token: submission.token, proof: submission.proof }).then(data => {
      const result = this.parseStatus(data);
      this.pendingSubmission = null;
      return result;
    }).catch((error: unknown) => {
      if (error instanceof Error && ['invalid_run_proof', 'invalid_run_token', 'run_not_active', 'run_expired'].includes(error.message))
        this.pendingSubmission = null;
      throw error;
    });
    this.settlement = task;
    void task.finally(() => { if (this.settlement === task) this.settlement = null; }).catch(() => {});
    return task;
  }
  async claim() {
    if (!this.csrfToken) await this.status();
    try { return this.parseStatus(await this.request('claim', {})); }
    catch (error: unknown) {
      if (!(error instanceof VerifiedRewardsError) || error.status !== 403 || error.code !== 'csrf') throw error;
      // A card can stay open beyond the token lifetime. Refresh once, then let
      // the server confirm the same reserved reward; never loop on a failure.
      await this.status();
      return this.parseStatus(await this.request('claim', {}));
    }
  }
}
