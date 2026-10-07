import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { newPlayer } from '../app/domain/progression';
import { authenticateProxy, createCsrf, readShopifyConfig, type ShopifyConfig } from '../server/shopify/auth';
import { handlePlayerRequest, type PlayerRequest } from '../server/shopify/playerEndpoint';
import { readBoundedJson, withFetchDeadline, type NodeRequest } from '../server/shopify/http';
import { MAX_BODY_BYTES, sanitizeDigitalPlayer } from '../server/shopify/playerValidation';
import { PLAYER_KEY, PLAYER_NAMESPACE, SHOPIFY_API_VERSION } from '../server/shopify/playerStore';
import { REWARDS } from '../app/domain/config';

const now = Date.UTC(2026, 9, 5, 12);
const config: ShopifyConfig = { shop: 'pfusch-test.myshopify.com', secret: 'test-api-secret', adminToken: 'test-admin-token' };
const firstDigest = 'a'.repeat(64), nextDigest = 'b'.repeat(64);
const gid = 'gid://shopify/Customer/12345';
function signed(customer = '12345', at = now, extras: [string, string][] = []) {
  const query = new URLSearchParams([['shop', config.shop], ['logged_in_customer_id', customer],
    ['path_prefix', '/apps/pfusch-game'], ['timestamp', String(Math.floor(at / 1000))], ...extras]);
  const canonical = [...new Set(query.keys())].map(key => `${key}=${query.getAll(key).join(',')}`).sort().join('');
  query.set('signature', createHmac('sha256', config.secret).update(canonical).digest('hex'));
  return `/api/shopify/player?${query}`;
}
const response = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const getResponse = (value: unknown = null, marketingState = 'NOT_SUBSCRIBED') => response({ customer: { id: gid,
  emailMarketingConsent: { marketingState },
  metafield: value === null ? null : { value: JSON.stringify(value), compareDigest: firstDigest } } });
const saveResponse = () => response({ metafieldsSet: { metafields: [{ compareDigest: nextDigest }], userErrors: [] } });
function input(method = 'GET', body: unknown = undefined, url = signed()): PlayerRequest {
  return { method, url, contentType: 'application/json', readBody: vi.fn(async () => body) };
}
function post(player = newPlayer(), compareDigest: string | null = null) {
  return { ...input('POST'), readBody: vi.fn(async () => ({ player, compareDigest,
    csrfToken: await createCsrf({ shop: config.shop, customerId: '12345' }, config.secret, now) })) };
}
function dependencies(request = vi.fn<typeof fetch>(async () => getResponse())) {
  return { config, now: () => now, request };
}
function shopify(saved: unknown = null, state = 'NOT_SUBSCRIBED') {
  return vi.fn<typeof fetch>(async (_url, options) => {
    const body = JSON.parse(options!.body as string);
    return body.query.startsWith('query') ? getResponse(saved, state) : saveResponse();
  });
}

describe('Shopify App Proxy authentication', () => {
  it('matches the official canonicalization fixture including repeated values', async () => {
    // The documentation now displays {shop}, but its published HMAC is for
    // the original literal shop-name.myshopify.com in the Shopify fixture.
    const source = 'extra=1&extra=2&shop=shop-name.myshopify.com&logged_in_customer_id=1&path_prefix=%2Fapps%2Fawesome_reviews&timestamp=1317327555&signature=4c68c8624d737112c91818c11017d24d334b524cb5c2b8ba08daa056f7395ddb';
    expect((await authenticateProxy(`/?${source}`, { ...config, shop: 'shop-name.myshopify.com', secret: 'hush' }, 1317327555000)).customerId).toBe('1');
  });
  it('accepts freshly signed requests and a single configured shop', async () => {
    expect((await authenticateProxy(signed('12345', now, [['extra', 'one'], ['extra', 'two']]), config, now)).customerId).toBe('12345');
    expect(readShopifyConfig({ SHOPIFY_SHOP_DOMAIN: config.shop, SHOPIFY_API_SECRET: config.secret,
      SHOPIFY_ADMIN_ACCESS_TOKEN: config.adminToken })).toEqual(config);
    expect(readShopifyConfig({ SHOPIFY_SHOP_DOMAIN: 'attacker.example/admin', SHOPIFY_API_SECRET: 'x', SHOPIFY_ADMIN_ACCESS_TOKEN: 'y' })).toBeNull();
  });
  it.each([
    ['tampered customer', () => signed().replace('12345', '67890')],
    ['guest', () => signed('')],
    ['expired', () => signed('12345', now - 301000)],
    ['future', () => signed('12345', now + 61000)],
    ['duplicate customer', () => signed('12345', now, [['logged_in_customer_id', '67890']])],
    ['duplicate shop', () => signed('12345', now, [['shop', config.shop]])],
    ['duplicate timestamp', () => signed('12345', now, [['timestamp', String(now / 1000)]])],
    ['duplicate signature', () => `${signed()}&signature=${'f'.repeat(64)}`],
    ['wrong shop', () => signed().replace(config.shop, 'another.myshopify.com')],
  ])('rejects %s before reading player data', async (_name, makeUrl) => {
    await expect(authenticateProxy(makeUrl(), config, now)).rejects.toThrow('unauthorized');
  });
  it('rejects a correctly signed shop not on the configured allowlist', async () => {
    await expect(authenticateProxy(signed(), { ...config, shop: 'other.myshopify.com' }, now)).rejects.toThrow('unauthorized');
  });
});

describe('Customer-scoped cloud save', () => {
  it('fails closed when unconfigured and never contacts Shopify for unauthenticated requests', async () => {
    const deps = dependencies();
    expect((await handlePlayerRequest(input(), { ...deps, config: null })).status).toBe(503);
    const request = input('POST', {}, '/api/shopify/player?customerId=12345');
    expect((await handlePlayerRequest(request, deps)).status).toBe(401);
    expect(request.readBody).not.toHaveBeenCalled();
    expect(deps.request).not.toHaveBeenCalled();
  });
  it('returns the signed customer, empty save and an opaque CSRF token from a no-save GET', async () => {
    const deps = dependencies();
    const result = await handlePlayerRequest(input(), deps);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ customer: { id: '12345' }, player: null, compareDigest: null });
    expect(result.body.storage).toEqual({ allowed: true, reason: 'trial', completedRuns: 0, freeRuns: 5 });
    expect(result.body.csrfToken).toMatch(/^\d{10}\.[a-f0-9]{36}\.[a-f0-9]{64}$/);
    const [url, options] = deps.request.mock.calls[0];
    expect(url).toBe(`https://${config.shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`);
    expect(JSON.parse(options!.body as string).variables).toEqual({ id: gid, namespace: PLAYER_NAMESPACE, key: PLAYER_KEY });
    expect(JSON.parse(options!.body as string).query).toContain('emailMarketingConsent { marketingState }');
    expect(options!.redirect).toBe('manual');
  });
  it('never serves a different customer object returned upstream', async () => {
    const deps = dependencies(vi.fn(async () => response({ customer: { id: 'gid://shopify/Customer/999', metafield: null } })));
    expect((await handlePlayerRequest(input(), deps)).status).toBe(502);
  });
  it('creates only a digital canonical snapshot for the signed customer with explicit CAS null', async () => {
    const player = { ...newPlayer(), id: 'another-customer', xp: 600, level: 99, tickets: 888,
      irlItems: ['bought-in-shop'], ownedItems: ['bike:125', 'shirt'],
      redeemedRewards: ['starter-coins', 'exclusive-rims', 'shipping', 'chf-five'], equipped: { upper: 'bought-in-shop' } };
    const deps = dependencies(shopify());
    const afterSave = vi.fn(async () => { throw new Error('secondary index unavailable'); });
    const result = await handlePlayerRequest(post(player), { ...deps, afterSave });
    expect(result.status).toBe(200);
    expect(result.body.player).toMatchObject({ id: 'shopify:12345', level: 3, tickets: 0, irlItems: [],
      redeemedRewards: ['starter-coins', 'exclusive-rims'], equipped: {} });
    const field = JSON.parse(deps.request.mock.calls[1][1]!.body as string).variables.metafields[0];
    expect(field.ownerId).toBe(gid);
    expect(field).toHaveProperty('compareDigest', null);
    expect(field.namespace).toBe('$app:pfusch_game');
    expect(JSON.parse(field.value)).toEqual(result.body.player);
    expect(afterSave).toHaveBeenCalledOnce();
  });
  it('retains the existing digest and sanitizes stored real-world claims on GET', async () => {
    const deps = dependencies(vi.fn(async () => getResponse({ ...newPlayer(), irlItems: ['unverified'], tickets: 50 })));
    const result = await handlePlayerRequest(input(), deps);
    expect(result.body.compareDigest).toBe(firstDigest);
    expect(result.body.player).toMatchObject({ irlItems: [], tickets: 0 });
  });
  it('refuses an unreadable save rather than treating it as an empty first save', async () => {
    const deps = dependencies(vi.fn(async () => getResponse({ version: 2 })));
    const result = await handlePlayerRequest(input(), deps);
    expect(result.status).toBe(502);
    expect(result.body).toEqual({ error: 'invalid_saved_player' });
  });
  it.each(['missing', 'wrong-customer', 'expired', 'tampered'])('rejects %s CSRF without a mutation', async kind => {
    const payload = await post().readBody() as Record<string, unknown>;
    if (kind === 'missing') payload.csrfToken = '';
    if (kind === 'wrong-customer') payload.csrfToken = await createCsrf({ shop: config.shop, customerId: '99999' }, config.secret, now);
    if (kind === 'expired') payload.csrfToken = await createCsrf({ shop: config.shop, customerId: '12345' }, config.secret, now - 901000);
    if (kind === 'tampered') payload.csrfToken = `${String(payload.csrfToken).slice(0, -4)}ffff`;
    const deps = dependencies();
    expect((await handlePlayerRequest(input('POST', payload), deps)).status).toBe(403);
    expect(deps.request).not.toHaveBeenCalled();
  });
  it('requires the digest field instead of permitting an unconditional overwrite', async () => {
    const payload = await post().readBody() as Record<string, unknown>;
    delete payload.compareDigest;
    const deps = dependencies();
    expect((await handlePlayerRequest(input('POST', payload), deps)).status).toBe(400);
    expect(deps.request).not.toHaveBeenCalled();
  });
  it('does not overwrite concurrent changes or silently retry with a fresh digest', async () => {
    let current = firstDigest, writes = 0;
    const request = vi.fn<typeof fetch>(async (_url, options) => {
      const body = JSON.parse(options!.body as string);
      if (body.query.startsWith('query')) return getResponse(newPlayer());
      const field = body.variables.metafields[0];
      if (field.compareDigest !== current) return response({ metafieldsSet: { metafields: [], userErrors: [{ code: 'STALE_OBJECT' }] } });
      current = nextDigest; writes++;
      return saveResponse();
    });
    const results = await Promise.all([handlePlayerRequest(post(newPlayer(), firstDigest), dependencies(request)),
      handlePlayerRequest(post(newPlayer(), firstDigest), dependencies(request))]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect(writes).toBe(1);
    expect(request).toHaveBeenCalledTimes(4);
  });
  it('returns safe error codes without upstream credentials or error text', async () => {
    const deps = dependencies(vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: config.adminToken }] }), { status: 200 })));
    expect(await handlePlayerRequest(input(), deps)).toEqual({ status: 503, body: { error: 'shopify_admin_query_failed' } });
  });
});

describe('Live Shopify newsletter authority', () => {
  const played = (count: number) => ({ ...newPlayer(), runsPlayed: count,
    processedRuns: Array.from({ length: count }, (_, index) => `run-${index + 1}`) });
  const mutationCount = (request: ReturnType<typeof shopify>) => request.mock.calls
    .filter(([, options]) => JSON.parse(options!.body as string).query.startsWith('mutation')).length;

  it('stores the fifth trial run once and returns a locked start/save state afterwards', async () => {
    const request = shopify(played(4));
    const result = await handlePlayerRequest(post(played(5), firstDigest), dependencies(request));
    expect(result.status).toBe(200);
    expect(result.body.storage).toEqual({ allowed: false, reason: 'newsletter_required', completedRuns: 5, freeRuns: 5 });
    expect(result.body.player).toMatchObject({ runsPlayed: 5 });
    expect(mutationCount(request)).toBe(1);

    const completed = shopify(played(5));
    const retry = await handlePlayerRequest(post(played(5), firstDigest), dependencies(completed));
    expect(retry.status).toBe(403);
    expect(retry.body).toMatchObject({ error: 'newsletter_required', storage: { allowed: false, completedRuns: 5 } });
    expect(mutationCount(completed)).toBe(0);
  });

  it.each(['NOT_SUBSCRIBED', 'PENDING', 'INVALID', 'REDACTED'])('never treats %s as subscribed after the trial', async state => {
    const request = shopify(played(5), state);
    const existing = await handlePlayerRequest(input(), dependencies(request));
    expect(existing.status).toBe(200);
    expect(existing.body.player).toMatchObject({ runsPlayed: 5 });
    expect(existing.body.storage).toMatchObject({ allowed: false, reason: 'newsletter_required' });
    const result = await handlePlayerRequest(post(played(6), firstDigest), dependencies(request));
    expect(result.status).toBe(403);
    expect(result.body.error).toBe('newsletter_required');
    expect(mutationCount(request)).toBe(0);
  });

  it('blocks a sixth run imported into an empty or still-eligible account', async () => {
    for (const saved of [null, played(4)]) {
      const request = shopify(saved);
      const result = await handlePlayerRequest(post(played(6), saved ? firstDigest : null), dependencies(request));
      expect(result.status).toBe(403);
      expect(result.body).toMatchObject({ error: 'newsletter_required', storage: { completedRuns: 6, allowed: false } });
      expect(mutationCount(request)).toBe(0);
    }
  });

  it.each([0, 2, 5])('stops saving immediately on unsubscribe at %i runs without deleting existing progress', async runs => {
    const saved = played(runs), request = shopify(saved, 'UNSUBSCRIBED'), afterSave = vi.fn();
    const loaded = await handlePlayerRequest(input(), dependencies(request));
    expect(loaded.status).toBe(200);
    expect(loaded.body.player).toMatchObject({ runsPlayed: runs });
    expect(loaded.body.storage).toEqual({ allowed: false, reason: 'unsubscribed', completedRuns: runs, freeRuns: 5 });
    const result = await handlePlayerRequest(post(saved, firstDigest), { ...dependencies(request), afterSave });
    expect(result.status).toBe(403);
    expect(result.body.error).toBe('newsletter_unsubscribed');
    expect(mutationCount(request)).toBe(0);
    expect(afterSave).not.toHaveBeenCalled();
  });

  it('rechecks live consent after an earlier subscribed GET; its CSRF grants no newsletter permission', async () => {
    const request = shopify(played(2), 'UNSUBSCRIBED');
    request.mockResolvedValueOnce(getResponse(played(2), 'SUBSCRIBED'));
    const loaded = await handlePlayerRequest(input(), dependencies(request));
    expect(loaded.body.storage).toMatchObject({ allowed: true, reason: 'subscribed' });
    const result = await handlePlayerRequest(input('POST', { player: played(3), compareDigest: firstDigest,
      csrfToken: loaded.body.csrfToken }), dependencies(request));
    expect(result.status).toBe(403);
    expect(result.body.error).toBe('newsletter_unsubscribed');
    expect(mutationCount(request)).toBe(0);
  });

  it('allows a live subscribed account beyond five runs and does not write marketing consent', async () => {
    const request = shopify(played(5), 'SUBSCRIBED');
    const result = await handlePlayerRequest(post(played(6), firstDigest), dependencies(request));
    expect(result.status).toBe(200);
    expect(result.body.storage).toEqual({ allowed: true, reason: 'subscribed', completedRuns: 6, freeRuns: 5 });
    const mutation = JSON.parse(request.mock.calls[1][1]!.body as string);
    expect(mutation.query).toContain('metafieldsSet');
    expect(mutation.variables.metafields).toHaveLength(1);
    expect(mutation.variables.metafields[0].key).toBe(PLAYER_KEY);
    expect(JSON.stringify(mutation)).not.toContain('emailMarketingConsent');
  });

  it('preserves durable run counts and counts new settled IDs despite a reset browser counter', async () => {
    const request = shopify(played(4));
    const incoming = { ...played(5), runsPlayed: 0 };
    const result = await handlePlayerRequest(post(incoming, firstDigest), dependencies(request));
    expect(result.status).toBe(200);
    expect(result.body.player).toMatchObject({ runsPlayed: 5 });
    expect(result.body.storage).toMatchObject({ allowed: false, completedRuns: 5 });
    const reset = shopify(played(5));
    expect((await handlePlayerRequest(post(newPlayer(), firstDigest), dependencies(reset))).status).toBe(403);
    expect(mutationCount(reset)).toBe(0);
  });

  it('does not count already settled IDs again during loadout-only saves', async () => {
    const request = shopify(played(4));
    const result = await handlePlayerRequest(post({ ...played(4), paint: '#556677' }, firstDigest), dependencies(request));
    expect(result.status).toBe(200);
    expect(result.body.player).toMatchObject({ runsPlayed: 4, paint: '#556677' });
    expect(result.body.storage).toMatchObject({ allowed: true, completedRuns: 4 });
  });

  it.each([null, undefined, {}, { marketingState: 'UNKNOWN' }])('fails closed when live consent is unavailable: %j', async consent => {
    const request = vi.fn<typeof fetch>(async () => response({ customer: { id: gid, emailMarketingConsent: consent, metafield: null } }));
    const result = await handlePlayerRequest(post(), dependencies(request));
    expect(result).toEqual({ status: 503, body: { error: 'consent_unavailable' } });
    expect(request).toHaveBeenCalledOnce();
  });

  it('rejects browser-supplied subscription flags rather than using them', async () => {
    const original = await post().readBody() as Record<string, unknown>;
    const request = shopify(null, 'UNSUBSCRIBED');
    const result = await handlePlayerRequest(input('POST', { ...original, subscribed: true }), dependencies(request));
    expect(result.status).toBe(400);
    expect(request).not.toHaveBeenCalled();
    const playerResult = await handlePlayerRequest(input('POST', { ...original,
      player: { ...newPlayer(), storage: { allowed: true } } }), dependencies(request));
    expect(playerResult.status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('Bounded save input', () => {
  it('preserves all shipped digital reward markers and the engine run/history bounds', () => {
    const digital = REWARDS.filter(reward => reward.kind === 'coins' || reward.kind === 'cosmetic').map(reward => reward.id);
    const player = sanitizeDigitalPlayer({ ...newPlayer(), redeemedRewards: REWARDS.map(reward => reward.id),
      processedRuns: Array.from({ length: 100 }, (_, index) => `run-${index}`),
      history: Array.from({ length: 200 }, (_, index) => ({ score: index, date: '2026-10-05' })) }, '12345');
    expect(player.redeemedRewards).toEqual(digital);
    expect(player.processedRuns).toHaveLength(100);
    expect(player.history).toHaveLength(200);
  });
  it('uses one shared deadline for ranking retries and cancels the active fetch', async () => {
    let calls = 0;
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      calls++;
      if (calls === 1) return response({});
      return new Promise((_resolve, reject) => {
        const signal = init!.signal!;
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const bounded = withFetchDeadline(request, 20);
    await bounded('https://example.invalid');
    await expect(bounded('https://example.invalid', { signal: AbortSignal.timeout(8000) })).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each([
    { xp: -1 }, { coins: Infinity }, { runsPlayed: 1.5 }, { version: 2 }, { ownedItems: Array(501).fill('x') },
    { history: Array(201).fill({ score: 1, date: '2026-10-05' }) },
    { settings: { muted: true, reducedMotion: false, tutorialSeen: false, quality: 'ultra' } },
    { customerId: '999' }, { variants: JSON.parse('{"__proto__":"bad"}') },
  ])('rejects malformed or excessive player fields %j', bad => {
    expect(() => sanitizeDigitalPlayer({ ...newPlayer(), ...bad }, '12345')).toThrow();
  });
  it('bounds the raw stream even without Content-Length and counts UTF-8 bytes', async () => {
    const req = Object.assign(Readable.from([Buffer.from(`"${'ä'.repeat(MAX_BODY_BYTES / 2)}"`)]), { headers: {} }) as NodeRequest;
    await expect(readBoundedJson(req)).rejects.toMatchObject({ status: 413 });
  });
  it('bounds pre-parsed platform bodies and rejects invalid JSON', async () => {
    const req = Object.assign(Readable.from([]), { headers: {}, body: { payload: 'a'.repeat(MAX_BODY_BYTES) } }) as NodeRequest;
    await expect(readBoundedJson(req)).rejects.toMatchObject({ status: 413 });
    req.body = '{broken';
    await expect(readBoundedJson(req)).rejects.toMatchObject({ status: 400 });
  });
  it('rejects oversized Content-Length before collecting any stream data', async () => {
    const req = Object.assign(Readable.from([]), { headers: { 'content-length': String(MAX_BODY_BYTES + 1) } }) as NodeRequest;
    await expect(readBoundedJson(req)).rejects.toMatchObject({ status: 413 });
  });
});
