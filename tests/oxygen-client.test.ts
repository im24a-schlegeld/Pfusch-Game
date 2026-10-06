import { afterEach, describe, expect, it, vi } from 'vitest';
import { OxygenTransport } from '../app/services/oxygenTransport';
import { readOxygenRuntime, startOxygenLogin } from '../app/services/oxygenRuntime';
import { createServices } from '../app/services';
import { SHOPIFY_PAYLOAD_LIMIT } from '../app/services/shopifyBridge';

const response = (status = 200, data: unknown = { ok: true }) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const documentFor = (textContent: string | null, tagName = 'SCRIPT', type = 'application/json') => ({
  getElementById: vi.fn(() => textContent === null ? null : { textContent, tagName, getAttribute: () => type } as unknown as HTMLElement),
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Oxygen runtime selection and login', () => {
  it('requires explicit server JSON and rejects endpoint, identity and malformed configuration', () => {
    expect(readOxygenRuntime(documentFor(null))).toBeNull();
    expect(readOxygenRuntime(documentFor('{"version":1,"mode":"oxygen"}'))).toEqual({ version: 1, mode: 'oxygen' });
    for (const raw of ['{}', 'null', '{"version":2,"mode":"oxygen"}', '{"version":1,"mode":"oxygen","customerId":"123"}',
      '{"version":1,"mode":"oxygen","api":"https://evil.example"}', 'not-json'])
      expect(() => readOxygenRuntime(documentFor(raw))).toThrow();
    expect(() => readOxygenRuntime(documentFor('{"version":1,"mode":"oxygen"}', 'DIV'))).toThrow();
  });

  it('chooses direct server requests ahead of the parent bridge inside Shopify', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response(401, { error: 'login_required' }));
    const postMessage = vi.fn();
    const values = new Map<string, string>();
    vi.stubGlobal('window', { parent: { postMessage }, fetch, localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    } });
    vi.stubGlobal('document', { ...documentFor('{"version":1,"mode":"oxygen"}'), referrer: 'https://pfusch-clothing.ch/' });
    const services = createServices();
    expect(await services.auth.getUser()).toMatchObject({ kind: 'guest' });
    expect(services.players.getAccess?.()).toMatchObject({ reason: 'trial', allowed: true });
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/player', expect.objectContaining({ credentials: 'same-origin' }));
    expect(postMessage).not.toHaveBeenCalled();
    expect(services.auth.login).toBeTypeOf('function');
  });

  it('asks the trusted storefront to preserve its own route without supplying identity or arbitrary URLs', () => {
    const parent = { postMessage: vi.fn() };
    const host = { parent } as unknown as Window;
    startOxygenLogin(host, 'https://pfusch-clothing.ch');
    expect(parent.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'pfusch:open-login', version: 1 }, 'https://pfusch-clothing.ch');
  });

  it('uses the same-origin login route in a standalone window', () => {
    const location = { href: 'https://game.pfusch-clothing.ch/?setup=garage#rider', assign: vi.fn() };
    const host = { location } as unknown as Window;
    Object.assign(host, { parent: host, top: host });
    startOxygenLogin(host, null);
    const url = new URL(location.assign.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://game.pfusch-clothing.ch/auth/login');
    expect(url.searchParams.get('return_to')).toBe(location.href);
  });
});

describe('Oxygen direct transport', () => {
  it('uses fixed same-origin API endpoints with cookies, CSRF payload and no redirects', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response());
    const transport = new OxygenTransport(fetch);
    const body = { player: { id: 'untrusted-client-id' }, csrfToken: 'server-csrf', compareDigest: null };
    expect(await transport.request('POST', body)).toEqual({ status: 200, data: { ok: true } });
    expect(fetch).toHaveBeenCalledWith('/api/player', expect.objectContaining({ method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store', body: JSON.stringify(body) }));
    await transport.request('GET', undefined, 'leaderboard', 'week');
    expect(fetch).toHaveBeenLastCalledWith('/api/leaderboard?period=week', expect.objectContaining({ method: 'GET' }));
    await expect(transport.request('POST', {}, 'leaderboard', 'day')).rejects.toThrow();
    await expect(transport.request('GET', {}, 'player')).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('preserves server guest, consent and conflict status instead of trusting local account state', async () => {
    for (const status of [401, 403, 409, 503]) {
      const data = { error: status === 401 ? 'login_required' : 'unavailable' };
      const transport = new OxygenTransport(vi.fn(async () => response(status, data)));
      expect(await transport.request('GET')).toEqual({ status, data });
    }
  });

  it('rejects oversized requests and streamed replies, HTML and broken JSON', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response());
    await expect(new OxygenTransport(fetch).request('POST', { value: 'x'.repeat(SHOPIFY_PAYLOAD_LIMIT) })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    for (const result of [response(200, 'x'.repeat(SHOPIFY_PAYLOAD_LIMIT)), new Response('<html/>'),
      new Response('{broken', { headers: { 'Content-Type': 'application/json' } })]) {
      await expect(new OxygenTransport(vi.fn(async () => result)).request('GET')).rejects.toThrow();
    }
  });

  it('aborts stalled connections within the bounded deadline', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const request = new OxygenTransport(fetch, 100).request('GET');
    const assertion = expect(request).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });
});
