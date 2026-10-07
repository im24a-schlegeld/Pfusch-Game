import { describe, expect, it, vi } from 'vitest';
import { BIKES } from '../app/domain/config';
import { OxygenVerifiedRewards } from '../app/services/verifiedRewards';

const status = { available: true, csrfToken: 'csrf', verifiedPoints: 0, verifiedRuns: 0,
  pointsRequired: 50000, runsRequired: 10, dailyPoints: 0, dailyCap: 10000, eligible: false, pending: false, reward: null };
const json = (data: unknown, code = 200) => new Response(JSON.stringify(data), { status: code, headers: { 'Content-Type': 'application/json' } });
describe('server-owned real rewards adapter', () => {
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
  it('retries the same signed proof after a lost response before replacing its active run', async () => {
    const submission = { token: 'signed-run', proof: { ticks: 1200, events: [] } };
    const request = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(json({ ...status, verifiedPoints: 300, verifiedRuns: 1 }))
      .mockResolvedValueOnce(json({ ...status, verifiedPoints: 300, verifiedRuns: 1 }));
    const service = new OxygenVerifiedRewards(request);
    await expect(service.finish(submission)).rejects.toThrow('offline');
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
    await expect(service.finish(submission)).rejects.toThrow('offline');
    expect((await service.status()).verifiedPoints).toBe(0);
    expect((await service.status()).verifiedPoints).toBe(450);
    expect(JSON.parse(String(request.mock.calls[4][1]?.body)).token).toBe(submission.token);
  });
});
