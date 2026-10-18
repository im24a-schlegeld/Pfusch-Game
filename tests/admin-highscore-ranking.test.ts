import { describe, expect, it, vi } from 'vitest';
import { newPlayer } from '../app/domain/progression';
import { playerAlias, rankingWindows } from '../server/shopify/leaderboard';
import { handleDashboardPlayers } from '../server/oxygen/adminManagement';
import type { ShopifyConfig } from '../server/shopify/auth';

const config: ShopifyConfig = { shop: 'pfusch-test.myshopify.com', clientId: 'test-admin-app',
  secret: 'test-only-secret' };
const now = Date.parse('2026-10-17T18:00:00Z');
const b64 = (data: unknown) => Buffer.from(JSON.stringify(data)).toString('base64url');
async function staffToken() {
  const sec = Math.floor(now / 1000);
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ aud: config.clientId, dest: 'https://' + config.shop,
    iss: 'https://' + config.shop + '/admin', sub: '12345', iat: sec, nbf: sec, exp: sec + 60 });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(config.secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(header + '.' + body));
  return header + '.' + body + '.' + Buffer.from(signed).toString('base64url');
}
const digest = 'a'.repeat(64);
const response = (data: unknown) => Response.json({ data });
function fieldValue(field: Record<string, unknown>) {
  if (typeof field.value !== 'string') throw new Error('Expected a JSON metafield value');
  return field.value;
}
function board(alias: string, allScore: number) {
  const windows = rankingWindows(now);
  return { version: 1, day: { key: windows.day, rows: [{ alias, score: 25 }] },
    week: { key: windows.week, rows: [{ alias, score: 60 }] },
    all: { key: 'all', rows: [{ alias, score: allScore, name: 'TEST RIDER' }] } };
}

async function edit(score: number, initialScore: number, conflict = false) {
  const alias = await playerAlias(config, '77');
  const oldBoard = board(alias, initialScore);
  const player = { ...newPlayer(), id: 'shopify:77', highScore: initialScore, leaderboardName: 'TEST RIDER' };
  const snapshots: { query: string; fields?: Record<string, unknown>[] }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const requestUrl = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (typeof init?.body !== 'string') throw new Error('Expected a string request body');
    // New Shopify apps authenticate every Admin API call through a token exchange.
    // The mock must return an OAuth token before GraphQL requests begin.
    if (requestUrl.endsWith('/admin/oauth/access_token')) {
      const form = new URLSearchParams(init.body);
      expect(form.get('client_id')).toBe(config.clientId);
      expect(form.get('grant_type')).toBe('client_credentials');
      return Response.json({ access_token: 'integration-admin-token', expires_in: 86399,
        scope: 'write_customers,write_app_proxy' });
    }
    expect(new Headers(init?.headers).get('X-Shopify-Access-Token')).toBe('integration-admin-token');
    const { query, variables } = JSON.parse(init.body) as {
      query: string; variables: Record<string, unknown>;
    };
    if (query.includes('query PfuschAdminEdit')) return response({ customer: {
      id: 'gid://shopify/Customer/77', game: { value: JSON.stringify(player), compareDigest: digest }, audit: null,
    } });
    if (query.includes('query GameRanking')) return response({ shop: {
      id: 'gid://shopify/Shop/7', metafield: { value: JSON.stringify(oldBoard), compareDigest: digest },
    } });
    if (query.includes('mutation PfuschAdminSave')) {
      snapshots.push({ query, fields: variables.fields as Record<string, unknown>[] });
      return response({ metafieldsSet: { metafields: [], userErrors: conflict ? [{ code: 'STALE_OBJECT' }] : [] } });
    }
    throw Error('unexpected GraphQL query: ' + query);
  });
  const result = await handleDashboardPlayers(new Request('https://example.test/api/admin/players', {
    method: 'POST', headers: { Authorization: 'Bearer ' + await staffToken(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: '77', field: 'highScore', value: score }),
  }), config, fetcher, '12345', now);
  return { result, snapshots, oldBoard, alias };
}

describe('admin highscore ranks atomically', () => {
  it('raises the exact all-time score in the same mutation as the player and audit', async () => {
    const { result, snapshots, oldBoard } = await edit(700, 100);
    expect(result.status, await result.clone().text()).toBe(200);
    expect(snapshots).toHaveLength(1);
    const fields = snapshots[0].fields!;
    expect(fields.map(f => f.key)).toEqual(['player_v1', 'dashboard_audit_v1', 'leaderboard_v1']);
    expect(JSON.parse(fieldValue(fields[0])).highScore).toBe(700);
    expect(JSON.parse(fieldValue(fields[2])).all.rows[0].score).toBe(700);
    expect(JSON.parse(fieldValue(fields[2])).day).toEqual(oldBoard.day);
    expect(JSON.parse(fieldValue(fields[2])).week).toEqual(oldBoard.week);
    expect(fields[2].compareDigest).toBe(digest);
  });
  it('allows authorized downgrades instead of preserving the prior maximum', async () => {
    const { result, snapshots } = await edit(20, 500);
    expect(result.status, await result.clone().text()).toBe(200);
    expect(JSON.parse(fieldValue(snapshots[0].fields![2])).all.rows[0].score).toBe(20);
  });
  it('removes a zeroed rider only from all-time, without inventing new day/week results', async () => {
    const { result, snapshots, oldBoard } = await edit(0, 500);
    expect(result.status, await result.clone().text()).toBe(200);
    const rewritten = JSON.parse(fieldValue(snapshots[0].fields![2]));
    expect(rewritten.all.rows).toEqual([]);
    expect(rewritten.day).toEqual(oldBoard.day);
    expect(rewritten.week).toEqual(oldBoard.week);
  });
  it('rejects a CAS collision for player, audit and ranking together', async () => {
    const { result, snapshots } = await edit(600, 500, true);
    expect(result.status, await result.clone().text()).toBe(409);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].fields).toHaveLength(3);
  });
});
