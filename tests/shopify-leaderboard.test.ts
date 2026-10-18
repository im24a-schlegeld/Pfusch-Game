import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { newPlayer } from '../app/domain/progression';
import type { Player } from '../app/domain/types';
import { correctRankingHighScore, handleRankingRequest, mergeRanking, playerAlias, rankingWindows, updateRanking, type Board } from '../server/shopify/leaderboard';

const now = Date.parse('2026-10-05T12:00:00Z');
const config = { shop: 'pfusch-test.myshopify.com', secret: 'unit-test-only-secret', adminToken: 'test-token' };
function empty(): Board { const keys = rankingWindows(now); return { version: 1, day: { key: keys.day, rows: [] }, week: { key: keys.week, rows: [] }, all: { key: 'all', rows: [] } }; }
function signed(period = 'all') {
  const query = new URLSearchParams({ period, shop: config.shop, logged_in_customer_id: '123', timestamp: String(now / 1000), path_prefix: '/apps/pfusch-game' });
  const canonical = [...query].map(([key, value]) => `${key}=${value}`).sort().join('');
  query.set('signature', createHmac('sha256', config.secret).update(canonical).digest('hex'));
  return `/api/shopify/leaderboard?${query}`;
}
const response = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const loaded = (board: Board | null, digest: string | null = null, player?: Player, playerDigest = 'd'.repeat(64)) => response({
  shop: { id: 'gid://shopify/Shop/7', metafield: board ? { value: JSON.stringify(board), compareDigest: digest ?? 'a'.repeat(64) } : null },
  ...(player ? { customer: { id: 'gid://shopify/Customer/123', metafield: { value: JSON.stringify(player), compareDigest: playerDigest } } } : {}),
});
describe('real saved rider leaderboard', () => {
  it('starts empty and never invents opponents', async () => {
    const request = vi.fn().mockResolvedValue(loaded(null));
    const result = await handleRankingRequest('GET', signed(), config, request, now);
    expect(result.status).toBe(200); expect(result.body).toMatchObject({ entries: [], source: 'shopify' });
  });
  it('uses UTC Mondays, rolls windows over, and ignores future records', () => {
    expect(rankingWindows(Date.parse('2026-10-04T23:59:59Z')).week).toBe('2026-09-28');
    expect(rankingWindows(now).week).toBe('2026-10-05');
    const player = newPlayer(); player.highScore = 999;
    player.history = [{ date: '2026-10-04', score: 999 }, { date: '2026-10-05', score: 123 }, { date: '2026-10-06', score: 777 }];
    const prior = empty(); prior.day.key = '2026-10-04'; prior.day.rows = [{ alias: 'b'.repeat(16), score: 2000 }];
    const result = mergeRanking(prior, 'a'.repeat(16), player, now);
    expect(result.day.rows).toEqual([{ alias: 'a'.repeat(16), score: 123 }]);
    expect(result.week.rows[0].score).toBe(123); expect(result.all.rows[0].score).toBe(999);
  });
  it('keeps one best score per rider and caps every board at 50', () => {
    let board = empty(); const player = newPlayer();
    for (let n = 1; n <= 80; n++) { player.highScore = n; board = mergeRanking(board, n.toString(16).padStart(16, '0'), player, now); }
    expect(board.all.rows).toHaveLength(50); expect(board.all.rows[0].score).toBe(80);
    player.highScore = 1; board = mergeRanking(board, (80).toString(16).padStart(16, '0'), player, now);
    expect(board.all.rows[0].score).toBe(80);
  });
  it('clears a saved public name in every ranking window without losing the best score', async () => {
    const alias = await playerAlias(config, '123');
    const player = { ...newPlayer(), leaderboardName: 'Dario', highScore: 400, history: [{ date: '2026-10-05', score: 400 }] };
    const named = mergeRanking(empty(), alias, player, now);
    for (const history of [player.history, []]) {
      const cleared = mergeRanking(named, alias, { ...player, leaderboardName: '', highScore: 300, history }, now);
      for (const period of ['day', 'week', 'all'] as const)
        expect(cleared[period].rows).toEqual([{ alias, score: 400 }]);
      const result = await handleRankingRequest('GET', signed(), config, vi.fn().mockResolvedValue(loaded(cleared)), now);
      expect(result.body).toMatchObject({ entries: [{ name: 'DU', score: 400, you: true }] });
    }
  });
  it('never erases an already advanced UTC window from an older in-flight request', async () => {
    const advanced = empty();
    advanced.day = { key: '2026-10-06', rows: [{ alias: 'b'.repeat(16), score: 250 }] };
    const request = vi.fn().mockResolvedValue(loaded(advanced, null, { ...newPlayer(), highScore: 999 }));
    await expect(updateRanking(config, '123', { ...newPlayer(), highScore: 999 }, request, now))
      .rejects.toMatchObject({ status: 409, code: 'ranking_window_changed' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('publishes only opaque aliases; no customer IDs or private profile fields', async () => {
    const board = empty(); board.all.rows = [{ alias: await playerAlias(config, '123'), score: 400 }, { alias: await playerAlias(config, '456'), score: 300 }];
    const result = await handleRankingRequest('GET', signed(), config, vi.fn().mockResolvedValue(loaded(board)), now);
    expect(result.body).toMatchObject({ entries: [{ name: 'DU', score: 400, you: true }, { score: 300, you: false }] });
    const raw = JSON.stringify(result.body);
    expect(raw).not.toContain('customer'); expect(raw).not.toContain(await playerAlias(config, '456'));
  });
  it('retries concurrent saves with a fresh digest without losing another rider', async () => {
    const other = empty(); other.all.rows = [{ alias: 'b'.repeat(16), score: 88 }];
    const player = newPlayer(); player.highScore = 99;
    const request = vi.fn().mockResolvedValueOnce(loaded(null, null, player))
      .mockResolvedValueOnce(response({ metafieldsSet: { userErrors: [{ code: 'INVALID_COMPARE_DIGEST' }] } }))
      .mockResolvedValueOnce(loaded(other, 'c'.repeat(64), player))
      .mockResolvedValueOnce(response({ metafieldsSet: { userErrors: [] } }));
    await updateRanking(config, '123', player, request, now);
    const first = JSON.parse(request.mock.calls[1][1].body).variables.metafields[0];
    const retryFields = JSON.parse(request.mock.calls[3][1].body).variables.metafields;
    const retry = retryFields[0];
    expect(first.compareDigest).toBeNull(); expect(retry.compareDigest).toBe('c'.repeat(64));
    expect(JSON.parse(retry.value).all.rows).toHaveLength(2);
    expect(retryFields).toHaveLength(2);
    expect(retryFields[1]).toMatchObject({ ownerId: 'gid://shopify/Customer/123', key: 'player_v1',
      compareDigest: 'd'.repeat(64), value: JSON.stringify(player) });
  });
  it('caps retained period history at the corrected lifetime highscore on later saves', () => {
    const alias = 'a'.repeat(16);
    const board = empty();
    for (const period of ['day', 'week', 'all'] as const) board[period].rows = [{ alias, score: 500, name: 'Dario' }];
    const player = { ...newPlayer(), leaderboardName: 'Dario', highScore: 500,
      history: [{ date: '2026-10-05', score: 900 }] };
    const updated = mergeRanking(board, alias, player, now);
    for (const period of ['day', 'week', 'all'] as const)
      expect(updated[period].rows).toEqual([{ alias, score: 500, name: 'Dario' }]);
  });
  it('uses the freshly saved player when an older ranking publication finishes after an admin correction', async () => {
    const alias = await playerAlias(config, '123');
    const board = empty();
    for (const period of ['day', 'week', 'all'] as const) board[period].rows = [{ alias, score: 400 }];
    const current = { ...newPlayer(), highScore: 500, history: [{ date: '2026-10-05', score: 900 }] };
    const stale = { ...current, highScore: 900 };
    const request = vi.fn().mockResolvedValueOnce(loaded(board, 'c'.repeat(64), current))
      .mockResolvedValueOnce(response({ metafieldsSet: { userErrors: [] } }));
    await updateRanking(config, '123', stale, request, now);
    expect(request).toHaveBeenCalledTimes(2);
    const read = JSON.parse(request.mock.calls[0][1].body);
    expect(read.query).toContain('customer');
    expect(read.query).toContain('shop');
    const fields = JSON.parse(request.mock.calls[1][1].body).variables.metafields;
    expect(fields).toHaveLength(2);
    expect(fields[1]).toMatchObject({ ownerId: 'gid://shopify/Customer/123', key: 'player_v1',
      compareDigest: 'd'.repeat(64), value: JSON.stringify(current) });
    const field = fields[0];
    const published = JSON.parse(field.value) as Board;
    for (const period of ['day', 'week', 'all'] as const)
      expect(published[period].rows).toEqual([{ alias, score: 500 }]);
  });
  it('retries a concurrent player correction even when its leaderboard CAS digest did not change', async () => {
    const alias = await playerAlias(config, '123');
    const board = empty(); board.all.rows = [{ alias, score: 500 }];
    const stale = { ...newPlayer(), highScore: 900 };
    const corrected = { ...stale, highScore: 500 };
    const request = vi.fn().mockResolvedValueOnce(loaded(board, 'c'.repeat(64), stale))
      .mockResolvedValueOnce(response({ metafieldsSet: { userErrors: [{ code: 'INVALID_COMPARE_DIGEST' }] } }))
      .mockResolvedValueOnce(loaded(board, 'c'.repeat(64), corrected, 'e'.repeat(64)));
    await updateRanking(config, '123', stale, request, now);
    // The old board digest could still match after an admin saves an already
    // correct 500-point board. The player guard prevents publishing stale 900.
    expect(request).toHaveBeenCalledTimes(3);
    const attempted = JSON.parse(request.mock.calls[1][1].body).variables.metafields;
    expect(attempted).toHaveLength(2);
    expect(attempted[0].compareDigest).toBe('c'.repeat(64));
    expect(attempted[1]).toMatchObject({ key: 'player_v1', compareDigest: 'd'.repeat(64), value: JSON.stringify(stale) });
    const retryRead = JSON.parse(request.mock.calls[2][1].body);
    expect(retryRead.query).toContain('customer');
    expect(retryRead.query).not.toContain('metafieldsSet');
  });
  it('fails closed if the saved player cannot be read instead of publishing a stale caller score', async () => {
    const request = vi.fn().mockResolvedValue(loaded(empty()));
    await expect(updateRanking(config, '123', { ...newPlayer(), highScore: 900 }, request, now))
      .rejects.toMatchObject({ status: 502, code: 'invalid_ranking_player' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('requires signed identity, a known period, and fails honestly when unconfigured', async () => {
    const request = vi.fn();
    expect((await handleRankingRequest('GET', signed(), null, request, now)).status).toBe(503);
    expect((await handleRankingRequest('GET', signed() + 'x', config, request, now)).status).toBe(401);
    expect((await handleRankingRequest('GET', signed('forever'), config, request, now)).status).toBe(400);
    expect((await handleRankingRequest('POST', signed(), config, request, now)).status).toBe(405);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('administrative highscore corrections', () => {
  const alias = 'a'.repeat(16), other = 'b'.repeat(16);
  function existing() {
    const board = empty();
    board.day.rows = [{ alias, score: 800, name: 'Dario' }, { alias: other, score: 600, name: 'Alex' }];
    board.week.rows = [{ alias, score: 900, name: 'Dario' }, { alias: other, score: 600, name: 'Alex' }];
    board.all.rows = [{ alias, score: 1000, name: 'Dario' }, { alias: other, score: 600, name: 'Alex' }];
    return board;
  }
  it('replaces a lifetime record downward and caps existing period rows while preserving other riders and names', () => {
    const board = existing();
    const corrected = correctRankingHighScore(board, alias, 500, now);
    for (const period of ['day', 'week', 'all'] as const)
      expect(corrected[period].rows).toEqual([{ alias: other, score: 600, name: 'Alex' }, { alias, score: 500, name: 'Dario' }]);
    expect(board.all.rows[0].score).toBe(1000);
  });
  it('raises only the lifetime record without inventing period scores', () => {
    const corrected = correctRankingHighScore(existing(), alias, 1200, now);
    expect(corrected.all.rows[0]).toEqual({ alias, score: 1200, name: 'Dario' });
    expect(corrected.day.rows[0].score).toBe(800);
    expect(corrected.week.rows[0].score).toBe(900);
    const fresh = correctRankingHighScore(empty(), alias, 1200, now);
    expect(fresh.all.rows).toEqual([{ alias, score: 1200 }]);
    expect(fresh.day.rows).toEqual([]);
    expect(fresh.week.rows).toEqual([]);
  });
  it('removes every row belonging to a rider when their highscore is reset to zero', () => {
    const corrected = correctRankingHighScore(existing(), alias, 0, now);
    for (const period of ['day', 'week', 'all'] as const)
      expect(corrected[period].rows).toEqual([{ alias: other, score: 600, name: 'Alex' }]);
  });
  it('keeps the best 50 sorted lifetime rows after inserting a corrected record', () => {
    const board = empty();
    board.all.rows = Array.from({ length: 50 }, (_, index) => ({ alias: (index + 1).toString(16).padStart(16, '0'), score: 1000 - index }));
    const corrected = correctRankingHighScore(board, alias, 975, now);
    expect(corrected.all.rows).toHaveLength(50);
    expect(corrected.all.rows.find(row => row.alias === alias)?.score).toBe(975);
    expect(corrected.all.rows.at(-1)?.score).toBe(952);
    expect(corrected.all.rows.map(row => row.score)).toEqual(corrected.all.rows.map(row => row.score).sort((a, b) => b - a));
  });
  it('rolls expired UTC day and week rows forward without backfilling them from a lifetime edit', () => {
    const board = existing();
    board.day.key = '2026-10-04'; board.week.key = '2026-09-28';
    const corrected = correctRankingHighScore(board, alias, 1200, now);
    expect(corrected.day).toEqual({ key: '2026-10-05', rows: [] });
    expect(corrected.week).toEqual({ key: '2026-10-05', rows: [] });
    expect(corrected.all.rows[0]).toEqual({ alias, score: 1200, name: 'Dario' });
  });
});
