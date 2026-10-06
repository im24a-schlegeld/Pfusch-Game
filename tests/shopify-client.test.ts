import { afterEach, describe, expect, it, vi } from 'vitest';
import { newPlayer } from '../app/domain/progression';
import { decodePlayer, LocalPlayerRepository, LocalLeaderboardService, type StorageDriver } from '../app/services';
import { ShopifyCloudRepository } from '../app/services/shopifyCloud';
import { ShopifyParentTransport, shopifyParentOrigin, type CloudResponse, type CloudTransport } from '../app/services/shopifyBridge';
import { ShopifyLeaderboardService } from '../app/services/shopifyLeaderboard';
import { trialAccess, type PlayerAccess } from '../app/services/playerAccess';

const hash = 'a'.repeat(64), nextHash = 'b'.repeat(64), token = 'csrf-token-for-test-only';
function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
function response(id = '123', player: unknown = newPlayer(), compareDigest: string | null = hash,
  storage: PlayerAccess = { allowed: true, reason: 'subscribed', completedRuns: 0, freeRuns: 5 }): CloudResponse {
  return { status: 200, data: { customer: { id }, player, compareDigest, csrfToken: token, storage } };
}
function repository(responses: Array<CloudResponse | Error>, driver: StorageDriver = storage()) {
  const transport: CloudTransport = { request: vi.fn(async () => {
    const result = responses.shift();
    if (!result) throw new Error('No response');
    if (result instanceof Error) throw result;
    return result;
  }) };
  return { transport, repo: new ShopifyCloudRepository(transport, driver, new LocalPlayerRepository(driver), decodePlayer, 20) };
}
afterEach(() => vi.useRealTimers());

describe('Shopify account saves', () => {
  it('shares one bounded bootstrap for auth and load and prefers existing cloud without adding guest coins', async () => {
    const driver = storage();
    driver.setItem('pfusch:player:v1', JSON.stringify({ ...newPlayer(), coins: 900 }));
    const { repo, transport } = repository([response('123', { ...newPlayer(), coins: 140 })], driver);
    const [auth, player] = await Promise.all([repo.getUser(), repo.load()]);
    expect(auth).toEqual({ id: '123', kind: 'customer' });
    expect(player.coins).toBe(140);
    expect(transport.request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(driver.getItem('pfusch:player:v1')!).coins).toBe(900);
  });

  it('imports a guest once into an empty account using CAS null and protects another account', async () => {
    vi.useFakeTimers();
    const driver = storage();
    driver.setItem('pfusch:player:v1', JSON.stringify({ ...newPlayer(), coins: 777, irlItems: ['purchase'], tickets: 10 }));
    const first = repository([response('123', null, null), response('123', { ...newPlayer(), coins: 777 }, nextHash)], driver);
    expect((await first.repo.load()).coins).toBe(777);
    await first.repo.flush();
    expect(first.transport.request).toHaveBeenLastCalledWith('POST', expect.objectContaining({ compareDigest: null, player: expect.objectContaining({ coins: 777, irlItems: [], tickets: 0 }) }));
    expect(driver.getItem('pfusch:player:v1:before-account')).toBeTruthy();
    const second = repository([response('456', null, null)], driver);
    const other = await second.repo.load();
    expect(other.coins).toBe(newPlayer().coins);
    expect(other.irlItems).toEqual([]);
  });

  it('falls back to guest on connection failure without opening another account backup', async () => {
    const driver = storage();
    driver.setItem('pfusch:player:v1:shopify:123', JSON.stringify({ player: { ...newPlayer(), coins: 9999 }, compareDigest: hash, dirty: true }));
    const { repo } = repository([new Error('offline')], driver);
    expect((await repo.load()).coins).toBe(newPlayer().coins);
    expect(await repo.getUser()).toEqual({ id: 'guest-local', kind: 'guest' });
    expect(repo.getAccess()).toMatchObject({ allowed: false, reason: 'unavailable' });
  });

  it('debounces and serializes saves with the digest returned by the preceding write', async () => {
    vi.useFakeTimers();
    const firstPlayer = { ...newPlayer(), coins: 150 };
    const { repo, transport } = repository([response(), response('123', firstPlayer, nextHash), response('123', { ...firstPlayer, coins: 170 }, 'c'.repeat(64))]);
    const player = await repo.load();
    repo.save({ ...player, coins: 110 });
    repo.save(firstPlayer);
    await repo.flush();
    repo.save({ ...player, coins: 170 });
    await repo.flush();
    expect(transport.request).toHaveBeenCalledTimes(3);
    expect(transport.request).toHaveBeenNthCalledWith(2, 'POST', expect.objectContaining({ compareDigest: hash, player: expect.objectContaining({ coins: 150 }) }));
    expect(transport.request).toHaveBeenNthCalledWith(3, 'POST', expect.objectContaining({ compareDigest: nextHash }));
    expect(repo.syncStatus.state).toBe('synced');
  });

  it('keeps existing conflict backups untouched and never retries over a newer cloud save', async () => {
    vi.useFakeTimers();
    const driver = storage();
    const { repo, transport } = repository([response(), { status: 409, data: { error: 'conflict' } }], driver);
    const player = await repo.load();
    repo.save({ ...player, coins: 555 });
    await repo.flush();
    repo.save({ ...player, coins: 556 });
    await repo.flush();
    expect(repo.syncStatus.state).toBe('conflict');
    expect(transport.request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(driver.getItem('pfusch:player:v1:shopify:123')!).player.coins).toBe(newPlayer().coins);
  });

  it('recovers pending writes only if their saved base matches the same account version', async () => {
    vi.useFakeTimers();
    const driver = storage();
    driver.setItem('pfusch:player:v1:shopify:123', JSON.stringify({ player: { ...newPlayer(), coins: 333 }, compareDigest: hash, dirty: true }));
    const { repo } = repository([response()], driver);
    expect((await repo.load()).coins).toBe(333);
    expect(repo.syncStatus.state).toBe('saving');
    const conflict = repository([response('123', { ...newPlayer(), coins: 200 }, nextHash)], driver);
    expect((await conflict.repo.load()).coins).toBe(200);
    expect(conflict.repo.syncStatus.state).toBe('conflict');
    expect(driver.getItem('pfusch:player:v1:shopify:123:conflict')).toBeTruthy();
    expect(JSON.parse(conflict.repo.export(await conflict.repo.load())).coins).toBe(333);
  });

  it('does not write account A progress after CSRF refresh reveals account B', async () => {
    vi.useFakeTimers();
    const { repo, transport } = repository([response(), { status: 403, data: { error: 'csrf' } }, response('456')]);
    const player = await repo.load();
    repo.save({ ...player, coins: 200 });
    await repo.flush();
    expect(transport.request).toHaveBeenCalledTimes(3);
    expect(repo.syncStatus.state).toBe('conflict');
  });

  it('refreshes expired CSRF only for the unchanged account and digest', async () => {
    vi.useFakeTimers();
    const { repo, transport } = repository([response(), { status: 403, data: { error: 'csrf' } }, response(), response('123', newPlayer(), nextHash)]);
    repo.save(await repo.load());
    await repo.flush();
    expect(transport.request).toHaveBeenCalledTimes(4);
    expect(repo.syncStatus.state).toBe('synced');
  });

  it('reports local backup failure honestly if the network also fails', async () => {
    vi.useFakeTimers();
    const driver: StorageDriver = { getItem: () => null, setItem: () => { throw new Error('blocked'); } };
    const { repo } = repository([response(), new Error('network')], driver);
    repo.save(await repo.load());
    await repo.flush();
    expect(repo.syncStatus.message).toContain('nur in dieser Sitzung');
  });

  it('does not claim a guest backup when the embedded browser denies storage', async () => {
    const driver: StorageDriver = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const { repo } = repository([{ status: 401, data: {} }], driver);
    await repo.load();
    expect(repo.syncStatus.state).toBe('offline');
    expect(repo.syncStatus.message).toContain('Browserspeicher ist nicht verfügbar');
  });
});

describe('newsletter ride and persistence gate', () => {
  const unsubscribed = (completedRuns = 0): PlayerAccess => ({ allowed: false, reason: 'unsubscribed', completedRuns, freeRuns: 5 });

  it('saves the fifth guest result once and blocks later rides and edits', async () => {
    const driver = storage();
    const local = new LocalPlayerRepository(driver);
    const player = await local.load();
    for (let runsPlayed = 1; runsPlayed <= 5; runsPlayed++) {
      expect((await local.refreshAccess()).allowed).toBe(true);
      local.save({ ...player, runsPlayed, coins: runsPlayed * 100 });
    }
    const fifth = driver.getItem('pfusch:player:v1');
    expect(local.getAccess()).toEqual(trialAccess(5));
    local.save({ ...player, runsPlayed: 6, coins: 600 });
    local.save({ ...player, runsPlayed: 0, coins: 900 });
    expect(driver.getItem('pfusch:player:v1')).toBe(fifth);
    expect((await local.refreshAccess()).allowed).toBe(false);
  });

  it('blocks a sixth cloud ride immediately and persists only the accepted fifth result', async () => {
    vi.useFakeTimers();
    const driver = storage();
    const fourth = { ...newPlayer(), runsPlayed: 4 }, fifth = { ...fourth, runsPlayed: 5, coins: 500 };
    const { repo, transport } = repository([response('123', fourth, hash, trialAccess(4)),
      response('123', fifth, nextHash, trialAccess(5)), response('123', fifth, nextHash, trialAccess(5))], driver);
    await repo.load();
    repo.save(fifth);
    expect(repo.getAccess()).toEqual(trialAccess(5));
    expect(JSON.parse(driver.getItem('pfusch:player:v1:shopify:123')!).player.runsPlayed).toBe(4);
    expect((await repo.refreshAccess()).allowed).toBe(false);
    expect(transport.request).toHaveBeenNthCalledWith(2, 'POST', expect.objectContaining({ player: expect.objectContaining({ runsPlayed: 5 }) }));
    expect(transport.request).toHaveBeenNthCalledWith(3, 'GET');
    const accepted = driver.getItem('pfusch:player:v1:shopify:123');
    expect(JSON.parse(accepted!).player.runsPlayed).toBe(5);
    repo.save({ ...fifth, coins: 900 });
    await repo.flush();
    expect(driver.getItem('pfusch:player:v1:shopify:123')).toBe(accepted);
    expect(transport.request).toHaveBeenCalledTimes(3);
  });

  it('does not create or replace backups when the initial live consent is unsubscribed', async () => {
    const driver = storage();
    driver.setItem('pfusch:player:v1:shopify:123', 'existing-recovery');
    driver.setItem('pfusch:player:v1', JSON.stringify(newPlayer()));
    const original = [...driver.values];
    const { repo, transport } = repository([response('123', newPlayer(), hash, unsubscribed())], driver);
    const player = await repo.load();
    repo.save({ ...player, coins: 555 });
    await repo.flush();
    expect(repo.getAccess()).toEqual(unsubscribed());
    expect([...driver.values]).toEqual(original);
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it('treats newsletter denial separately from CSRF and never saves denied changes locally', async () => {
    vi.useFakeTimers();
    const driver = storage();
    const { repo, transport } = repository([response(), { status: 403, data: { error: 'newsletter_unsubscribed', storage: unsubscribed() } }], driver);
    const player = await repo.load();
    const accepted = [...driver.values];
    repo.save({ ...player, coins: 999 });
    expect([...driver.values]).toEqual(accepted);
    await repo.flush();
    repo.save({ ...player, coins: 1000 });
    expect(repo.getAccess()).toEqual(unsubscribed());
    expect([...driver.values]).toEqual(accepted);
    expect(transport.request).toHaveBeenCalledTimes(2);
  });

  it('checks live consent on every later start and notices an unsubscribe before five rides', async () => {
    const { repo, transport } = repository([response(), response(), response('123', newPlayer(), hash, unsubscribed(2))]);
    await repo.load();
    expect((await repo.refreshAccess()).allowed).toBe(true);
    expect(await repo.refreshAccess()).toEqual(unsubscribed(2));
    expect(transport.request).toHaveBeenCalledTimes(3);
  });

  it('does not reopen cached consent or persist new backups after a network failure', async () => {
    vi.useFakeTimers();
    const driver = storage();
    const { repo } = repository([response(), new Error('offline')], driver);
    const player = await repo.load(), original = [...driver.values];
    repo.save({ ...player, coins: 200 });
    await repo.flush();
    repo.save({ ...player, coins: 300 });
    expect(repo.getAccess()).toMatchObject({ allowed: false, reason: 'unavailable' });
    expect([...driver.values]).toEqual(original);
  });

  it('does not retry a CSRF-expired save after the live refresh shows unsubscribe', async () => {
    vi.useFakeTimers();
    const { repo, transport } = repository([response(), { status: 403, data: { error: 'csrf' } }, response('123', newPlayer(), hash, unsubscribed())]);
    repo.save({ ...(await repo.load()), coins: 300 });
    await repo.flush();
    expect(transport.request).toHaveBeenCalledTimes(3);
    expect(repo.getAccess()).toEqual(unsubscribed());
  });

  it('requires a reload on guest-to-customer change instead of attaching the current player blindly', async () => {
    const driver = storage();
    const { repo } = repository([{ status: 401, data: {} }, response('456')], driver);
    await repo.load();
    expect(repo.getAccess().allowed).toBe(true);
    expect(await repo.refreshAccess()).toMatchObject({ allowed: false, reason: 'unavailable' });
    expect(repo.syncStatus.message).toContain('Bitte neu laden');
    expect(driver.getItem('pfusch:player:v1:shopify:456')).toBeNull();
  });

  it('never downgrades an established customer to a fresh guest trial on a later guest response', async () => {
    const driver = storage();
    const { repo } = repository([response(), { status: 401, data: { error: 'guest' } }], driver);
    const player = await repo.load();
    const before = [...driver.values];
    expect(await repo.refreshAccess()).toMatchObject({ allowed: false, reason: 'unavailable' });
    repo.save({ ...player, coins: player.coins + 100 });
    expect([...driver.values]).toEqual(before);
    expect(driver.getItem('pfusch:player:v1')).toBeNull();
  });

  it('fails closed when the server omits the consent decision', async () => {
    const oldResponse = response();
    const oldBody = oldResponse.data as Record<string, unknown>;
    delete oldBody.storage;
    const { repo } = repository([oldResponse]);
    await repo.load();
    expect(repo.getAccess()).toMatchObject({ allowed: false, reason: 'unavailable' });
  });

  it('resumes persistence only after a fresh subscribed response', async () => {
    vi.useFakeTimers();
    const driver = storage(), updated = { ...newPlayer(), coins: 500 };
    const { repo } = repository([response('123', newPlayer(), hash, unsubscribed()), response(), response('123', updated, nextHash)], driver);
    await repo.load();
    repo.save(updated);
    expect(driver.getItem('pfusch:player:v1:shopify:123')).toBeNull();
    expect((await repo.refreshAccess()).allowed).toBe(true);
    expect(JSON.parse(driver.getItem('pfusch:player:v1:shopify:123')!).player.coins).toBe(500);
  });
});

describe('Shopify parent message boundary', () => {
  it('uses only allowlisted browser referrers for an actual iframe', () => {
    expect(shopifyParentOrigin(true, 'https://pfusch-clothing.ch/pages/street-run')).toBe('https://pfusch-clothing.ch');
    expect(shopifyParentOrigin(false, 'https://pfusch-clothing.ch/')).toBeNull();
    expect(shopifyParentOrigin(true, 'https://pfusch-clothing.ch.attacker.test/')).toBeNull();
    expect(shopifyParentOrigin(true, '')).toBeNull();
    expect(shopifyParentOrigin(true, 'http://pfusch-clothing.ch/')).toBeNull();
  });

  function fakeWindow() {
    const listeners = new Set<(event: MessageEvent) => void>();
    const parent = { postMessage: vi.fn() };
    const host = { parent, crypto: { randomUUID: () => '00000000-1111-2222-3333-444444444444' },
      setTimeout, clearTimeout,
      addEventListener: (_: string, fn: (event: MessageEvent) => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: (event: MessageEvent) => void) => listeners.delete(fn) };
    return { host: host as unknown as Window, parent, listeners,
      send: (origin: string, source: unknown, data: unknown) => { for (const listener of listeners) listener({ origin, source, data } as MessageEvent); } };
  }
  it('ignores wrong origins/windows/IDs and removes listeners when the valid response arrives', async () => {
    vi.useFakeTimers();
    const mock = fakeWindow();
    const transport = new ShopifyParentTransport(mock.host, 'https://pfusch-clothing.ch', 100);
    const promise = transport.request('GET');
    const message = { type: 'pfusch:cloud-response', version: 1, requestId: '00000000-1111-2222-3333-444444444444', status: 200, data: {} };
    mock.send('https://other.test', mock.parent, message);
    mock.send('https://pfusch-clothing.ch', {}, message);
    mock.send('https://pfusch-clothing.ch', mock.parent, { ...message, requestId: 'wrong' });
    expect(mock.listeners.size).toBe(1);
    mock.send('https://pfusch-clothing.ch', mock.parent, message);
    await expect(promise).resolves.toEqual({ status: 200, data: {} });
    expect(mock.listeners.size).toBe(0);
    expect(mock.parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ resource: 'player' }), 'https://pfusch-clothing.ch');
  });
  it('times out without an indefinite startup wait and clears message listeners', async () => {
    vi.useFakeTimers();
    const mock = fakeWindow();
    const promise = new ShopifyParentTransport(mock.host, 'https://pfusch-clothing.ch', 100).request('GET');
    const result = expect(promise).rejects.toThrow('nicht geantwortet');
    await vi.advanceTimersByTimeAsync(101);
    await result;
    expect(mock.listeners.size).toBe(0);
  });
  it('retries a read if the theme bridge loads later, then stops on response', async () => {
    vi.useFakeTimers();
    const mock = fakeWindow();
    const promise = new ShopifyParentTransport(mock.host, 'https://pfusch-clothing.ch', 3000).request('GET');
    await vi.advanceTimersByTimeAsync(1000);
    expect(mock.parent.postMessage).toHaveBeenCalledTimes(3);
    const data = { type: 'pfusch:cloud-response', version: 1, requestId: '00000000-1111-2222-3333-444444444444', status: 200, data: {} };
    mock.send('https://pfusch-clothing.ch', mock.parent, data);
    await promise;
    await vi.advanceTimersByTimeAsync(3000);
    expect(mock.parent.postMessage).toHaveBeenCalledTimes(3);
    expect(mock.listeners.size).toBe(0);
  });
});

describe('real leaderboard rows', () => {
  it('keeps untouched ranking windows empty until a run exists', () => {
    const leaderboard = new LocalLeaderboardService();
    expect(leaderboard.list(newPlayer(), 'All time')).toEqual([]);
    expect(leaderboard.list({ ...newPlayer(), highScore: 250, runsPlayed: 1 }, 'Today')).toEqual([]);
    expect(leaderboard.list({ ...newPlayer(), highScore: 0, runsPlayed: 1 }, 'All time')).toEqual([{ name: 'DU', score: 0, you: true }]);
  });
  it('contains only the real local player without invented opponents', () => {
    expect(new LocalLeaderboardService().list({ ...newPlayer(), highScore: 431 }, 'All time')).toEqual([{ name: 'DU', score: 431, you: true }]);
  });
  it('loads genuine rows from the fixed leaderboard bridge resource', async () => {
    const transport: CloudTransport = { request: vi.fn(async () => ({ status: 200, data: { source: 'shopify', entries: [{ name: 'RIDER-ABCDE', score: 250, you: false }], message: 'Kontorangliste' } })) };
    const result = await new ShopifyLeaderboardService(transport, new LocalLeaderboardService()).fetch(newPlayer(), 'This week');
    expect(result.source).toBe('shopify');
    expect(transport.request).toHaveBeenCalledWith('GET', undefined, 'leaderboard', 'week');
  });
  it('labels a failed online fetch as local instead of fabricating global results', async () => {
    const transport: CloudTransport = { request: vi.fn(async () => ({ status: 503, data: {} })) };
    const result = await new ShopifyLeaderboardService(transport, new LocalLeaderboardService()).fetch({ ...newPlayer(), highScore: 78 }, 'All time');
    expect(result.source).toBe('local');
    expect(result.entries).toEqual([{ name: 'DU', score: 78, you: true }]);
    expect(result.message).toContain('nicht erreichbar');
  });
});
