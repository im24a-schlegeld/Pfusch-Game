import { describe, expect, it, vi } from 'vitest';
import { OxygenInvites, withInvitations, type InviteService } from '../app/services/referrals';
import type { StorageDriver } from '../app/services';
import type { CloudTransport } from '../app/services/shopifyBridge';

const code = 'v1.abcdefghijklmnop.Valid_opaque_ciphertext';
const otherCode = 'v1.qrstuvwxyzABCDEF.Other_opaque_ciphertext';
const pendingKey = 'pfusch:invitation:v1';
const search = (value = code) => `?share=invite&ref=${value}`;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function storage(): StorageDriver & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

describe('invitation attribution client', () => {
  it('persists only the first valid opaque invitation across login/reload, never account or score data', () => {
    const driver = storage(), request = vi.fn<typeof fetch>();
    const invites = new OxygenInvites(driver, request, () => true);
    for (const invalid of ['?share=score&ref=' + code, '?share=invite&ref=customer-100', search() + '&ref=' + otherCode,
      '?share=invite&ref=' + 'a'.repeat(2100)]) invites.capture(invalid);
    expect(driver.values.size).toBe(0);
    invites.capture(search() + '&customerId=100&coins=9999&csrfToken=private');
    invites.capture(search(otherCode));
    expect([...driver.values]).toEqual([[pendingKey, code]]);
    const reloaded = new OxygenInvites(driver, request, () => true);
    reloaded.capture(search(otherCode));
    expect(driver.getItem(pendingKey)).toBe(code);
    expect(request).not.toHaveBeenCalled();
  });

  it('obtains fresh server CSRF, submits no client reward amount and clears only confirmed acceptance', async () => {
    const driver = storage();
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ code: otherCode, csrfToken: 'fresh-csrf', reward: 150 }))
      .mockResolvedValueOnce(json({ accepted: true }));
    const invites = new OxygenInvites(driver, request, () => true);
    invites.capture(search());
    await invites.acceptPending();
    expect(request.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'POST']);
    expect(request.mock.calls.every(([url, init]) => url === '/api/referral' && init?.credentials === 'same-origin'
      && init.cache === 'no-store' && init.redirect === 'error')).toBe(true);
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({ code, csrfToken: 'fresh-csrf' });
    expect(driver.getItem(pendingKey)).toBe('');
    await invites.acceptPending();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('coalesces simultaneous accepts and retains attribution after a network failure', async () => {
    const driver = storage();
    let resolveGet!: (response: Response) => void;
    const request = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise<Response>(resolve => { resolveGet = resolve; }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(json({ csrfToken: 'retry-csrf' }))
      .mockResolvedValueOnce(json({ accepted: true }));
    const invites = new OxygenInvites(driver, request, () => true);
    invites.capture(search());
    const first = invites.acceptPending(), second = invites.acceptPending();
    expect(second).toBe(first);
    const failure = expect(first).rejects.toThrow();
    resolveGet(json({ csrfToken: 'first-csrf' }));
    await failure;
    expect(driver.getItem(pendingKey)).toBe(code);
    await invites.acceptPending();
    expect(driver.getItem(pendingKey)).toBe('');
    expect(request).toHaveBeenCalledTimes(4);
  });

  it.each([[409, 'conflict'], [503, 'invitation_unavailable'], [403, 'csrf'], [401, 'login_required']] as const)
    ('keeps the same pending invitation on retryable HTTP %s / %s', async (status, error) => {
      const driver = storage();
      const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ csrfToken: 'first' }))
        .mockResolvedValueOnce(json({ error }, status)).mockResolvedValueOnce(json({ csrfToken: 'next' }))
        .mockResolvedValueOnce(json({ accepted: true }));
      const invites = new OxygenInvites(driver, request, () => true);
      invites.capture(search());
      await expect(invites.acceptPending()).rejects.toThrow();
      expect(driver.getItem(pendingKey)).toBe(code);
      await invites.acceptPending();
      expect(driver.getItem(pendingKey)).toBe('');
      expect(JSON.parse(String(request.mock.calls[3][1]?.body))).toEqual({ code, csrfToken: 'next' });
    });

  it.each([[400, 'invalid_invitation'], [400, 'self_invitation'], [409, 'existing_player'],
    [409, 'invitation_already_used'], [404, 'invitation_account_unavailable']] as const)
    ('drops permanently rejected HTTP %s / %s attribution so normal cloud saves can continue', async (status, error) => {
      const driver = storage(), request = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ csrfToken: 'csrf' }))
        .mockResolvedValueOnce(json({ error }, status));
      const invites = new OxygenInvites(driver, request, () => true);
      invites.capture(search());
      await expect(invites.acceptPending()).resolves.toBeUndefined();
      expect(driver.getItem(pendingKey)).toBe('');
      await invites.acceptPending();
      expect(request).toHaveBeenCalledTimes(2);
    });

  it('defers offline attribution without sending requests and retries on reconnection', async () => {
    let online = false;
    const driver = storage(), request = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ csrfToken: 'csrf' }))
      .mockResolvedValueOnce(json({ accepted: true }));
    const invites = new OxygenInvites(driver, request, () => online);
    invites.capture(search());
    expect(await invites.getInvite()).toBeNull();
    await expect(invites.acceptPending()).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    expect(driver.getItem(pendingKey)).toBe(code);
    online = true;
    await invites.acceptPending();
    expect(driver.getItem(pendingKey)).toBe('');
  });

  it('does not expose malformed, non-JSON or unauthenticated codes as a shareable invitation', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ error: 'login_required' }, 401))
      .mockResolvedValueOnce(new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }))
      .mockResolvedValueOnce(json({ code: 'customer-123' }))
      .mockResolvedValueOnce(json({ code, csrfToken: 'private-token' }));
    const invites = new OxygenInvites(storage(), request, () => true);
    expect(await invites.getInvite()).toBeNull();
    expect(await invites.getInvite()).toBeNull();
    expect(await invites.getInvite()).toBeNull();
    expect(await invites.getInvite()).toEqual({ code });
  });

  it('keeps attribution in memory when optional local storage is unavailable', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ csrfToken: 'csrf' })).mockResolvedValueOnce(json({ accepted: true }));
    const broken: StorageDriver = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    const invites = new OxygenInvites(broken, request, () => true);
    invites.capture(search());
    await invites.acceptPending();
    await invites.acceptPending();
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('first-save invitation ordering', () => {
  function setup() {
    const events: string[] = [];
    const invites: InviteService = { getInvite: async () => null, capture: () => {}, acceptPending: vi.fn(async () => { events.push('accept'); }) };
    const transport: CloudTransport = { request: vi.fn(async () => { events.push('save'); return { status: 200, data: {} }; }) };
    return { events, invites, transport, wrapped: withInvitations(transport, invites) };
  }
  it('binds attribution before the first or restored-outbox player POST, preserving its payload', async () => {
    const { events, invites, transport, wrapped } = setup();
    const payload = { player: { coins: 42 }, compareDigest: 'original-digest' };
    await wrapped.request('POST', payload, 'player');
    expect(events).toEqual(['accept', 'save']);
    expect(transport.request).toHaveBeenCalledWith('POST', payload, 'player', undefined);
    await wrapped.request('POST', payload);
    expect(invites.acceptPending).toHaveBeenCalledTimes(2);
  });
  it('leaves reads and leaderboard requests independent and keeps failed attribution pending before a save', async () => {
    const { invites, transport, wrapped } = setup();
    await wrapped.request('GET', undefined, 'player');
    await wrapped.request('GET', undefined, 'leaderboard', 'week');
    await wrapped.request('POST', {}, 'leaderboard');
    expect(invites.acceptPending).not.toHaveBeenCalled();
    vi.mocked(invites.acceptPending).mockRejectedValueOnce(new Error('offline'));
    await expect(wrapped.request('POST', { player: {} })).rejects.toThrow('offline');
    expect(transport.request).toHaveBeenCalledTimes(3);
  });
});
