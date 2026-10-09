import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { newPlayer } from '../app/domain/progression';
import { handleRankingRequest, mergeRanking, playerAlias, rankingWindows, updateRanking, type Board } from '../server/shopify/leaderboard';

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
const loaded = (board: Board | null, digest: string | null = null) => response({ shop: { id: 'gid://shopify/Shop/7', metafield: board ? { value: JSON.stringify(board), compareDigest: digest ?? 'a'.repeat(64) } : null } });
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
    const request = vi.fn().mockResolvedValue(loaded(advanced));
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
    const request = vi.fn().mockResolvedValueOnce(loaded(null))
      .mockResolvedValueOnce(response({ metafieldsSet: { userErrors: [{ code: 'INVALID_COMPARE_DIGEST' }] } }))
      .mockResolvedValueOnce(loaded(other, 'c'.repeat(64)))
      .mockResolvedValueOnce(response({ metafieldsSet: { userErrors: [] } }));
    const player = newPlayer(); player.highScore = 99;
    await updateRanking(config, '123', player, request, now);
    const first = JSON.parse(request.mock.calls[1][1].body).variables.metafields[0];
    const retry = JSON.parse(request.mock.calls[3][1].body).variables.metafields[0];
    expect(first.compareDigest).toBeNull(); expect(retry.compareDigest).toBe('c'.repeat(64));
    expect(JSON.parse(retry.value).all.rows).toHaveLength(2);
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
