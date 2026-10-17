import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { newPlayer } from '../app/domain/progression';
import type { Player } from '../app/domain/types';
import { handleDashboardPlayers } from '../server/oxygen/adminManagement';
import { createCsrf, type ShopifyConfig } from '../server/shopify/auth';
import { acknowledgeCustomerGifts, GIFT_KEY, sendCustomerGift } from '../server/shopify/giftStore';
import { handlePlayerRequest, type PlayerRequest } from '../server/shopify/playerEndpoint';
import { PLAYER_KEY, PLAYER_NAMESPACE } from '../server/shopify/playerStore';

const now = Date.UTC(2026, 9, 16, 12);
const config: ShopifyConfig = { shop: 'gift-tests.myshopify.com', clientId: 'gift-tests-client',
  secret: 'gift-tests-secret', adminToken: 'gift-tests-admin-token' };
const customerId = '77', ownerId = `gid://shopify/Customer/${customerId}`;
const identity = { shop: config.shop, customerId };
const origin = 'https://game.example';
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const gift = (n = 1, kind: 'coins' | 'guardianBells' = 'coins', amount = 100) =>
  ({ id: uuid(n), kind, amount, message: 'Danke fürs Mitfahren!' });
interface GiftEntry {
  id: string;
  kind: 'coins' | 'guardianBells';
  amount: number;
  message: string;
  sentAt: string;
  actor: string;
  acknowledged: boolean;
}
interface GiftLedger { version: 1; entries: GiftEntry[] }
interface StoredField { value: string; compareDigest: string }
interface SetField { ownerId: string; namespace: string; key: string; value: string; compareDigest: string | null }
const entry = (n: number, acknowledged = false): GiftEntry => ({ ...gift(n, 'coins', 1),
  sentAt: new Date(now).toISOString(), actor: '12345', acknowledged });
const savedPlayer = (): Player => ({ ...newPlayer(), id: `shopify:${customerId}`, coins: 500,
  guardianBells: { earned: 7, spent: 2, spentRunIds: ['previously-used-run', 'second-used-run'] } });
const json = (data: unknown) => Response.json({ data });

/** Model Shopify's atomic metafieldsSet: every compareDigest must match before
 * either value changes. Query snapshots are copied before awaiting a barrier. */
function shopify(initialPlayer: Player | null = savedPlayer(), initialLedger: GiftLedger | null = null,
  options: { firstReadBarrier?: number; forcedConflicts?: number } = {}) {
  const fields = new Map<string, StoredField>();
  let revision = 1, queries = 0, conflicts = 0, remainingConflicts = options.forcedConflicts ?? 0;
  const digest = () => (revision++).toString(16).padStart(64, '0');
  if (initialPlayer) fields.set(PLAYER_KEY, { value: JSON.stringify(initialPlayer), compareDigest: digest() });
  if (initialLedger) fields.set(GIFT_KEY, { value: JSON.stringify(initialLedger), compareDigest: digest() });
  let release: (() => void) | undefined;
  const barrier = options.firstReadBarrier ? new Promise<void>(resolve => { release = resolve; }) : undefined;
  const mutations: SetField[][] = [];
  const request = vi.fn<typeof fetch>(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/oauth/access_token')) return Response.json({ access_token: 'gift-tests-admin-token', expires_in: 7200, scope: 'write_customers' });
    if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
    const { query, variables } = JSON.parse(init.body) as {
      query: string; variables: Record<string, unknown>;
    };
    if (query.trimStart().startsWith('query')) {
      const player = fields.get(PLAYER_KEY), gifts = fields.get(GIFT_KEY);
      const snapshot = { id: ownerId, emailMarketingConsent: { marketingState: 'SUBSCRIBED' },
        metafield: player ? { ...player } : null, player: player ? { ...player } : null,
        game: player ? { ...player } : null, gifts: gifts ? { ...gifts } : null, audit: null };
      queries++;
      if (barrier && queries <= options.firstReadBarrier!) {
        if (queries === options.firstReadBarrier) release!();
        await barrier;
      }
      return json({ customer: snapshot });
    }
    const updates = (variables.metafields ?? variables.fields) as SetField[];
    if (!Array.isArray(updates) || !updates.length) throw new Error('Expected metafieldsSet inputs');
    mutations.push(structuredClone(updates));
    const stale = updates.some(field => field.compareDigest !== (fields.get(field.key)?.compareDigest ?? null));
    if (stale || remainingConflicts > 0) {
      remainingConflicts = Math.max(0, remainingConflicts - 1);
      conflicts++;
      return json({ metafieldsSet: { metafields: [], userErrors: [{ code: 'STALE_OBJECT' }] } });
    }
    for (const field of updates) {
      if (field.ownerId !== ownerId || field.namespace !== PLAYER_NAMESPACE)
        throw new Error('Unexpected customer or namespace');
    }
    const result = updates.map(field => {
      const compareDigest = digest();
      fields.set(field.key, { value: field.value, compareDigest });
      return { key: field.key, compareDigest };
    });
    return json({ metafieldsSet: { metafields: result, userErrors: [] } });
  });
  return { request, fields, mutations, conflicts: () => conflicts,
    player: () => JSON.parse(fields.get(PLAYER_KEY)!.value) as Player,
    ledger: () => JSON.parse(fields.get(GIFT_KEY)!.value) as GiftLedger };
}

function playerRequest(body?: unknown): PlayerRequest {
  return { method: body === undefined ? 'GET' : 'POST', url: `${origin}/api/player`,
    contentType: 'application/json', readBody: async () => body };
}
function dependencies(request: typeof fetch) {
  return { config, request, now: () => now, authenticate: async () => identity };
}
const csrf = () => createCsrf(identity, config.secret, now);
async function staffRequest(body: unknown, staffId = '12345') {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const claims = encode({ aud: config.clientId, dest: `https://${config.shop}`, iss: `https://${config.shop}/admin`,
    sub: staffId, iat: now / 1000, nbf: now / 1000, exp: now / 1000 + 60 });
  const signature = createHmac('sha256', config.secret).update(`${header}.${claims}`).digest('base64url');
  return new Request(`${origin}/api/admin/players`, { method: 'POST',
    headers: { Authorization: `Bearer ${header}.${claims}.${signature}`, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body) });
}

describe('authenticated admin player gifts', () => {
  it('blocks missing tokens and non-allowlisted staff before contacting Shopify', async () => {
    const backend = shopify();
    const body = { id: customerId, field: 'gift', value: gift() };
    const missing = new Request(`${origin}/api/admin/players`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await handleDashboardPlayers(missing, config, backend.request, '12345', now)).status).toBe(401);
    expect((await handleDashboardPlayers(await staffRequest(body, '999'), config, backend.request, '12345', now)).status).toBe(403);
    expect(backend.request).not.toHaveBeenCalled();
  });

  it('credits a gift only for allowlisted staff and records the verified actor', async () => {
    const backend = shopify();
    const response = await handleDashboardPlayers(await staffRequest({ id: customerId, field: 'gift', value: gift() }),
      config, backend.request, '12345', now);
    expect(response.status).toBe(200);
    expect(backend.player().coins).toBe(600);
    expect(backend.ledger().entries).toEqual([{ ...gift(), sentAt: new Date(now).toISOString(), actor: '12345', acknowledged: false }]);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it.each([
    { id: 'not-a-uuid' }, { kind: 'xp' }, { amount: 0 }, { amount: -1 }, { amount: 1.5 },
    { amount: 2001 }, { kind: 'guardianBells', amount: 6 }, { message: 'x'.repeat(81) },
    { actor: 'forged-staff' },
  ])('rejects an invalid gift before reading or writing customer data: %j', async changes => {
    const backend = shopify();
    await expect(sendCustomerGift(config, customerId, { ...gift(), ...changes }, '12345', backend.request, now))
      .rejects.toMatchObject({ status: 400 });
    expect(backend.request).not.toHaveBeenCalled();
  });
});

describe('atomic and idempotent gift delivery', () => {
  it('creates a durable credited player for a recipient who has never saved the game', async () => {
    const backend = shopify(null);
    await sendCustomerGift(config, customerId, gift(), '12345', backend.request, now);
    expect(backend.player()).toMatchObject({ id: `shopify:${customerId}`, coins: newPlayer().coins + 100 });
    expect(backend.ledger().entries).toHaveLength(1);
    expect(backend.mutations[0].every(field => field.compareDigest === null)).toBe(true);
  });

  it.each([
    { recipient: 'legacy zero-wallet player', initialPlayer: { ...savedPlayer(), guardianBells: { earned: 0, spent: 0, spentRunIds: [] } } },
    { recipient: 'never-saved player', initialPlayer: null },
  ])('preserves one starter Bell when gifting a $recipient, through retry and the next save', async ({ initialPlayer }) => {
    const backend = shopify(initialPlayer, null, { forcedConflicts: 1 });
    const sent = gift(1, 'guardianBells', 2);
    await sendCustomerGift(config, customerId, sent, '12345', backend.request, now);
    expect(backend.conflicts()).toBe(1);
    expect(backend.player().guardianBells).toEqual({ earned: 3, spent: 0, spentRunIds: [] });
    expect(backend.player().coins).toBe(initialPlayer?.coins ?? newPlayer().coins);
    const replay = await sendCustomerGift(config, customerId, sent, '12345', backend.request, now);
    expect(replay.duplicate).toBe(true);
    const result = await handlePlayerRequest(playerRequest({ player: backend.player(),
      compareDigest: backend.fields.get(PLAYER_KEY)!.compareDigest, csrfToken: await csrf() }), dependencies(backend.request));
    expect(result.status).toBe(200);
    expect(backend.player().guardianBells).toEqual({ earned: 3, spent: 0, spentRunIds: [] });
    await sendCustomerGift(config, customerId, gift(2, 'guardianBells', 2), '12345', backend.request, now);
    expect(backend.player().guardianBells).toEqual({ earned: 5, spent: 0, spentRunIds: [] });
    expect(backend.ledger().entries).toHaveLength(2);
  });

  it('adds coins and Bells to the existing wallets while preserving progress and debit receipts', async () => {
    const original = savedPlayer(), backend = shopify(original);
    await sendCustomerGift(config, customerId, gift(1, 'coins', 2000), '12345', backend.request, now);
    await sendCustomerGift(config, customerId, gift(2, 'guardianBells', 5), '12345', backend.request, now);
    expect(backend.player()).toEqual({ ...original, coins: original.coins + 2000,
      guardianBells: { ...original.guardianBells, earned: original.guardianBells.earned + 5 } });
    expect(backend.mutations).toHaveLength(2);
    for (const mutation of backend.mutations) {
      expect(mutation.map(field => field.key).sort((left, right) => left.localeCompare(right)))
        .toEqual([GIFT_KEY, PLAYER_KEY].sort((left, right) => left.localeCompare(right)));
      expect(mutation.every(field => Object.hasOwn(field, 'compareDigest'))).toBe(true);
    }
    expect(backend.ledger()).toMatchObject({ version: 1, entries: [{ id: uuid(1) }, { id: uuid(2) }] });
  });

  it('replays the same ID exactly once and refuses a changed payload for that ID', async () => {
    const backend = shopify();
    const first = await sendCustomerGift(config, customerId, gift(), '12345', backend.request, now);
    const repeated = await sendCustomerGift(config, customerId, gift(), '12345', backend.request, now + 1000);
    expect(first.duplicate).toBe(false);
    expect(repeated.duplicate).toBe(true);
    expect(backend.player().coins).toBe(600);
    expect(backend.ledger().entries).toHaveLength(1);
    expect(backend.mutations).toHaveLength(1);
    for (const changes of [{ amount: 101 }, { kind: 'guardianBells', amount: 1 }, { message: 'Different gift' }]) {
      await expect(sendCustomerGift(config, customerId, { ...gift(), ...changes }, '12345', backend.request, now))
        .rejects.toMatchObject({ status: 409, code: 'gift_id_conflict' });
    }
    expect(backend.player().coins).toBe(600);
    expect(backend.mutations).toHaveLength(1);
  });

  it('retries a conflicting atomic write without crediting a rejected attempt', async () => {
    const backend = shopify(savedPlayer(), null, { forcedConflicts: 1 });
    await sendCustomerGift(config, customerId, gift(), '12345', backend.request, now);
    expect(backend.conflicts()).toBe(1);
    expect(backend.mutations).toHaveLength(2);
    expect(backend.player().coins).toBe(600);
    expect(backend.ledger().entries).toHaveLength(1);
  });

  it('fails with no wallet or ledger change after its bounded conflict retries', async () => {
    const original = savedPlayer(), backend = shopify(original, null, { forcedConflicts: 10 });
    await expect(sendCustomerGift(config, customerId, gift(), '12345', backend.request, now))
      .rejects.toMatchObject({ status: 409 });
    expect(backend.player()).toEqual(original);
    expect(backend.fields.has(GIFT_KEY)).toBe(false);
    expect(backend.mutations.length).toBeGreaterThanOrEqual(3);
    expect(backend.mutations.length).toBeLessThanOrEqual(4);
  });

  it('retains both gifts when two sends start from the same customer revision', async () => {
    const backend = shopify(savedPlayer(), null, { firstReadBarrier: 2 });
    await Promise.all([
      sendCustomerGift(config, customerId, gift(1, 'coins', 100), '12345', backend.request, now),
      sendCustomerGift(config, customerId, gift(2, 'guardianBells', 3), '12345', backend.request, now),
    ]);
    expect(backend.conflicts()).toBeGreaterThan(0);
    expect(backend.player().coins).toBe(600);
    expect(backend.player().guardianBells).toEqual({ ...savedPlayer().guardianBells, earned: 10 });
    expect(backend.ledger().entries.map(value => value.id).sort((left, right) => left.localeCompare(right))).toEqual([uuid(1), uuid(2)]);
  });

  it('credits a concurrent retry of the same ID once', async () => {
    const backend = shopify(savedPlayer(), null, { firstReadBarrier: 2 });
    const results = await Promise.all([
      sendCustomerGift(config, customerId, gift(), '12345', backend.request, now),
      sendCustomerGift(config, customerId, gift(), '12345', backend.request, now),
    ]);
    expect(results.map(result => result.duplicate).sort((left, right) => Number(left) - Number(right))).toEqual([false, true]);
    expect(backend.player().coins).toBe(600);
    expect(backend.ledger().entries).toHaveLength(1);
  });

  it.each([
    { kind: 'coins' as const, player: { ...savedPlayer(), coins: 1e12 } },
    { kind: 'guardianBells' as const, player: { ...savedPlayer(),
      guardianBells: { ...savedPlayer().guardianBells, earned: 1_000_000 } } },
  ])('refuses a $kind credit beyond the wallet limit without a receipt', async ({ kind, player }) => {
    const backend = shopify(player);
    await expect(sendCustomerGift(config, customerId, gift(1, kind, 1), '12345', backend.request, now))
      .rejects.toMatchObject({ status: 409, code: 'gift_balance_limit' });
    expect(backend.player()).toEqual(player);
    expect(backend.fields.has(GIFT_KEY)).toBe(false);
    expect(backend.mutations).toHaveLength(0);
  });

  it('fails closed on corrupt persisted receipts rather than treating them as an empty history', async () => {
    const backend = shopify();
    backend.fields.set(GIFT_KEY, { value: '{broken-json', compareDigest: 'f'.repeat(64) });
    await expect(sendCustomerGift(config, customerId, gift(), '12345', backend.request, now))
      .rejects.toMatchObject({ status: 502, code: 'invalid_gift_ledger' });
    expect((await handlePlayerRequest(playerRequest(), dependencies(backend.request))).status).toBe(502);
    expect(backend.player().coins).toBe(500);
    expect(backend.mutations).toHaveLength(0);
  });

  it('rejects a stale player sync after a send, preserving both trusted wallets', async () => {
    const original = savedPlayer(), backend = shopify(original);
    const staleDigest = backend.fields.get(PLAYER_KEY)!.compareDigest;
    await sendCustomerGift(config, customerId, gift(1, 'guardianBells', 2), '12345', backend.request, now);
    const sync = await handlePlayerRequest(playerRequest({ player: { ...original, xp: 100 },
      compareDigest: staleDigest, csrfToken: await csrf() }), dependencies(backend.request));
    expect(sync.status).toBe(409);
    expect(backend.player()).toEqual({ ...original,
      guardianBells: { ...original.guardianBells, earned: original.guardianBells.earned + 2 } });
  });

  it('preserves a concurrent normal save or rejects it cleanly while delivering the gift once', async () => {
    const original = savedPlayer(), backend = shopify(original, null, { firstReadBarrier: 2 });
    const compareDigest = backend.fields.get(PLAYER_KEY)!.compareDigest, csrfToken = await csrf();
    const [, sync] = await Promise.all([
      sendCustomerGift(config, customerId, gift(), '12345', backend.request, now),
      handlePlayerRequest(playerRequest({ player: { ...original, xp: 100 }, compareDigest, csrfToken }), dependencies(backend.request)),
    ]);
    expect([200, 409]).toContain(sync.status);
    expect(backend.player().coins).toBe(600);
    expect(backend.player().guardianBells).toEqual(original.guardianBells);
    expect(backend.player().xp).toBe(sync.status === 200 ? 100 : original.xp);
    expect(backend.ledger().entries).toHaveLength(1);
  });

  it('refuses a full history without dropping old IDs or permitting old gifts to credit again', async () => {
    const entries = Array.from({ length: 500 }, (_, i) => entry(i + 1, true));
    const original = savedPlayer(), backend = shopify(original, { version: 1, entries });
    await expect(sendCustomerGift(config, customerId, gift(501), '12345', backend.request, now))
      .rejects.toMatchObject({ status: 409, code: 'gift_history_full' });
    const replay = await sendCustomerGift(config, customerId, gift(1, 'coins', 1), '12345', backend.request, now);
    expect(replay.duplicate).toBe(true);
    expect(backend.player()).toEqual(original);
    expect(backend.ledger().entries).toEqual(entries);
    expect(backend.mutations).toHaveLength(0);
  });
});

describe('offline gift notifications and acknowledgments', () => {
  it('retains a newly sent gift while an older notification is acknowledged concurrently', async () => {
    const original = savedPlayer(), backend = shopify(original, { version: 1, entries: [entry(1)] }, { firstReadBarrier: 2 });
    await Promise.all([
      acknowledgeCustomerGifts(config, customerId, [uuid(1)], backend.request),
      sendCustomerGift(config, customerId, gift(2), '12345', backend.request, now),
    ]);
    expect(backend.ledger().entries.map(value => ({ id: value.id, acknowledged: value.acknowledged })))
      .toEqual([{ id: uuid(1), acknowledged: true }, { id: uuid(2), acknowledged: false }]);
    expect(backend.player()).toEqual({ ...original, coins: original.coins + 100 });
  });

  it('keeps a pending notification across repeated GETs and makes an acknowledgment durable without another credit', async () => {
    const backend = shopify();
    await sendCustomerGift(config, customerId, gift(), '12345', backend.request, now);
    for (let repeat = 0; repeat < 3; repeat++) {
      const result = await handlePlayerRequest(playerRequest(), dependencies(backend.request));
      expect(result.status).toBe(200);
      expect(result.body.gifts).toEqual([{ ...gift(), sentAt: new Date(now).toISOString() }]);
      expect(result.body.player).toMatchObject({ coins: 600 });
    }
    expect(backend.mutations).toHaveLength(1);
    const body = { acknowledgedGiftIds: [uuid(1)], csrfToken: await csrf() };
    const beforeAck = backend.fields.get(PLAYER_KEY);
    expect((await handlePlayerRequest(playerRequest(body), dependencies(backend.request))).status).toBe(200);
    expect(backend.ledger().entries[0].acknowledged).toBe(true);
    expect(backend.fields.get(PLAYER_KEY)).toEqual(beforeAck);
    expect(backend.mutations[1].map(field => field.key)).toEqual([GIFT_KEY]);
    expect((await handlePlayerRequest(playerRequest(body), dependencies(backend.request))).status).toBe(200);
    const next = await handlePlayerRequest(playerRequest(), dependencies(backend.request));
    expect(next.body.gifts).toEqual([]);
    expect(backend.player().coins).toBe(600);
    expect(backend.mutations).toHaveLength(2);
  });

  it('returns at most twenty pending gifts and exposes the next batch after acknowledging those IDs', async () => {
    const entries = Array.from({ length: 24 }, (_, i) => entry(i + 1));
    const original = savedPlayer(), backend = shopify(original, { version: 1, entries });
    const first = await handlePlayerRequest(playerRequest(), dependencies(backend.request));
    const pending = first.body.gifts as { id: string }[];
    expect(pending).toHaveLength(20);
    await acknowledgeCustomerGifts(config, customerId, pending.map(value => value.id), backend.request);
    const second = await handlePlayerRequest(playerRequest(), dependencies(backend.request));
    const remaining = second.body.gifts as { id: string }[];
    expect(remaining).toHaveLength(4);
    expect(remaining.every(value => !pending.some(seen => seen.id === value.id))).toBe(true);
    expect(backend.player()).toEqual(original);
  });

  it('requires customer authentication and CSRF even for acknowledgment-only requests', async () => {
    const backend = shopify(savedPlayer(), { version: 1, entries: [entry(1)] });
    const unauthorized = await handlePlayerRequest(playerRequest({ acknowledgedGiftIds: [uuid(1)], csrfToken: await csrf() }),
      { ...dependencies(backend.request), authenticate: undefined });
    expect(unauthorized.status).toBe(401);
    const rejected = await handlePlayerRequest(playerRequest({ acknowledgedGiftIds: [uuid(1)], csrfToken: 'forged' }), dependencies(backend.request));
    expect(rejected.status).toBe(403);
    expect(backend.request).not.toHaveBeenCalled();
  });

  it.each([{ ids: ['not-a-uuid'] }, { ids: Array.from({ length: 21 }, (_, i) => uuid(i + 1)) }])
    ('rejects invalid or oversized acknowledgment batches', async ({ ids }) => {
      const backend = shopify();
      await expect(acknowledgeCustomerGifts(config, customerId, ids, backend.request)).rejects.toMatchObject({ status: 400 });
      expect(backend.request).not.toHaveBeenCalled();
    });

  it('never lets browser gift payloads create a credit or a trusted ledger entry', async () => {
    const backend = shopify(), original = backend.player(), compareDigest = backend.fields.get(PLAYER_KEY)!.compareDigest;
    const csrfToken = await csrf();
    for (const body of [
      { gift: gift(), csrfToken },
      { acknowledgedGiftIds: [uuid(1)], gift: gift(), csrfToken },
      { player: { ...original, gifts: [gift()] }, compareDigest, csrfToken },
      { player: { ...original, guardianBells: { ...original.guardianBells, earned: 1000 } }, compareDigest, csrfToken },
    ]) {
      expect((await handlePlayerRequest(playerRequest(body), dependencies(backend.request))).status).toBe(400);
    }
    await expect(acknowledgeCustomerGifts(config, customerId, [uuid(999)], backend.request))
      .rejects.toMatchObject({ status: 400 });
    expect(backend.player()).toEqual(original);
    expect(backend.fields.has(GIFT_KEY)).toBe(false);
    expect(backend.mutations).toHaveLength(0);
  });
});
