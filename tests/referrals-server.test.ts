import { describe, expect, it, vi } from 'vitest';
import { newPlayer } from '../app/domain/progression';
import { ApiError, createCsrf, type ShopifyConfig } from '../server/shopify/auth';
import { type PlayerRequest } from '../server/shopify/playerEndpoint';
import { PLAYER_KEY, PLAYER_NAMESPACE } from '../server/shopify/playerStore';
import { acceptReferral, createReferralCode, finishReferral, handleReferralRequest, readReferralCode,
  REFERRAL_COINS, REFERRAL_KEY } from '../server/shopify/referrals';

const config: ShopifyConfig = { shop: 'referral-test.myshopify.com', secret: 'referral-test-secret', adminToken: 'test-admin' };
const now = Date.UTC(2026, 9, 13, 12);
const owner = (id: string) => `gid://shopify/Customer/${id}`;
type StoredField = { value: string; compareDigest: string };
type FieldWrite = { ownerId: string; namespace: string; key: string; value: string; compareDigest: string | null };

/** Model Shopify's all-or-nothing CAS, including races between separate calls. */
function shopify() {
  let serial = 0;
  const customers = new Set(['100', '200', '300']);
  const fields = new Map<string, StoredField>();
  const mutations: FieldWrite[][] = [];
  const key = (id: string, name: string) => `${owner(id)}/${name}`;
  const set = (id: string, name: string, value: unknown) => {
    fields.set(key(id, name), { value: JSON.stringify(value), compareDigest: (++serial).toString(16).padStart(64, '0') });
  };
  const read = (id: string, name: string) => {
    const field = fields.get(key(id, name));
    return field ? JSON.parse(field.value) as Record<string, unknown> : null;
  };
  const hooks: { beforeMutation?: () => void; rejectWrites?: boolean } = {};
  const request = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { query: string; variables: { id?: string; metafields?: FieldWrite[] } };
    let data: unknown;
    if (body.query.startsWith('query')) {
      const id = body.variables.id!.slice('gid://shopify/Customer/'.length);
      data = { customer: customers.has(id) ? { id: owner(id),
        player: fields.get(key(id, PLAYER_KEY)) ?? null,
        invitation: fields.get(key(id, REFERRAL_KEY)) ?? null } : null };
    } else {
      const writes = body.variables.metafields!;
      mutations.push(writes);
      hooks.beforeMutation?.();
      const conflict = hooks.rejectWrites || writes.some(field =>
        (fields.get(`${field.ownerId}/${field.key}`)?.compareDigest ?? null) !== field.compareDigest);
      if (conflict) data = { metafieldsSet: { metafields: [], userErrors: [{ code: 'STALE_OBJECT' }] } };
      else {
        const committed = writes.map(field => {
          expect(field.namespace).toBe(PLAYER_NAMESPACE);
          const stored = { value: field.value, compareDigest: (++serial).toString(16).padStart(64, '0') };
          fields.set(`${field.ownerId}/${field.key}`, stored);
          return { compareDigest: stored.compareDigest };
        });
        data = { metafieldsSet: { metafields: committed, userErrors: [] } };
      }
    }
    return new Response(JSON.stringify({ data }), { status: 200 });
  });
  return { set, read, request, mutations, customers, hooks };
}

function input(method = 'GET', body: unknown = undefined): PlayerRequest {
  return { method, url: 'https://game.pfusch-clothing.ch/api/referral', contentType: 'application/json', readBody: vi.fn(async () => body) };
}
function deps(request: typeof fetch, customerId = '200') {
  return { config, request, now: () => now, authenticate: async () => ({ shop: config.shop, customerId }) };
}

describe('opaque customer invitations', () => {
  it('round-trips an authenticated opaque code and rejects tampering, foreign shops and secrets', async () => {
    const code = await createReferralCode(config, '100');
    expect(await readReferralCode(config, code)).toBe('100');
    expect(await createReferralCode(config, '100')).not.toBe(code);
    const parts = code.split('.');
    // Change ciphertext, not unused base64 padding bits.
    parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    for (const value of [parts.join('.'), '', '100', `v1.${'A'.repeat(600)}`, `${code}.extra`])
      await expect(readReferralCode(config, value)).rejects.toMatchObject({ code: 'invalid_invitation' });
    await expect(readReferralCode({ ...config, shop: 'another.myshopify.com' }, code)).rejects.toMatchObject({ code: 'invalid_invitation' });
    await expect(readReferralCode({ ...config, secret: 'another-secret' }, code)).rejects.toMatchObject({ code: 'invalid_invitation' });
  });

  it('requires authenticated GET and authenticated customer-bound CSRF before POST reads Shopify', async () => {
    const store = shopify();
    const get = await handleReferralRequest(input(), deps(store.request, '100'));
    expect(get.status).toBe(200);
    expect(await readReferralCode(config, get.body.code)).toBe('100');
    expect(get.body.reward).toBe(150);
    expect(get.body.guardianBells).toBe(1);
    expect(Object.keys(get.body).sort()).toEqual(['code', 'csrfToken', 'guardianBells', 'reward']);
    const unauthorized = input('POST', {});
    expect(await handleReferralRequest(unauthorized, { ...deps(store.request), authenticate: async () => { throw new ApiError(401, 'login_required'); } }))
      .toMatchObject({ status: 401, body: { error: 'login_required' } });
    expect(unauthorized.readBody).not.toHaveBeenCalled();
    const otherCustomerCsrf = await createCsrf({ shop: config.shop, customerId: '100' }, config.secret, now);
    expect(await handleReferralRequest(input('POST', { code: get.body.code, csrfToken: otherCustomerCsrf }), deps(store.request)))
      .toMatchObject({ status: 403, body: { error: 'csrf' } });
    expect(store.request).not.toHaveBeenCalled();
    const csrfToken = await createCsrf({ shop: config.shop, customerId: '200' }, config.secret, now);
    expect(await handleReferralRequest(input('POST', { code: get.body.code, csrfToken, coins: 9999 }), deps(store.request)))
      .toMatchObject({ status: 400, body: { error: 'invalid_request' } });
    expect(await handleReferralRequest(input('POST', { code: 'forged', csrfToken }), deps(store.request)))
      .toMatchObject({ status: 400, body: { error: 'invalid_invitation' } });
    expect(store.request).not.toHaveBeenCalled();
    expect(await handleReferralRequest(input('POST', { code: get.body.code, csrfToken }), deps(store.request)))
      .toMatchObject({ status: 200, body: { accepted: true } });
    expect(store.read('200', REFERRAL_KEY)).toMatchObject({ inviter: '100', state: 'pending' });
  });
});

describe('first-player invitation binding', () => {
  it('rejects self-invitations and riders with completed saved runs', async () => {
    const store = shopify();
    await expect(acceptReferral(config, '100', '100', store.request)).rejects.toMatchObject({ code: 'self_invitation' });
    expect(store.request).not.toHaveBeenCalled();
    store.set('200', PLAYER_KEY, { ...newPlayer(), runsPlayed: 1 });
    await expect(acceptReferral(config, '200', '100', store.request)).rejects.toMatchObject({ code: 'existing_player' });
    expect(store.mutations).toHaveLength(0);
  });

  it('binds only one inviter, does not pay on link opening and makes retries harmless', async () => {
    const store = shopify();
    store.set('100', PLAYER_KEY, { ...newPlayer(), coins: 800 });
    await acceptReferral(config, '200', '100', store.request);
    await acceptReferral(config, '200', '100', store.request);
    await expect(acceptReferral(config, '200', '300', store.request)).rejects.toMatchObject({ code: 'invitation_already_used' });
    await finishReferral(config, '200', store.request);
    expect(store.read('100', PLAYER_KEY)?.coins).toBe(800);
    expect(store.read('200', REFERRAL_KEY)).toMatchObject({ inviter: '100', state: 'pending' });
    expect(store.mutations).toHaveLength(1);
  });

  it('does not persist a deleted inviter or treat an invalid saved player as new', async () => {
    const store = shopify();
    store.customers.delete('100');
    await expect(acceptReferral(config, '200', '100', store.request)).rejects.toMatchObject({ code: 'invitation_account_unavailable' });
    store.set('200', PLAYER_KEY, { ...newPlayer(), runsPlayed: '0' });
    await expect(acceptReferral(config, '200', '300', store.request)).rejects.toMatchObject({ code: 'invalid_saved_player' });
    expect(store.mutations).toHaveLength(0);
  });
});

describe('atomic referral coin settlement', () => {
  function pending() {
    const store = shopify();
    const original = { ...newPlayer(), coins: 640, xp: 1234, runsPlayed: 5,
      irlItems: ['verified-item'], equipped: { upper: 'original-product' }, futureField: { keep: ['unchanged'] } };
    store.set('100', PLAYER_KEY, original);
    store.set('200', PLAYER_KEY, { ...newPlayer(), runsPlayed: 1 });
    store.set('200', REFERRAL_KEY, { version: 1, inviter: '100', state: 'pending' });
    return { ...store, original };
  }

  it('migrates an older inviter wallet and then grants each distinct successful invitation without refunding spent Bells', async () => {
    const store = pending();
    const legacy = { ...store.original } as Record<string, unknown>;
    delete legacy.guardianBells;
    store.set('100', PLAYER_KEY, legacy);
    await finishReferral(config, '200', store.request);
    expect(store.read('100', PLAYER_KEY)?.guardianBells).toEqual({ earned: 1, spent: 0, spentRunIds: [] });
    const consumed = { ...store.read('100', PLAYER_KEY), guardianBells: { earned: 1, spent: 1, spentRunIds: ['revived-run'] } };
    store.set('100', PLAYER_KEY, consumed);
    store.set('300', PLAYER_KEY, { ...newPlayer(), runsPlayed: 1 });
    store.set('300', REFERRAL_KEY, { version: 1, inviter: '100', state: 'pending' });
    await finishReferral(config, '300', store.request);
    await finishReferral(config, '300', store.request);
    expect(store.read('100', PLAYER_KEY)).toMatchObject({ coins: 940,
      guardianBells: { earned: 2, spent: 1, spentRunIds: ['revived-run'] } });
  });

  it('credits 150 once after the first saved run and preserves every other original save field', async () => {
    const store = pending();
    await finishReferral(config, '200', store.request);
    await finishReferral(config, '200', store.request);
    await acceptReferral(config, '200', '100', store.request);
    expect(REFERRAL_COINS).toBe(150);
    expect(store.read('100', PLAYER_KEY)).toEqual({ ...store.original, coins: 790,
      guardianBells: { earned: 1, spent: 0, spentRunIds: [] } });
    expect(store.read('200', REFERRAL_KEY)).toEqual({ version: 1, inviter: '100', state: 'credited', coins: 150, guardianBells: 1 });
    expect(store.mutations).toHaveLength(1);
    expect(store.mutations[0].map(field => [field.ownerId, field.key])).toEqual([[owner('100'), PLAYER_KEY], [owner('200'), REFERRAL_KEY]]);
    expect(store.mutations[0].every(field => !!field.compareDigest)).toBe(true);
  });

  it('commits only one reward when two first-save completions run concurrently', async () => {
    const store = pending();
    await Promise.all([finishReferral(config, '200', store.request), finishReferral(config, '200', store.request)]);
    expect(store.read('100', PLAYER_KEY)?.coins).toBe(790);
    expect(store.read('100', PLAYER_KEY)?.guardianBells).toEqual({ earned: 1, spent: 0, spentRunIds: [] });
    expect(store.read('200', REFERRAL_KEY)?.state).toBe('credited');
  });

  it('initializes an inviter without a game save using CAS null and credits the invitation once', async () => {
    const store = shopify();
    store.set('200', PLAYER_KEY, { ...newPlayer(), runsPlayed: 1 });
    store.set('200', REFERRAL_KEY, { version: 1, inviter: '100', state: 'pending' });
    await finishReferral(config, '200', store.request);
    await finishReferral(config, '200', store.request);
    expect(store.read('100', PLAYER_KEY)).toMatchObject({ version: 1, id: 'shopify:100',
      coins: newPlayer().coins + REFERRAL_COINS, runsPlayed: 0, guardianBells: { earned: 1, spent: 0, spentRunIds: [] } });
    expect(store.mutations).toHaveLength(1);
    expect(store.mutations[0][0].compareDigest).toBeNull();
    expect(store.read('200', REFERRAL_KEY)?.state).toBe('credited');
  });

  it('does not double-credit when a committed mutation response is lost and settlement is retried', async () => {
    const store = pending();
    let lost = false;
    const request: typeof fetch = async (url, init) => {
      const response = await store.request(url, init);
      if (!lost && JSON.parse(String(init?.body)).query.startsWith('mutation')) {
        lost = true;
        throw new Error('response lost after commit');
      }
      return response;
    };
    await expect(finishReferral(config, '200', request)).rejects.toMatchObject({ code: 'shopify_admin_request_failed' });
    await finishReferral(config, '200', request);
    expect(store.read('100', PLAYER_KEY)?.coins).toBe(790);
    expect(store.read('100', PLAYER_KEY)?.guardianBells).toEqual({ earned: 1, spent: 0, spentRunIds: [] });
    expect(store.read('200', REFERRAL_KEY)?.state).toBe('credited');
    expect(store.mutations).toHaveLength(1);
  });

  it('re-reads a concurrently changed wallet instead of overwriting its equipment or coins', async () => {
    const store = pending();
    const concurrent = { ...store.original, coins: 910, helmetColor: '#123456' };
    store.hooks.beforeMutation = () => {
      store.hooks.beforeMutation = undefined;
      store.set('100', PLAYER_KEY, concurrent);
    };
    await finishReferral(config, '200', store.request);
    expect(store.read('100', PLAYER_KEY)).toEqual({ ...concurrent, coins: 1060,
      guardianBells: { earned: 1, spent: 0, spentRunIds: [] } });
    expect(store.mutations).toHaveLength(2);
    expect(store.read('200', REFERRAL_KEY)?.state).toBe('credited');
  });

  it('bounds conflicting retries and leaves both claim and wallet unchanged when none commit', async () => {
    const store = pending();
    store.hooks.rejectWrites = true;
    await expect(finishReferral(config, '200', store.request)).rejects.toMatchObject({ code: 'conflict' });
    expect(store.mutations).toHaveLength(3);
    expect(store.read('100', PLAYER_KEY)).toEqual(store.original);
    expect(store.read('200', REFERRAL_KEY)?.state).toBe('pending');
  });

  it('never pays a malformed/self receipt or a pending claim without a completed save', async () => {
    const store = pending();
    store.set('200', PLAYER_KEY, { ...newPlayer(), runsPlayed: 0 });
    await finishReferral(config, '200', store.request);
    expect(store.mutations).toHaveLength(0);
    store.set('200', PLAYER_KEY, { ...newPlayer(), runsPlayed: 1 });
    store.set('200', REFERRAL_KEY, { version: 1, inviter: '200', state: 'pending' });
    await expect(finishReferral(config, '200', store.request)).rejects.toMatchObject({ code: 'invalid_invitation_state' });
    expect(store.mutations).toHaveLength(0);
    expect(store.read('100', PLAYER_KEY)).toEqual(store.original);
  });
});
