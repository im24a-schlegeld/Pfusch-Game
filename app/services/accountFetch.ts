/** Browser-wide serialization keeps OAuth cookie rotations ordered even when
 * different account requests reach different Oxygen workers. No asset or frame
 * work passes through this queue. Cookies are applied before fetch resolves. */
export interface AccountLocks {
  request<T>(name: string, options: { mode: 'exclusive'; signal?: AbortSignal }, callback: () => Promise<T>): Promise<T>;
}
const accountPaths = new Set(['/api/player', '/api/leaderboard', '/api/referral',
  '/api/rewards/status', '/api/rewards/run/start', '/api/rewards/run/finish', '/api/rewards/claim']);
const lockName = 'pfusch:account-session:v1';
const aborted = (signal: AbortSignal) => signal.reason ?? new DOMException('Aborted', 'AbortError');

function interruptible<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener('abort', onAbort); reject(aborted(signal)); };
    // Keep handlers on pending even after abort: an in-flight fetch still owns
    // the queue until it settles; a queued POST checks abort before sending.
    pending.then(value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); });
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function createAccountFetch(request: typeof fetch, origin: string, locks?: AccountLocks): typeof fetch {
  let tail: Promise<unknown> = Promise.resolve();
  return (input, init) => {
    let url: URL;
    try { url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, origin); }
    catch { return request(input, init); }
    if (url.origin !== origin || !accountPaths.has(url.pathname)) return request(input, init);
    const signal = init && 'signal' in init ? init.signal ?? undefined : input instanceof Request ? input.signal : undefined;
    const run = async () => {
      if (signal?.aborted) throw aborted(signal);
      let started = false;
      const send = () => {
        if (signal?.aborted) throw aborted(signal);
        started = true;
        return request(input, init);
      };
      if (!locks) return send();
      try { return await locks.request(lockName, { mode: 'exclusive', ...(signal ? { signal } : {}) }, send); }
      catch (error) {
        // Sandboxed/older browsers may expose locks but reject their use.
        // Fall back only before a callback ran; never retry a failed POST.
        if (started || signal?.aborted || error instanceof Error && error.name === 'AbortError') throw error;
        return send();
      }
    };
    const pending = tail.then(run);
    tail = pending.catch(() => undefined);
    return interruptible(pending, signal);
  };
}
