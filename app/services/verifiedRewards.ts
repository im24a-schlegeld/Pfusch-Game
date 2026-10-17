import { BIKES } from '../domain/config';
import type { VerifiedRunChallenge, VerifiedRunSubmission } from '../game/verifiedRun';

export type RealRewardMetric = 'points' | 'jumps' | 'nearMisses' | 'policeEscapes';
export interface RealRewardOffer {
  id: string;
  metric: RealRewardMetric;
  target: number;
  rewardCHF: number;
  minimumSubtotalCHF: 50;
  offerEndsAt: string;
}
export interface RealRewardCampaign extends RealRewardOffer {
  progress: number;
  startedAt: string | null;
  expiresAt: string | null;
  completedAt: string | null;
  attempt: number;
  phase: 'not_started' | 'active' | 'expired' | 'completed' | 'claimed';
}
export interface RealRewardCoupon { code: string; expiresAt: string; amountCHF: number; campaignId: string }
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
  /** Absent only for the earlier reward API; current eligibility comes from the server campaign. */
  campaign?: RealRewardCampaign;
  nextCampaign?: RealRewardOffer | null;
  rewards?: RealRewardCoupon[];
}
export interface VerifiedRewardsService {
  readonly preparationIssue?: VerifiedRewardsError | null;
  status(): Promise<RealRewardStatus>;
  prepare(bikeId: string): Promise<void>;
  takeChallenge(bikeId: string): VerifiedRunChallenge | null;
  finish(submission: VerifiedRunSubmission): Promise<RealRewardStatus>;
  retryPending?(): Promise<RealRewardStatus | null>;
  resetSession?(): void;
  claim(): Promise<RealRewardStatus>;
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const boundedInteger = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
const validDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
function validOffer(value: unknown): value is RealRewardOffer {
  return isRecord(value) && typeof value.id === 'string' && /^(launch-million-2026|week:\d{4}-\d{2}-\d{2})$/.test(value.id)
    && ['points', 'jumps', 'nearMisses', 'policeEscapes'].includes(String(value.metric))
    && boundedInteger(value.target, 1_400_000) && value.target > 0
    && boundedInteger(value.rewardCHF, 7) && value.rewardCHF >= 3 && value.minimumSubtotalCHF === 50 && validDate(value.offerEndsAt);
}
function validCampaign(value: unknown): value is RealRewardCampaign {
  if (!isRecord(value) || !validOffer(value) || !boundedInteger(value.progress, value.target) || !boundedInteger(value.attempt)
    || !['not_started', 'active', 'expired', 'completed', 'claimed'].includes(String(value.phase))) return false;
  if (value.startedAt === null) return value.expiresAt === null && value.completedAt === null && value.progress === 0 && value.attempt === 0 && value.phase === 'not_started';
  return validDate(value.startedAt) && validDate(value.expiresAt) && Date.parse(value.expiresAt) - Date.parse(value.startedAt) === 48 * 3_600_000
    && value.attempt > 0 && (value.completedAt === null ? ['active', 'expired'].includes(String(value.phase))
      : validDate(value.completedAt) && Date.parse(value.completedAt) >= Date.parse(value.startedAt)
        && Date.parse(value.completedAt) <= Date.parse(value.expiresAt) && value.progress === value.target && ['completed', 'claimed'].includes(String(value.phase)));
}

export class VerifiedRewardsError extends Error {
  constructor(readonly code: string, readonly status?: number, readonly retryAfterMs?: number) {
    super(code);
    this.name = 'VerifiedRewardsError';
  }
}

export function rewardRunNotice(error: unknown, phase: 'start' | 'finish'): { message: string; transient: boolean } {
  const issue = error instanceof VerifiedRewardsError ? error : null;
  const suffix = phase === 'start' ? 'Diese Fahrt zählt nur im Spiel.' : 'Die Shop-Prüfung wird bei Verbindung wiederholt.';
  if (issue?.code === 'network_error') return { message: 'Du spielst offline. Dein Spielstand wird synchronisiert, sobald du wieder Internet hast.', transient: true };
  if (issue?.code === 'request_timeout') return { message: `Shop antwortet zu langsam. ${suffix}`, transient: true };
  if (issue?.code === 'reward_daily_limit') return { message: 'Das Tageslimit für Rabattpunkte ist erreicht. Morgen geht es weiter; Punkte und Coins sammelst du weiter.', transient: true };
  if (issue?.code === 'reward_run_limit') return { message: 'Das heutige Startlimit für Shop-Fahrten ist erreicht. Punkte und Coins sammelst du weiter.', transient: true };
  if (issue?.code === 'reward_run_cooldown') return { message: 'Die nächste Shop-Fahrt ist gleich bereit. Bitte kurz warten.', transient: true };
  if (issue?.status === 429) return { message: `Shop ist ausgelastet. ${suffix}`, transient: true };
  if (issue?.status === 408 || issue?.status && issue.status >= 500) return { message: `Shop vorübergehend nicht erreichbar. ${suffix}`, transient: true };
  if (issue?.status === 401) return { message: 'Shop-Anmeldung ist abgelaufen. Bitte erneut anmelden; dein Spielstand bleibt gesichert.', transient: false };
  if (issue?.code === 'reward_completed') return { message: 'Shop-Aufgabe bereits abgeschlossen. Deine Fahrt zählt weiter im Spiel.', transient: true };
  if (issue?.code === 'rewards_disabled' || issue?.code === 'not_configured') return { message: 'Shop-Belohnungen sind derzeit nicht verfügbar. Deine Fahrt zählt im Spiel.', transient: true };
  if (issue?.code === 'pending_verification') return { message: 'Vorherige Shop-Fahrt wird noch geprüft. Diese Fahrt zählt im Spiel.', transient: true };
  if (issue?.code === 'csrf') return { message: 'Shop-Anfrage konnte nicht bestätigt werden. Prüfe den Status unter Belohnungen.', transient: false };
  if (issue?.code === 'invalid_reward_response') return { message: 'Shop hat ungültig geantwortet. Status unter Belohnungen prüfen.', transient: false };
  return { message: phase === 'start' ? `Shop-Nachweis nicht bestätigt (${issue?.code ?? 'unbekannt'}). Status unter Belohnungen prüfen.`
    : `Shop-Gutschrift nicht bestätigt (${issue?.code ?? 'unbekannt'}). Status unter Belohnungen prüfen.`, transient: false };
}

/** Valuable rewards are issued only by the same-origin authenticated server. */
export class OxygenVerifiedRewards implements VerifiedRewardsService {
  preparationIssue: VerifiedRewardsError | null = null;
  private csrfToken = '';
  private prepared: VerifiedRunChallenge | null = null;
  private preparing: { bikeId: string; task: Promise<void> } | null = null;
  private revision = 0;
  private accountEpoch = 0;
  private settlement: Promise<RealRewardStatus> | null = null;
  private pendingSubmission: VerifiedRunSubmission | null = null;
  // Account verification and Shopify can each need an upstream round trip.
  // Preparation is background work and never delays starting a ride.
  constructor(private requestFetch: typeof fetch, private timeoutMs = 30000, private onUnauthorized?: () => void) {}

  resetSession() {
    this.csrfToken = '';
    this.prepared = null;
    this.preparing = null;
    this.pendingSubmission = null;
    this.preparationIssue = null;
    this.revision++;
    this.accountEpoch++;
  }

  private async request(path: string, payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const epoch = this.accountEpoch;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new VerifiedRewardsError('network_error');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.requestFetch(`/api/rewards/${path}`, {
        method: payload ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
        ...(payload ? { body: JSON.stringify({ ...payload, csrfToken: this.csrfToken }) } : {}),
      });
      if (epoch !== this.accountEpoch) throw new VerifiedRewardsError('login_required', 401);
      if (response.status === 401) {
        this.resetSession();
        this.preparationIssue = new VerifiedRewardsError('login_required', 401);
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
        throw new VerifiedRewardsError(isRecord(data) && typeof data.error === 'string' ? data.error : 'rewards_unavailable', response.status,
          isRecord(data) && typeof data.retryAfterMs === 'number' && Number.isInteger(data.retryAfterMs)
            && data.retryAfterMs > 0 && data.retryAfterMs <= 1000 ? data.retryAfterMs : undefined);
      if (epoch !== this.accountEpoch) throw new VerifiedRewardsError('login_required', 401);
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
      || counters.some(key => !boundedInteger(data[key]))
      || (data.campaign === undefined ? data.pointsRequired !== 50000 || data.runsRequired !== 10 || data.dailyCap !== 10000
        : data.pointsRequired !== 1000000 || data.runsRequired !== 0 || data.dailyCap !== 1000000 || !validCampaign(data.campaign)
          || data.nextCampaign !== null && !validOffer(data.nextCampaign)
          || !Array.isArray(data.rewards) || data.rewards.length > 9 || !data.rewards.every(reward => isRecord(reward)
            && typeof reward.code === 'string' && /^[A-Z0-9-]{6,80}$/i.test(reward.code) && validDate(reward.expiresAt)
            && boundedInteger(reward.amountCHF, 7) && reward.amountCHF >= 3 && typeof reward.campaignId === 'string' && reward.campaignId.length <= 80))
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
  async retryPending() {
    await this.settlement?.catch(() => {});
    const pending = this.pendingSubmission;
    if (!pending) return null;
    // Refresh CSRF without hiding a retry failure behind an older status.
    this.parseStatus(await this.request('status'));
    if (this.pendingSubmission !== pending) return null;
    return this.finish(pending);
  }
  prepare(bikeId: string): Promise<void> {
    if (this.preparing?.bikeId === bikeId) return this.preparing.task;
    if (this.prepared?.bikeId === bikeId && this.prepared.expiresAt > Date.now() + 60000) return Promise.resolve();
    const revision = ++this.revision;
    this.preparationIssue = null;
    this.prepared = null;
    const task = (async () => {
      try {
        await this.settlement?.catch(() => {});
        const status = await this.status();
        const completed = status.campaign ? ['completed', 'claimed'].includes(status.campaign.phase) : !!status.reward;
        if (revision !== this.revision) return;
        if (this.pendingSubmission || !status.available || completed || !this.csrfToken) {
          this.preparationIssue = new VerifiedRewardsError(this.pendingSubmission ? 'pending_verification'
            : completed ? 'reward_completed' : !status.available ? status.reason || 'rewards_disabled' : 'invalid_reward_response');
          return;
        }
        const start = () => this.request('run/start', { bikeId });
        let data: Record<string, unknown>;
        try { data = await start(); }
        catch (error) {
          if (!(error instanceof VerifiedRewardsError) || error.status !== 429
            || error.code !== 'reward_run_cooldown' || !error.retryAfterMs) throw error;
          // A quick restart should retain shop verification. Wait only the
          // server's bounded remainder, once; quotas and outages never loop.
          await new Promise<void>(resolve => setTimeout(resolve, error.retryAfterMs));
          if (revision !== this.revision) return;
          data = await start();
        }
        const challenge = data.challenge;
        if (!isRecord(challenge) || challenge.version !== 1 || challenge.bikeId !== bikeId
          || !BIKES.some(bike => bike.id === bikeId) || typeof challenge.runId !== 'string'
          || typeof challenge.token !== 'string' || challenge.token.length > 4096
          || !Number.isInteger(challenge.seed) || typeof challenge.seed !== 'number' || challenge.seed < 0 || challenge.seed > 0xffffffff
          || typeof challenge.startedAt !== 'number' || typeof challenge.expiresAt !== 'number'
          || !Number.isFinite(challenge.startedAt) || !Number.isFinite(challenge.expiresAt)
          || challenge.expiresAt <= Date.now()) throw new VerifiedRewardsError('invalid_reward_response');
        if (revision === this.revision) this.prepared = challenge as unknown as VerifiedRunChallenge;
      } catch (error: unknown) {
        if (revision === this.revision)
          this.preparationIssue = error instanceof VerifiedRewardsError ? error : new VerifiedRewardsError('network_error');
      }
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
      if (error instanceof VerifiedRewardsError && (error.status === 401 ||
        ['invalid_run_proof', 'invalid_run_token', 'run_not_active', 'run_expired', 'invalid_origin'].includes(error.code)))
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
