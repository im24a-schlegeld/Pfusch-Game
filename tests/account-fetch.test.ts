import { describe, expect, it, vi } from 'vitest';
import { createAccountFetch, type AccountLocks } from '../app/services/accountFetch';

const origin = 'https://game.pfusch-clothing.ch';
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function sharedLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  const names: string[] = [];
  const locks: AccountLocks = {
    request<T>(name: string, _options: { mode: 'exclusive'; signal?: AbortSignal }, callback: () => Promise<T>) {
      names.push(name);
      const pending = tail.then(callback);
      tail = pending.catch(() => undefined);
      return pending;
    },
  };
  return { locks, names };
}

describe('shared account request rotation lock', () => {
  it('orders separate tab/service instances so the next account call uses the rotated cookie', async () => {
    const { locks, names } = sharedLocks();
    const first = deferred<Response>(), started = deferred<void>();
    let cookie = 'old-cookie';
    const observed: string[] = [];
    const request = vi.fn<typeof fetch>(async url => {
      observed.push(`${url}:${cookie}`);
      if (url === '/api/player') { started.resolve(); return first.promise; }
      return new Response('{}');
    });
    const tabA = createAccountFetch(request, origin, locks), tabB = createAccountFetch(request, origin, locks);
    const player = tabA('/api/player');
    await started.promise;
    const reward = tabB('/api/rewards/status');
    expect(request).toHaveBeenCalledTimes(1);
    cookie = 'new-cookie'; // Browser applies Set-Cookie before resolving fetch.
    first.resolve(new Response('{}'));
    await Promise.all([player, reward]);
    expect(observed).toEqual(['/api/player:old-cookie', '/api/rewards/status:new-cookie']);
    expect(new Set(names).size).toBe(1);
  });

  it('shares the fallback queue across player, leaderboard, referral and reward APIs but leaves assets independent', async () => {
    const first = deferred<Response>(), started = deferred<void>();
    const request = vi.fn<typeof fetch>(async url => {
      if (url === '/api/player') { started.resolve(); return first.promise; }
      return new Response('{}');
    });
    const accountFetch = createAccountFetch(request, origin);
    const player = accountFetch('/api/player');
    await started.promise;
    const ranking = accountFetch('/api/leaderboard?period=week');
    const referral = accountFetch('/api/referral', { method: 'POST', body: '{}' });
    const reward = accountFetch('/api/rewards/run/finish', { method: 'POST', body: '{}' });
    await accountFetch('/branding/loading.webp');
    await accountFetch('https://other.example/api/player');
    await accountFetch('/auth/login');
    expect(request.mock.calls.map(([url]) => url)).toEqual(['/api/player', '/branding/loading.webp', 'https://other.example/api/player', '/auth/login']);
    first.resolve(new Response('{}'));
    await Promise.all([player, ranking, referral, reward]);
    expect(request.mock.calls.slice(4).map(([url]) => url)).toEqual(['/api/leaderboard?period=week', '/api/referral', '/api/rewards/run/finish']);
  });

  it('rejects an aborted waiting POST immediately and never sends it later', async () => {
    const first = deferred<Response>(), started = deferred<void>();
    const request = vi.fn<typeof fetch>(async url => {
      if (url === '/api/player') { started.resolve(); return first.promise; }
      return new Response('{}');
    });
    const accountFetch = createAccountFetch(request, origin);
    const player = accountFetch('/api/player');
    await started.promise;
    const controller = new AbortController();
    const pending = accountFetch('/api/rewards/claim', { method: 'POST', signal: controller.signal, body: '{}' });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(request).toHaveBeenCalledTimes(1);
    first.resolve(new Response('{}'));
    await player;
    await accountFetch('/api/referral');
    expect(request.mock.calls.map(([url]) => url)).toEqual(['/api/player', '/api/referral']);
  });

  it('respects the signal on Request objects and skips requests aborted before queueing', async () => {
    const request = vi.fn<typeof fetch>(), controller = new AbortController();
    controller.abort();
    const accountFetch = createAccountFetch(request, origin);
    await expect(accountFetch(new Request(origin + '/api/player', { signal: controller.signal })))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(request).not.toHaveBeenCalled();
  });

  it('falls back when Web Locks is denied but never retries a POST whose callback already ran', async () => {
    const denied: AccountLocks = { request: async () => { throw new DOMException('Disabled', 'SecurityError'); } };
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{}'));
    await createAccountFetch(request, origin, denied)('/api/referral', { method: 'POST', body: '{}' });
    expect(request).toHaveBeenCalledTimes(1);
    const { locks } = sharedLocks();
    const network = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce(new Response('{}'));
    const accountFetch = createAccountFetch(network, origin, locks);
    await expect(accountFetch('/api/rewards/claim', { method: 'POST', body: '{}' })).rejects.toThrow('response lost');
    expect(network).toHaveBeenCalledTimes(1);
    await accountFetch('/api/player');
    expect(network).toHaveBeenCalledTimes(2);
  });

  it('keeps a running aborted request serialized until its underlying fetch settles', async () => {
    const first = deferred<Response>(), started = deferred<void>();
    const request = vi.fn<typeof fetch>(async url => {
      if (url === '/api/player') { started.resolve(); return first.promise; }
      return new Response('{}');
    });
    const accountFetch = createAccountFetch(request, origin), controller = new AbortController();
    const player = accountFetch('/api/player', { signal: controller.signal });
    await started.promise;
    const rejected = expect(player).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    const next = accountFetch('/api/referral');
    expect(request).toHaveBeenCalledTimes(1);
    first.reject(new DOMException('Aborted', 'AbortError'));
    await next;
    expect(request).toHaveBeenCalledTimes(2);
  });
});
