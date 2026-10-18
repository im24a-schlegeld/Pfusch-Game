import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { newPlayer } from '../app/domain/progression';
import { handleDashboardPlayers } from '../server/oxygen/adminManagement';
import { playerAlias, rankingWindows, type Board } from '../server/shopify/leaderboard';
import { PLAYER_NAMESPACE } from '../server/shopify/playerStore';
import type { ShopifyConfig } from '../server/shopify/auth';

const now = Date.parse('2026-10-05T12:00:00Z');
const config: ShopifyConfig = { shop: 'admin-highscore-tests.myshopify.com', clientId: 'test-admin-app-key',
  secret: 'local-highscore-test-secret', adminToken: 'test-only-token' };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function token() {
  const head = encode({ typ: 'JWT', alg: 'HS256' });
  const body = encode({ aud: config.clientId, dest: `https://${config.shop}`, iss: `https://${config.shop}/admin`,
    sub: '12345', iat: now / 1000, nbf: now / 1000, exp: now / 1000 + 60 });
  return `${head}.${body}.${createHmac('sha256', config.secret).update(`${head}.${body}`).digest('base64url')}`;
}
function edit(value: number) {
  return new Request('https://game.invalid/api/admin/players', { method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: '77', field: 'highScore', value }) });
}
interface MetafieldInput { ownerId: string; namespace: string; key: string; type: string; value: string; compareDigest: string | null }
async function fixture(errors: { code: string }[] = []) {
  const alias = await playerAlias(config, '77');
  const other = 'b'.repeat(16), keys = rankingWindows(now);
  const board: Board = { version: 1,
    day: { key: keys.day, rows: [{ alias, score: 800, name: 'Dario' }, { alias: other, score: 600, name: 'Alex' }] },
    week: { key: keys.week, rows: [{ alias, score: 900, name: 'Dario' }, { alias: other, score: 600, name: 'Alex' }] },
    all: { key: 'all', rows: [{ alias, score: 1000, name: 'Dario' }, { alias: other, score: 600, name: 'Alex' }] } };
  const player = { ...newPlayer(), leaderboardName: 'Dario', highScore: 1000,
    history: [{ date: keys.day, score: 900 }] };
  const mutations: MetafieldInput[][] = [];
  const request = vi.fn<typeof fetch>(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/oauth/access_token')) return Response.json({
      access_token: 'test-only-token', expires_in: 7200, scope: 'write_customers,write_discounts',
    });
    if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
    const body = JSON.parse(init.body) as { query: string; variables: { fields?: MetafieldInput[]; metafields?: MetafieldInput[] } };
    if (body.query.includes('metafieldsSet')) {
      mutations.push(body.variables.fields ?? body.variables.metafields ?? []);
      return Response.json({ data: { metafieldsSet: { userErrors: errors, metafields: [] } } });
    }
    return Response.json({ data: {
      customer: { id: 'gid://shopify/Customer/77', game: { value: JSON.stringify(player), compareDigest: 'a'.repeat(64) },
        audit: { value: '[]', compareDigest: 'b'.repeat(64) }, metafield: { value: JSON.stringify(player) } },
      shop: { id: 'gid://shopify/Shop/7', metafield: { value: JSON.stringify(board), compareDigest: 'c'.repeat(64) } },
    } });
  });
  return { alias, other, player, request, mutations };
}

describe('authenticated dashboard highscore correction', () => {
  it.each([500, 1200, 0])('atomically saves player, audit and exact leaderboard correction for %s points', async value => {
    const { alias, other, request, mutations } = await fixture();
    const result = await handleDashboardPlayers(edit(value), config, request, '12345', now);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ changed: 'highScore', value });
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toHaveLength(3);
    const fields = new Map(mutations[0].map(field => [field.key, field]));
    expect([...fields.keys()].sort()).toEqual(['dashboard_audit_v1', 'leaderboard_v1', 'player_v1']);
    const saved = fields.get('player_v1')!, audit = fields.get('dashboard_audit_v1')!, ranking = fields.get('leaderboard_v1')!;
    expect(saved).toMatchObject({ ownerId: 'gid://shopify/Customer/77', namespace: PLAYER_NAMESPACE, compareDigest: 'a'.repeat(64) });
    expect(JSON.parse(saved.value).highScore).toBe(value);
    expect(audit).toMatchObject({ ownerId: 'gid://shopify/Customer/77', compareDigest: 'b'.repeat(64) });
    expect(JSON.parse(audit.value)).toEqual([{ at: new Date(now).toISOString(), actor: '12345', field: 'highScore', before: 1000, after: value }]);
    expect(ranking).toMatchObject({ ownerId: 'gid://shopify/Shop/7', namespace: PLAYER_NAMESPACE, type: 'json', compareDigest: 'c'.repeat(64) });
    const board = JSON.parse(ranking.value) as Board;
    expect(board.all.rows.find(row => row.alias === alias)).toEqual(value ? { alias, score: value, name: 'Dario' } : undefined);
    for (const period of ['day', 'week', 'all'] as const)
      expect(board[period].rows.find(row => row.alias === other)).toEqual({ alias: other, score: 600, name: 'Alex' });
    expect(board.day.rows.find(row => row.alias === alias)?.score).toBe(800);
    expect(board.week.rows.find(row => row.alias === alias)?.score).toBe(900);
  });
  it('returns a conflict for the whole atomic edit when the leaderboard CAS digest changed', async () => {
    const { request, mutations } = await fixture([{ code: 'INVALID_COMPARE_DIGEST' }]);
    const result = await handleDashboardPlayers(edit(500), config, request, '12345', now);
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({ error: 'edit_conflict_reload' });
    expect(mutations).toHaveLength(1);
    expect(mutations[0].map(field => field.key).sort()).toEqual(['dashboard_audit_v1', 'leaderboard_v1', 'player_v1']);
  });
  it('rejects a valid staff token outside the editor allowlist before any read or write', async () => {
    const request = vi.fn<typeof fetch>();
    expect((await handleDashboardPlayers(edit(500), config, request, '777', now)).status).toBe(403);
    expect(request).not.toHaveBeenCalled();
  });
});
