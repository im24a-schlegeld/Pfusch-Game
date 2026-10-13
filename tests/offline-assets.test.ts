import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { isCoreOfflineAsset, isOptionalOfflineAsset } from '../scripts/offline-assets.mjs';

type EventHandler = (event: Record<string, unknown>) => void;
function workerHarness() {
  const handlers = new Map<string, EventHandler>();
  const stores = new Map<string, Map<string, Response>>();
  const cacheStore = {
    keys: async () => [...stores.keys()], delete: async (key: string) => stores.delete(key),
    open: async (name: string) => {
      let entries = stores.get(name);
      if (!entries) { entries = new Map(); stores.set(name, entries); }
      const values = entries;
      return { match: async (key: string) => values.get(key)?.clone(), put: async (key: string, response: Response) => { values.set(key, response.clone()); } };
    },
  };
  const core = [{ url: '/offline.html', revision: 'public-shell', bytes: 20 }, { url: '/models/ciao/model.bin', revision: 'bike', bytes: 20 }];
  const build = { version: 'unit', core, optional: [{ url: '/images/hoodie.png', revision: 'hoodie', bytes: 10 }], coreBytes: 40 };
  const fetcher = vi.fn(async (url: string) => new Response(url === '/offline.html' ? '<h1>Public game shell</h1>' : 'asset'));
  const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8').replace('/* PFUSCH_OFFLINE_BUILD */ null', JSON.stringify(build));
  vm.runInNewContext(source, { self: { location: { origin: 'https://game.pfusch-clothing.ch' }, clients: { claim: vi.fn() },
    addEventListener: (type: string, callback: EventHandler) => handlers.set(type, callback) },
  caches: cacheStore, fetch: fetcher, Response, URL, setTimeout, clearTimeout });
  async function install() {
    let pending: Promise<void> | undefined;
    handlers.get('install')!({ waitUntil: (promise: Promise<void>) => { pending = promise; } });
    await pending;
  }
  async function request(path: string, mode = 'cors', method = 'GET') {
    let response: Promise<Response> | undefined;
    handlers.get('fetch')!({ request: { url: new URL(path, 'https://game.pfusch-clothing.ch').href, mode, method },
      respondWith: (promise: Promise<Response>) => { response = promise; } });
    return response;
  }
  return { stores, fetcher, install, request };
}

describe('bounded offline assets', () => {
  it('includes playable models and current artwork, excluding retired artwork and source files', () => {
    expect(isCoreOfflineAsset('/models/ciao/model.bin')).toBe(true);
    expect(isCoreOfflineAsset('/assets/index-AbCd.js')).toBe(true);
    expect(isCoreOfflineAsset('/branding/loading-trailer-portrait.5040e2a548.webp')).toBe(true);
    expect(isCoreOfflineAsset('/branding/loading-wheelie.webp')).toBe(false);
    expect(isCoreOfflineAsset('/models/ciao/SOURCE.md')).toBe(false);
    expect(isCoreOfflineAsset('/images/preview/hoodie.png')).toBe(false);
    expect(isOptionalOfflineAsset('/images/preview/hoodie.png')).toBe(true);
    expect(isOptionalOfflineAsset('/api/player.json')).toBe(false);
  });
  it('only declares offline readiness after the complete public core was cached', async () => {
    const worker = workerHarness();
    await worker.install();
    expect(worker.fetcher.mock.calls.map(([url]) => url)).toEqual(['/offline.html', '/models/ciao/model.bin']);
    const stored = worker.stores.get('pfusch-offline-v1-unit')!;
    expect(stored.has('/__pfusch_offline_ready__')).toBe(true);
    expect(await stored.get('/__pfusch_offline_ready__')!.json()).toMatchObject({ ready: true, bytes: 40 });
  });
  it('never intercepts authentication, APIs, foreign requests or POSTs', async () => {
    const worker = workerHarness();
    await worker.install(); worker.fetcher.mockClear();
    for (const path of ['/api/player', '/api/referral', '/api/rewards/status', '/auth/login', '/auth/callback', 'https://account.pfusch-clothing.ch/'])
      expect(await worker.request(path, 'navigate')).toBeUndefined();
    expect(await worker.request('/', 'navigate', 'POST')).toBeUndefined();
    expect(worker.fetcher).not.toHaveBeenCalled();
  });
  it('serves the public shell and model from CacheStorage after network loss', async () => {
    const worker = workerHarness();
    await worker.install(); worker.fetcher.mockRejectedValue(new Error('Offline'));
    expect(await (await worker.request('/?share=invite', 'navigate'))?.text()).toBe('<h1>Public game shell</h1>');
    expect(await (await worker.request('/models/ciao/model.bin'))?.text()).toBe('asset');
  });
  it('does not mark a partial download ready', async () => {
    const worker = workerHarness(); worker.fetcher.mockRejectedValue(new Error('Connection lost'));
    await expect(worker.install()).rejects.toThrow('Connection lost');
    expect(worker.stores.get('pfusch-offline-v1-unit')?.has('/__pfusch_offline_ready__')).toBe(false);
  });
});
