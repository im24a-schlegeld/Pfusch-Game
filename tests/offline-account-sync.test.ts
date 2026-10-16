import { afterEach, describe, expect, it, vi } from 'vitest';
import { finishRun, newPlayer } from '../app/domain/progression';
import type { Player, RunStats } from '../app/domain/types';
import { decodePlayer, LocalPlayerRepository } from '../app/services';
import { ShopifyCloudRepository } from '../app/services/shopifyCloud';
import type { CloudTransport } from '../app/services/shopifyBridge';
import { guardianBellBalance, spendGuardianBell } from '../app/domain/guardianBells';

const accountKey = 'pfusch:player:v1:shopify:123';
function storage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
const run = (id: string): RunStats => ({ id, score: 4321, distance: 1000, seconds: 60,
  bestCombo: 1, nearMisses: 2, jumps: 1, wheelieMeters: 500, maxSpeed: 25, cause: 'crash' });
function fixture(driver = storage()) {
  const state = { online: true, id: '123', player: newPlayer(), digest: 'a'.repeat(64), posts: 0, loseAck: false, unauthorized: false, failureStatus: 0 };
  const data = () => ({ customer: { id: state.id }, player: state.player, compareDigest: state.digest,
    csrfToken: 'fresh-csrf-token-for-test', storage: { allowed: true, reason: 'subscribed', completedRuns: state.player.runsPlayed, freeRuns: 5 },
    purchases: { items: ['shop-product', 'product:shop-product:color:shop-variant'], available: true, history: 'all' } });
  const request = vi.fn<CloudTransport['request']>(async (method, body) => {
    if (!state.online) throw new Error('offline');
    if (state.failureStatus) return { status: state.failureStatus, data: { error: 'temporarily_unavailable' } };
    if (state.unauthorized) return { status: 401, data: { error: 'login_required' } };
    if (method === 'POST') {
      const payload = body as { player: Player; compareDigest: string; csrfToken: string };
      expect(payload.csrfToken).toBe('fresh-csrf-token-for-test');
      if (payload.compareDigest !== state.digest) return { status: 409, data: { error: 'conflict' } };
      expect(payload.player.irlItems).toEqual([]);
      expect(payload.player.tickets).toBe(0);
      state.player = payload.player; state.posts++; state.digest = String(state.posts).repeat(64);
      if (state.loseAck) { state.loseAck = false; throw new Error('response lost after commit'); }
    }
    return { status: 200, data: data() };
  });
  const reopen = () => new ShopifyCloudRepository({ request }, driver, new LocalPlayerRepository(driver), decodePlayer, 900, () => state.online);
  return { driver, state, request, reopen };
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('offline account progress', () => {
  it.each([408, 429, 500, 503])('retains identity and the persisted run through HTTP %s, then uploads once', async failureStatus => {
    vi.useFakeTimers();
    const f = fixture(), repo = f.reopen();
    const finished = finishRun(await repo.load(), run(`outage-${failureStatus}`))!.player;
    f.state.failureStatus = failureStatus;
    repo.save(finished); await repo.flush();
    expect(repo.syncStatus.state).toBe('offline');
    expect(await repo.getUser()).toEqual({ id: '123', kind: 'customer' });
    expect(JSON.parse(f.driver.getItem(`${accountKey}:pending`)!).player.processedRuns).toEqual([`outage-${failureStatus}`]);
    await repo.refreshAccess();
    expect(await repo.getUser()).toMatchObject({ kind: 'customer' });
    f.state.failureStatus = 0;
    await repo.refreshAccess(); await repo.refreshAccess();
    expect(f.state.posts).toBe(1);
    expect(f.state.player.processedRuns).toEqual([`outage-${failureStatus}`]);
    expect(repo.syncStatus.state).toBe('synced');
  });
  it('does not revive a rejected session or retire its outbox when an old save acknowledgement arrives', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let acknowledge!: (value: { status: number; data: unknown }) => void;
    const transport: CloudTransport = { request: (method, body, resource, period) => method === 'POST'
      ? new Promise(resolve => { acknowledge = resolve; }) : f.request(method, body, resource, period) };
    const repo = new ShopifyCloudRepository(transport, f.driver, new LocalPlayerRepository(f.driver), decodePlayer);
    const finished = finishRun(await repo.load(), run('late-ack'))!.player;
    repo.save(finished);
    const saving = repo.flush();
    repo.invalidateSession();
    acknowledge({ status: 200, data: { customer: { id: '123' }, player: finished, compareDigest: 'b'.repeat(64),
      csrfToken: 'accepted-old-account-token', storage: { allowed: true, reason: 'subscribed', completedRuns: 1, freeRuns: 5 } } });
    await saving;
    expect(await repo.getUser()).toMatchObject({ kind: 'guest' });
    expect((await repo.load()).id).toBe('guest-local');
    expect(JSON.parse(f.driver.getItem(`${accountKey}:pending`)!).player.processedRuns).toEqual(['late-ack']);
  });
  it('does not import a locally edited guest Bell ledger when creating a new customer save', async () => {
    vi.useFakeTimers();
    const driver = storage();
    driver.setItem('pfusch:player:v1', JSON.stringify({ ...newPlayer(), coins: 600,
      guardianBells: { earned: 20, spent: 0, spentRunIds: [] } }));
    let written: Player | null = null;
    const transport: CloudTransport = { request: async (method, payload) => {
      if (method === 'POST') written = (payload as { player: Player }).player;
      return { status: 200, data: { customer: { id: '123' }, player: written, compareDigest: written ? 'a'.repeat(64) : null,
        csrfToken: 'guest-import-test-csrf', storage: { allowed: true, reason: 'subscribed', completedRuns: 0, freeRuns: 5 } } };
    } };
    const repo = new ShopifyCloudRepository(transport, driver, new LocalPlayerRepository(driver), decodePlayer);
    expect(await repo.load()).toMatchObject({ coins: 600, guardianBells: { earned: 0, spent: 0, spentRunIds: [] } });
    await repo.flush();
    expect(written).toMatchObject({ guardianBells: { earned: 0, spent: 0, spentRunIds: [] } });
  });

  it.each(['same session', 'reopened online', 'reopened offline'])(
    'retains an offline Bell debit while rebasing a referral credit exactly once: %s', async mode => {
      vi.useFakeTimers();
      const f = fixture();
      f.state.player = { ...f.state.player, guardianBells: { earned: 3, spent: 1, spentRunIds: ['already-used'] } };
      const repo = f.reopen(), original = await repo.load();
      f.state.online = false;
      const spent = spendGuardianBell(original, 'offline-bell')!;
      repo.save(spent); await repo.flush();
      expect(guardianBellBalance(spent)).toBe(1);
      expect(f.state.posts).toBe(0);
      f.state.player = { ...f.state.player, coins: f.state.player.coins + 150,
        guardianBells: { ...f.state.player.guardianBells, earned: 4 } };
      f.state.digest = 'b'.repeat(64);
      if (mode !== 'reopened offline') f.state.online = true;
      const current = mode === 'same session' ? repo : f.reopen();
      await current.load();
      f.state.online = true;
      await current.refreshAccess();
      expect(current.syncStatus.state).toBe('synced');
      expect(f.state.player.guardianBells).toEqual({ earned: 4, spent: 2, spentRunIds: ['already-used', 'offline-bell'] });
      expect(f.state.player.coins).toBe(spent.coins + 150);
      expect(guardianBellBalance(await current.load())).toBe(2);
      const reopened = f.reopen(); await reopened.load(); await reopened.refreshAccess();
      expect(f.state.posts).toBe(1);
      expect(guardianBellBalance(await reopened.load())).toBe(2);
      expect(spendGuardianBell(await reopened.load(), 'offline-bell')).toBeNull();
    },
  );

  it('recognizes a Bell debit whose server acknowledgement was lost without spending or uploading twice', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.state.player = { ...f.state.player, guardianBells: { earned: 1, spent: 0, spentRunIds: [] } };
    const repo = f.reopen(), spent = spendGuardianBell(await repo.load(), 'lost-bell-ack')!;
    f.state.loseAck = true; repo.save(spent); await repo.flush();
    const reopened = f.reopen();
    expect(guardianBellBalance(await reopened.load())).toBe(0);
    await reopened.flush(); await reopened.refreshAccess();
    expect(f.state.posts).toBe(1);
    expect(f.state.player.guardianBells.spent).toBe(1);
    expect(spendGuardianBell(await reopened.load(), 'lost-bell-ack')).toBeNull();
  });

  it('keeps a concurrent device debit as a CAS conflict rather than MAX-merging balances or restoring Bells', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.state.player = { ...f.state.player, guardianBells: { earned: 2, spent: 0, spentRunIds: [] } };
    const repo = f.reopen(), initial = await repo.load();
    f.state.online = false;
    repo.save(spendGuardianBell(initial, 'local-debit')!);
    f.state.player = { ...f.state.player, guardianBells: { earned: 2, spent: 1, spentRunIds: ['other-device'] } };
    f.state.digest = 'b'.repeat(64); f.state.online = true;
    await repo.refreshAccess();
    expect(repo.syncStatus.state).toBe('conflict');
    expect(f.state.posts).toBe(0);
    expect(f.state.player.guardianBells).toEqual({ earned: 2, spent: 1, spentRunIds: ['other-device'] });
    expect(JSON.parse(f.driver.getItem(`${accountKey}:pending`)!).player.guardianBells)
      .toEqual({ earned: 2, spent: 1, spentRunIds: ['local-debit'] });
  });

  it('settles a crash once, persists through offline reopening and synchronizes once on reconnect', async () => {
    vi.useFakeTimers();
    const f = fixture(), first = f.reopen();
    const initial = await first.load();
    f.state.online = false;
    expect((await first.refreshAccess()).allowed).toBe(true);
    const result = finishRun(initial, run('offline-1'))!;
    first.save(result.player); await first.flush();
    expect(finishRun(result.player, run('offline-1'))).toBeNull();
    expect(f.state.posts).toBe(0);
    expect(first.syncStatus.state).toBe('offline');
    expect(await first.getUser()).toMatchObject({ id: '123', kind: 'customer' });
    const reopened = f.reopen(), restored = await reopened.load();
    expect(restored).toMatchObject({ coins: result.player.coins, xp: result.player.xp, highScore: 4321, runsPlayed: 1, processedRuns: ['offline-1'] });
    expect(restored.irlItems).toEqual(initial.irlItems);
    expect(f.request).toHaveBeenCalledTimes(1);
    f.state.online = true;
    await reopened.refreshAccess();
    expect(f.state.player).toMatchObject({ coins: result.player.coins, xp: result.player.xp, runsPlayed: 1 });
    expect(f.state.posts).toBe(1);
    expect(f.driver.getItem(`${accountKey}:pending`)).toBe('');
    await reopened.refreshAccess();
    expect(f.state.posts).toBe(1);
    expect(reopened.syncStatus.state).toBe('synced');
  });

  it('rebases a lost acknowledgement only onto the exact earlier snapshot and keeps later offline runs', async () => {
    vi.useFakeTimers();
    const f = fixture(), repo = f.reopen();
    const first = finishRun(await repo.load(), run('first'))!.player;
    f.state.loseAck = true;
    repo.save(first); await repo.flush();
    expect(f.state.posts).toBe(1);
    expect(repo.syncStatus.state).toBe('offline');
    f.state.online = false;
    const second = finishRun(await repo.load(), run('second'))!.player;
    repo.save(second);
    const reopened = f.reopen();
    expect((await reopened.load()).runsPlayed).toBe(2);
    f.state.online = true;
    await reopened.refreshAccess();
    expect(f.state.posts).toBe(2);
    expect(f.state.player).toMatchObject({ runsPlayed: 2, coins: second.coins, xp: second.xp, processedRuns: ['first', 'second'] });
    expect(reopened.syncStatus.state).toBe('synced');
  });

  it('recognizes an already committed offline snapshot without uploading or paying it twice', async () => {
    vi.useFakeTimers();
    const f = fixture(), repo = f.reopen();
    const finished = finishRun(await repo.load(), run('committed'))!.player;
    f.state.loseAck = true; repo.save(finished); await repo.flush();
    const reopened = f.reopen();
    expect((await reopened.load()).runsPlayed).toBe(1);
    await reopened.flush();
    expect(f.state.posts).toBe(1);
    expect(f.driver.getItem(`${accountKey}:pending`)).toBe('');
  });

  it('retains pending progress and stops if another device changed the account', async () => {
    vi.useFakeTimers();
    const f = fixture(), repo = f.reopen();
    const original = await repo.load();
    f.state.online = false;
    repo.save(finishRun(original, run('local'))!.player);
    f.state.player = { ...f.state.player, coins: 999, helmetColor: '#202324' };
    f.state.digest = 'b'.repeat(64); f.state.online = true;
    await repo.refreshAccess();
    expect(repo.syncStatus.state).toBe('conflict');
    expect(f.state.posts).toBe(0);
    expect(JSON.parse(f.driver.getItem(`${accountKey}:pending`)!).player.processedRuns).toEqual(['local']);
    expect(f.state.player.coins).toBe(999);
  });

  it('requires the same authenticated customer after reconnect and never uploads to another account', async () => {
    vi.useFakeTimers();
    const f = fixture(), repo = f.reopen();
    const original = await repo.load();
    f.state.online = false; repo.save(finishRun(original, run('private-run'))!.player);
    f.state.id = '456'; f.state.online = true;
    await repo.refreshAccess();
    expect(repo.getAccess()).toMatchObject({ allowed: true, reason: 'trial' });
    expect(f.state.posts).toBe(0);
    expect(f.driver.getItem(`${accountKey}:pending`)).toBeTruthy();
    expect(f.driver.getItem('pfusch:player:v1:offline-account')).toBe('');
    expect(await repo.getUser()).toMatchObject({ kind: 'guest' });
  });

  it('preserves pending runs on a real session expiry but stops treating them as a live login', async () => {
    vi.useFakeTimers();
    const f = fixture(), repo = f.reopen();
    const original = await repo.load();
    f.state.online = false; repo.save(finishRun(original, run('expired'))!.player);
    f.state.unauthorized = true; f.state.online = true;
    await repo.refreshAccess();
    expect(await repo.getUser()).toMatchObject({ kind: 'guest' });
    expect(repo.getAccess()).toMatchObject({ allowed: true, reason: 'trial' });
    expect(f.driver.getItem(`${accountKey}:pending`)).toBeTruthy();
    expect(f.state.posts).toBe(0);
  });

  it('restores only the independent guest purchases while keeping account equipment and unsent runs for login', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const guest = { ...newPlayer(), coins: 400, runsPlayed: 2, paint: '#202324', ownedItems: [...newPlayer().ownedItems, 'paint:#202324'] };
    f.driver.setItem('pfusch:player:v1', JSON.stringify(guest));
    f.state.player = { ...newPlayer(), coins: 2000, bike: '701', helmet: 'motocross',
      ownedItems: [...newPlayer().ownedItems, 'bike:701', 'helmet:motocross'] };
    const repo = f.reopen(), account = await repo.load();
    f.state.online = false;
    const finished = finishRun(account, run('private'))!.player;
    repo.save(finished);
    expect(await repo.getUser()).toMatchObject({ kind: 'customer' });
    f.state.online = true; f.state.unauthorized = true;
    await repo.refreshAccess();
    const loggedOut = await repo.load();
    expect(loggedOut).toMatchObject({ id: 'guest-local', coins: 400, runsPlayed: 2, bike: newPlayer().bike, helmet: newPlayer().helmet, paint: '#202324', irlItems: [] });
    expect(repo.getAccess()).toMatchObject({ reason: 'trial', completedRuns: 2 });
    repo.save({ ...loggedOut, coins: 360 });
    repo.save(finished); // A delayed account render/result cannot enter the guest slot.
    expect(JSON.parse(f.driver.getItem('pfusch:player:v1')!).coins).toBe(360);
    expect(JSON.parse(f.driver.getItem(`${accountKey}:pending`)!).player.processedRuns).toEqual(['private']);
    f.state.unauthorized = false;
    await repo.refreshAccess();
    expect(await repo.getUser()).toMatchObject({ id: '123', kind: 'customer' });
    expect(await repo.load()).toMatchObject({ bike: '701', helmet: 'motocross', coins: finished.coins, processedRuns: ['private'] });
    expect(JSON.parse(f.driver.getItem('pfusch:player:v1')!).coins).toBe(360);
  });

  it('reconciles a trusted referral coin credit with a concurrent run after one CAS retry', async () => {
    vi.useFakeTimers();
    const f = fixture(), repo = f.reopen();
    const finished = finishRun(await repo.load(), run('concurrent-referral'))!.player;
    repo.save(finished);
    f.state.player = { ...f.state.player, coins: f.state.player.coins + 150 };
    f.state.digest = 'b'.repeat(64);
    await repo.flush();
    expect(f.state.posts).toBe(1);
    expect(f.state.player).toMatchObject({ coins: finished.coins + 150, xp: finished.xp, runsPlayed: 1, processedRuns: ['concurrent-referral'] });
    expect(repo.syncStatus.state).toBe('synced');
    await repo.refreshAccess();
    expect(f.state.posts).toBe(1);
    expect((await repo.load()).coins).toBe(finished.coins + 150);
  });

  it('rebases a reopened offline outbox onto a coins-only server credit once', async () => {
    vi.useFakeTimers();
    const f = fixture(), repo = f.reopen(), original = await repo.load();
    f.state.online = false;
    const finished = finishRun(original, run('offline-referral'))!.player;
    repo.save(finished);
    f.state.player = { ...f.state.player, coins: f.state.player.coins + 150 };
    f.state.digest = 'b'.repeat(64); f.state.online = true;
    const reopened = f.reopen();
    expect((await reopened.load()).coins).toBe(finished.coins + 150);
    await reopened.flush();
    const again = f.reopen(); await again.load(); await again.refreshAccess();
    expect(f.state.posts).toBe(1);
    expect(f.state.player).toMatchObject({ coins: finished.coins + 150, runsPlayed: 1, processedRuns: ['offline-referral'] });
  });

  it('adopts newer server progress directly when there are no local edits', async () => {
    const f = fixture(), repo = f.reopen(); await repo.load();
    f.state.player = { ...f.state.player, coins: 900, highScore: 12345, xp: 20 };
    f.state.digest = 'b'.repeat(64);
    await repo.refreshAccess();
    expect(await repo.load()).toMatchObject({ coins: 900, highScore: 12345, xp: 20 });
    expect(repo.syncStatus.state).toBe('synced'); expect(f.state.posts).toBe(0);
  });

  it('retains the accepted base across offline reopening before reconciling a referral on reconnect', async () => {
    vi.useFakeTimers();
    const f = fixture(), original = f.reopen(), player = await original.load();
    f.state.online = false;
    const finished = finishRun(player, run('reopened-offline'))!.player;
    original.save(finished);
    const reopened = f.reopen();
    expect((await reopened.load()).runsPlayed).toBe(1);
    f.state.player = { ...f.state.player, coins: f.state.player.coins + 150 };
    f.state.digest = 'b'.repeat(64); f.state.online = true;
    await reopened.refreshAccess();
    expect(f.state.posts).toBe(1);
    expect(f.state.player).toMatchObject({ coins: finished.coins + 150, xp: finished.xp, processedRuns: ['reopened-offline'] });
  });
});
