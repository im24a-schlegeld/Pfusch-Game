import { afterEach, describe, expect, it, vi } from 'vitest';
import { BIKES } from '../app/domain/config';
import { OxygenVerifiedRewards, VerifiedRewardsError } from '../app/services/verifiedRewards';

const status = { available: true, csrfToken: 'csrf', verifiedPoints: 0, verifiedRuns: 0,
  pointsRequired: 50000, runsRequired: 10, dailyPoints: 0, dailyCap: 10000, eligible: false, pending: false, reward: null };
const json = (data: unknown, code = 200) => new Response(JSON.stringify(data), { status: code, headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.useRealTimers());
describe('server-owned real rewards adapter', () => {
  const campaign = { id: 'launch-million-2026', metric: 'points', target: 1000000, progress: 0, rewardCHF: 5,
    minimumSubtotalCHF: 50, offerEndsAt: '2026-10-26T00:00:00.000Z', startedAt: null, expiresAt: null,
    completedAt: null, attempt: 0, phase: 'not_started' };
  const weekly = () => ({ ...status, pointsRequired: 1000000, runsRequired: 0, dailyCap: 1000000,
    campaign: { ...campaign }, nextCampaign: null, rewards: [] });

  it('accepts bounded weekly campaign progress and rejects forged targets, amounts and counts', async () => {
    expect((await new OxygenVerifiedRewards(async () => json(weekly())).status()).campaign).toEqual(campaign);
    for (const bad of [{ target: -1 }, { rewardCHF: 99 }, { progress: 1000001 }, { minimumSubtotalCHF: 0 }, { expiresAt: 'broken' }]) {
      const data = weekly(); Object.assign(data.campaign, bad);
      await expect(new OxygenVerifiedRewards(async () => json(data)).status()).rejects.toMatchObject({ code: 'invalid_reward_response' });
    }
  });

  it('prepares a new campaign even while an earlier legitimate coupon remains visible', async () => {
    const challenge = { version: 1, runId: 'run-1', seed: 42, bikeId: BIKES[0].id,
      startedAt: Date.now(), expiresAt: Date.now() + 1800000, token: 'signed-challenge' };
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ ...weekly(),
      reward: { code: 'PFUSCH5-ABC123', expiresAt: '2026-11-01T00:00:00.000Z' } })).mockResolvedValueOnce(json({ challenge }));
    const service = new OxygenVerifiedRewards(request);
    await service.prepare(BIKES[0].id);
    expect(service.takeChallenge(BIKES[0].id)).toEqual(challenge);
  });

  it.each([
    [401, 'login_required'],
    [403, 'csrf'],
    [503, 'not_configured'],
  ])('preserves HTTP %s separately from network failures', async (httpStatus, code) => {
    const service = new OxygenVerifiedRewards(vi.fn<typeof fetch>().mockResolvedValue(json({ error: code }, httpStatus)));
    await expect(service.status()).rejects.toMatchObject({ name: 'VerifiedRewardsError', status: httpStatus, code });
  });
  it('identifies a malformed response without treating it as a login failure', async () => {
    const service = new OxygenVerifiedRewards(vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{broken', { headers: { 'Content-Type': 'application/json' } }),
    ));
    await expect(service.status()).rejects.toMatchObject({ code: 'invalid_reward_response', status: 200 });
  });
  it('invalidates the account, CSRF token and prepared run when the server rejects the session', async () => {
    const challenge = { version: 1, runId: 'run-1', seed: 42, bikeId: BIKES[0].id,
      startedAt: Date.now(), expiresAt: Date.now() + 1800000, token: 'signed-challenge' };
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json(status)).mockResolvedValueOnce(json({ challenge }))
      .mockResolvedValueOnce(json({ error: 'login_required' }, 401)).mockResolvedValueOnce(json({ error: 'login_required' }, 401));
    const unauthorized = vi.fn();
    const service = new OxygenVerifiedRewards(request, 30000, unauthorized);
    await service.prepare(BIKES[0].id);
    await expect(service.status()).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toHaveBeenCalledTimes(1);
    expect(service.takeChallenge(BIKES[0].id)).toBeNull();
    await expect(service.claim()).rejects.toMatchObject({ status: 401 });
    expect(request.mock.calls[3][0]).toBe('/api/rewards/status');
    expect(unauthorized).toHaveBeenCalledTimes(2);
  });
  it('allows slow account verification past six seconds and reports the bounded thirty-second timeout', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const request = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      signal = init?.signal;
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const pending = new OxygenVerifiedRewards(request).status();
    const rejected = expect(pending).rejects.toMatchObject({ code: 'request_timeout' });
    await vi.advanceTimersByTimeAsync(6001);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(23999);
    await rejected;
    expect(signal?.aborted).toBe(true);
  });
  it('prefetches and consumes a signed challenge once without transmitting player progress', async () => {
    const challenge = { version: 1, runId: 'run-1', seed: 42, bikeId: BIKES[0].id,
      startedAt: Date.now(), expiresAt: Date.now() + 1800000, token: 'signed-challenge' };
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json(status)).mockResolvedValueOnce(json({ challenge, csrfToken: 'csrf' }))
      .mockResolvedValueOnce(json({ ...status, accepted: true, creditedPoints: 100 }));
    const service = new OxygenVerifiedRewards(request);
    await service.prepare(BIKES[0].id);
    expect(service.takeChallenge(BIKES[0].id)).toEqual(challenge);
    expect(service.takeChallenge(BIKES[0].id)).toBeNull();
    const proof = { ticks: 1200, events: [] };
    await service.finish({ token: challenge.token, proof });
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({ bikeId: BIKES[0].id, csrfToken: 'csrf' });
    expect(JSON.parse(String(request.mock.calls[2][1]?.body))).toEqual({ token: challenge.token, proof, csrfToken: 'csrf' });
    expect(request.mock.calls[2][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  });
  it('keeps disabled and unreachable reward servers out of the ride path', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ ...status, available: false, reason: 'rewards_disabled' }));
    const service = new OxygenVerifiedRewards(request);
    await expect(service.prepare(BIKES[0].id)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
    expect(service.takeChallenge(BIKES[0].id)).toBeNull();
    const offline = new OxygenVerifiedRewards(vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')));
    await expect(offline.prepare(BIKES[0].id)).resolves.toBeUndefined();
    expect(offline.takeChallenge(BIKES[0].id)).toBeNull();
  });
  it('preserves server pending issuance and returns only a confirmed server code', async () => {
    const reward = { code: 'PFUSCH-ABC123', expiresAt: new Date(Date.now() + 86400000).toISOString() };
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ ...status, pending: true }))
      .mockResolvedValueOnce(json({ ...status, reward }));
    const service = new OxygenVerifiedRewards(request);
    expect((await service.status()).pending).toBe(true);
    expect((await service.claim()).reward).toEqual(reward);
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({ csrfToken: 'csrf' });
  });
  it('refreshes CSRF once when confirming a reserved code after the card has stayed open', async () => {
    const reward = { code: 'PFUSCH-ABC123', expiresAt: new Date(Date.now() + 86400000).toISOString() };
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ ...status, pending: true, csrfToken: 'old-token' }))
      .mockResolvedValueOnce(json({ error: 'csrf' }, 403))
      .mockResolvedValueOnce(json({ ...status, pending: true, csrfToken: 'fresh-token' }))
      .mockResolvedValueOnce(json({ ...status, reward }));
    const service = new OxygenVerifiedRewards(request);
    await service.status();
    expect((await service.claim()).reward).toEqual(reward);
    expect(request.mock.calls.map(call => call[0])).toEqual(['/api/rewards/status', '/api/rewards/claim', '/api/rewards/status', '/api/rewards/claim']);
    expect(JSON.parse(String(request.mock.calls[3][1]?.body))).toEqual({ csrfToken: 'fresh-token' });
  });
  it('does not loop when the refreshed claim is still rejected', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json(status))
      .mockResolvedValueOnce(json({ error: 'csrf' }, 403)).mockResolvedValueOnce(json(status))
      .mockResolvedValueOnce(json({ error: 'csrf' }, 403));
    const service = new OxygenVerifiedRewards(request);
    await service.status();
    await expect(service.claim()).rejects.toBeInstanceOf(VerifiedRewardsError);
    expect(request).toHaveBeenCalledTimes(4);
  });
  it('never retries a claim rejected for another reason', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json(status))
      .mockResolvedValueOnce(json({ error: 'invalid_origin' }, 403));
    const service = new OxygenVerifiedRewards(request);
    await service.status();
    await expect(service.claim()).rejects.toMatchObject({ code: 'invalid_origin', status: 403 });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('retries the same signed proof after a lost response before replacing its active run', async () => {
    const submission = { token: 'signed-run', proof: { ticks: 1200, events: [] } };
    const request = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(json({ ...status, verifiedPoints: 300, verifiedRuns: 1 }))
      .mockResolvedValueOnce(json({ ...status, verifiedPoints: 300, verifiedRuns: 1 }));
    const service = new OxygenVerifiedRewards(request);
    await expect(service.finish(submission)).rejects.toMatchObject({ code: 'network_error' });
    expect((await service.status()).verifiedPoints).toBe(300);
    expect(request.mock.calls.map(call => call[0])).toEqual(['/api/rewards/run/finish', '/api/rewards/status', '/api/rewards/run/finish']);
    expect(JSON.parse(String(request.mock.calls[2][1]?.body)).token).toBe(submission.token);
  });
  it('refreshes an expired CSRF token before retrying and returns newly settled progress', async () => {
    const submission = { token: 'signed-run', proof: { ticks: 1200, events: [] } };
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ ...status, csrfToken: 'old-token' }))
      .mockResolvedValueOnce(json({ error: 'csrf' }, 403))
      .mockResolvedValueOnce(json({ ...status, csrfToken: 'fresh-token' }))
      .mockResolvedValueOnce(json({ ...status, verifiedPoints: 700, verifiedRuns: 1, csrfToken: 'settled-token' }));
    const service = new OxygenVerifiedRewards(request);
    await service.status();
    await expect(service.finish(submission)).rejects.toThrow('csrf');
    expect((await service.status()).verifiedPoints).toBe(700);
    expect(JSON.parse(String(request.mock.calls[1][1]?.body)).csrfToken).toBe('old-token');
    expect(request.mock.calls[2][0]).toBe('/api/rewards/status');
    expect(JSON.parse(String(request.mock.calls[3][1]?.body))).toEqual({ ...submission, csrfToken: 'fresh-token' });
  });
  it('returns available status after a failed retry while keeping that proof for the next retry', async () => {
    const submission = { token: 'signed-run', proof: { ticks: 1200, events: [] } };
    const request = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(json(status)).mockRejectedValueOnce(new Error('offline-again'))
      .mockResolvedValueOnce(json(status)).mockResolvedValueOnce(json({ ...status, verifiedPoints: 450, verifiedRuns: 1 }));
    const service = new OxygenVerifiedRewards(request);
    await expect(service.finish(submission)).rejects.toMatchObject({ code: 'network_error' });
    expect((await service.status()).verifiedPoints).toBe(0);
    expect((await service.status()).verifiedPoints).toBe(450);
    expect(JSON.parse(String(request.mock.calls[4][1]?.body)).token).toBe(submission.token);
  });
});
