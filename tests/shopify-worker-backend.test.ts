import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { newPlayer } from '../app/domain/progression';
import { ApiError, createCsrf, verifyCsrf, type CustomerIdentity } from '../server/shopify/auth';
import { byteLength, hmacSha256, sha256, verifyHmacHex } from '../server/shopify/crypto';
import { readBoundedWebJson } from '../server/shopify/http';
import { handlePlayerRequest, type PlayerRequest } from '../server/shopify/playerEndpoint';
import { handleRankingRequest, playerAlias, rankingWindows } from '../server/shopify/leaderboard';
import { MAX_BODY_BYTES } from '../server/shopify/playerValidation';

const config = { shop: 'pfusch-test.myshopify.com', secret: 'worker-test-secret', adminToken: 'worker-test-token' };
const now = Date.parse('2026-10-07T12:00:00Z');
const identity = { shop: config.shop, customerId: '123' };
const digest = 'a'.repeat(64);
const json = (data: unknown) => new Response(JSON.stringify({ data }));
const input = (body?: unknown): PlayerRequest => ({ method: body === undefined ? 'GET' : 'POST',
  url: '/api/player?customerId=999&logged_in_customer_id=999&shop=attacker.myshopify.com',
  contentType: 'application/json', readBody: vi.fn(async () => body) });
const read = (marketingState = 'SUBSCRIBED') => json({ customer: { id: 'gid://shopify/Customer/123',
  emailMarketingConsent: { marketingState }, metafield: null } });
const body = async () => ({ player: { ...newPlayer(), id: 'browser-forged' }, compareDigest: null,
  csrfToken: await createCsrf(identity, config.secret, now) });
const dependencies = (request: typeof fetch) => ({ config, request, now: () => now,
  authenticate: vi.fn(async () => identity) });

describe('Portable server crypto', () => {
  it('preserves HMAC, digest, UTF-8 lengths and public pseudonyms across Node and Oxygen', async () => {
    const message = 'Grüezi 🏍️';
    const expected = createHmac('sha256', config.secret).update(message).digest('hex');
    expect(await hmacSha256(message, config.secret)).toBe(expected);
    expect(await sha256(message)).toBe(createHash('sha256').update(message).digest('hex'));
    expect(byteLength(message)).toBe(Buffer.byteLength(message));
    expect(await verifyHmacHex(expected.toUpperCase(), message, config.secret)).toBe(true);
    expect(await verifyHmacHex(expected, `${message}!`, config.secret)).toBe(false);
    expect(await verifyHmacHex('not-a-digest', message, config.secret)).toBe(false);
    expect(await playerAlias(config, '123')).toBe(createHmac('sha256', config.secret)
      .update(`pfusch-ranking-v1:${config.shop}:123`).digest('hex').slice(0, 16));
  });
  it('retains customer-bound, shop-bound, expiring CSRF with random nonces', async () => {
    const first = await createCsrf(identity, config.secret, now);
    expect(first).not.toBe(await createCsrf(identity, config.secret, now));
    await expect(verifyCsrf(first, identity, config.secret, now)).resolves.toBeUndefined();
    for (const wrong of [{ ...identity, customerId: '456' }, { ...identity, shop: 'other.myshopify.com' }])
      await expect(verifyCsrf(first, wrong, config.secret, now)).rejects.toMatchObject({ status: 403 });
    await expect(verifyCsrf(first, identity, config.secret, now + 900_000)).rejects.toMatchObject({ status: 403 });
  });
});

describe('Server-verified customer adapter', () => {
  it('reads and writes only the server-authenticated customer despite forged URL and player IDs', async () => {
    const request = vi.fn<typeof fetch>().mockImplementationOnce(async () => read())
      .mockImplementationOnce(async () => read())
      .mockImplementationOnce(async () => json({ metafieldsSet: { metafields: [{ compareDigest: digest }], userErrors: [] } }));
    const deps = dependencies(request);
    const loaded = await handlePlayerRequest(input(), deps);
    expect(loaded.status).toBe(200);
    expect(loaded.body.customer).toEqual({ id: '123' });
    const saved = await handlePlayerRequest(input(await body()), deps);
    expect(saved.status).toBe(200);
    expect(saved.body.player).toMatchObject({ id: 'shopify:123' });
    const getVariables = JSON.parse(request.mock.calls[0][1]!.body as string).variables;
    const saveVariables = JSON.parse(request.mock.calls[2][1]!.body as string).variables;
    expect(getVariables.id).toBe('gid://shopify/Customer/123');
    expect(saveVariables.metafields[0].ownerId).toBe('gid://shopify/Customer/123');
  });
  it('never interprets an unsigned URL as an identity if no server authenticator is supplied', async () => {
    const request = vi.fn<typeof fetch>();
    const result = await handlePlayerRequest(input(), { config, request, now: () => now });
    expect(result.status).toBe(401);
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    { shop: 'attacker.myshopify.com', customerId: '123' },
    { shop: config.shop, customerId: 'gid://shopify/Customer/123' },
    { shop: config.shop, customerId: '' },
  ])('rejects a malformed adapter identity before any customer read', async invalid => {
    const request = vi.fn<typeof fetch>();
    const result = await handlePlayerRequest(input(), { ...dependencies(request), authenticate: async () => invalid });
    expect(result.status).toBe(401);
    expect(request).not.toHaveBeenCalled();
  });
  it('propagates an unauthenticated server session without fallback', async () => {
    const request = vi.fn<typeof fetch>();
    const result = await handlePlayerRequest(input(), { ...dependencies(request), authenticate: async (): Promise<CustomerIdentity> => {
      throw new ApiError(401, 'unauthorized');
    } });
    expect(result.status).toBe(401);
    expect(request).not.toHaveBeenCalled();
  });
  it('still requires CSRF and disallows extra customer or marketing fields from the browser', async () => {
    const request = vi.fn<typeof fetch>();
    const valid = await body();
    expect((await handlePlayerRequest(input({ ...valid, csrfToken: '' }), dependencies(request))).status).toBe(403);
    expect((await handlePlayerRequest(input({ ...valid, customerId: '999' }), dependencies(request))).status).toBe(400);
    expect((await handlePlayerRequest(input({ ...valid, subscribed: true }), dependencies(request))).status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });
  it('permits an authenticated account without newsletter consent', async () => {
    const request = vi.fn<typeof fetch>(async () => read('UNSUBSCRIBED'));
    const result = await handlePlayerRequest({ ...input({}), method: 'GET' }, dependencies(request));
    expect(result.status).toBe(200);
    expect(result.body.storage).toMatchObject({ allowed: true, reason: 'account' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('uses the server session for ranking identity, preserves period validation and rejects other shops', async () => {
    const keys = rankingWindows(now), alias = await playerAlias(config, '123');
    const board = { version: 1, day: { key: keys.day, rows: [] }, week: { key: keys.week, rows: [] },
      all: { key: 'all', rows: [{ alias, score: 200 }] } };
    const request = vi.fn<typeof fetch>(async () => json({ shop: { id: 'gid://shopify/Shop/1',
      metafield: { value: JSON.stringify(board), compareDigest: digest } } }));
    const result = await handleRankingRequest('GET', '/api/leaderboard?period=all&customerId=999', config, request, now, async () => identity);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ entries: [{ name: 'DU', score: 200, you: true }] });
    expect((await handleRankingRequest('GET', '/?period=wrong', config, request, now, async () => identity)).status).toBe(400);
    expect((await handleRankingRequest('GET', '/?period=all', config, request, now, async () => ({ ...identity, shop: 'other.myshopify.com' }))).status).toBe(401);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('Worker JSON request limits', () => {
  it('parses split multibyte UTF-8 without Node buffers', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ paint: 'Grüezi 🏍️' }));
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } });
    const init: RequestInit & { duplex: string } = { method: 'POST', body: stream, duplex: 'half' };
    await expect(readBoundedWebJson(new Request('https://game.example/api/player', init))).resolves.toEqual({ paint: 'Grüezi 🏍️' });
  });
  it('cancels an oversized body and rejects misleading byte lengths', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(MAX_BODY_BYTES + 1)); }, cancel });
    const init: RequestInit & { duplex: string } = { method: 'POST', body: stream, duplex: 'half' };
    await expect(readBoundedWebJson(new Request('https://game.example/api/player', init))).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalledTimes(1);
    await expect(readBoundedWebJson(new Request('https://game.example/api/player', { method: 'POST',
      headers: { 'content-length': String(MAX_BODY_BYTES + 1) }, body: '{}' }))).rejects.toMatchObject({ status: 413 });
    await expect(readBoundedWebJson(new Request('https://game.example/api/player', { method: 'POST',
      body: `"${'ä'.repeat(MAX_BODY_BYTES / 2)}"` }))).rejects.toMatchObject({ status: 413 });
  });
  it('rejects empty and malformed JSON', async () => {
    for (const content of ['', '{broken']) await expect(readBoundedWebJson(new Request('https://game.example/api/player',
      { method: 'POST', body: content }))).rejects.toMatchObject({ status: 400 });
  });
});
