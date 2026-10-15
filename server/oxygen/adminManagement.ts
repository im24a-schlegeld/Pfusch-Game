import { ApiError, type ShopifyConfig } from '../shopify/auth.js';
import { isRecord, sanitizeDigitalPlayer } from '../shopify/playerValidation.js';
import { PLAYER_NAMESPACE, PLAYER_KEY, shopifyGraphql, type ShopifyFetch } from '../shopify/playerStore.js';
import { verifyAdminIdToken } from './adminDashboard.js';
import { levelForXp } from '../../app/domain/progression.js';

const PRESENCE_KEY = 'last_active_v1';
const AUDIT_KEY = 'dashboard_audit_v1';
const PAGE_LIMIT = 25;
const LIVE_WINDOW_MS = 120_000;
const PRESENCE_RATE_MS = 75_000;
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' };
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const gid = (id: string) => `gid://shopify/Customer/${id}`;
const parseId = (id: unknown) => typeof id === 'string' && /^[1-9]\d{0,19}$/.test(id) ? id : null;
const safeInt = (value: unknown, maximum: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const validDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
function adminError(error: unknown) {
  return json(error instanceof ApiError ? error.status : 503, {
    error: error instanceof ApiError ? error.code : 'admin_unavailable',
  });
}

/** Writes are DENIED until a trusted Oxygen variable explicitly lists a staff ID. */
export function isDashboardEditor(staffId: string, raw: string | undefined) {
  return Boolean(raw && raw.split(',').map(part => part.trim()).some(id => /^[1-9]\d{0,19}$/.test(id) && id === staffId));
}

function isLive(value: unknown, now: number): boolean {
  if (!isRecord(value) || typeof value.value !== 'string' || value.value.length > 128) return false;
  try {
    const state: unknown = JSON.parse(value.value);
    return isRecord(state) && typeof state.lastSeen === 'number' && Number.isInteger(state.lastSeen)
      && state.lastSeen <= now + 5_000 && now - state.lastSeen >= 0 && now - state.lastSeen <= LIVE_WINDOW_MS;
  } catch { return false; }
}

function playerSnapshot(value: unknown) {
  if (!isRecord(value) || typeof value.value !== 'string' || value.value.length > 50_000) return null;
  try {
    const p: unknown = JSON.parse(value.value);
    if (!isRecord(p) || p.version !== 1 || !safeInt(p.coins, 1_000_000_000) || !safeInt(p.xp, 1_000_000_000)) return null;
    const bells = isRecord(p.guardianBells) ? p.guardianBells : null;
    const earned = bells && safeInt(bells.earned, 100_000) ? bells.earned : 0;
    const spent = bells && safeInt(bells.spent, 100_000) ? bells.spent : 0;
    return { coins: p.coins, xp: p.xp, level: p.level, runs: p.runsPlayed, highScore: p.highScore,
      bellsEarned: earned, bellsSpent: spent, bells: Math.max(0, earned - spent) };
  } catch { return null; }
}

export async function listDashboardPlayers(config: ShopifyConfig, request: ShopifyFetch, url: URL, now: number) {
  const params = url.searchParams;
  const q = (params.get('q') ?? '').trim();
  const after = params.get('after') ?? '';
  const forbidden = Array.from({ length: q.length }, (_, i) => q.charCodeAt(i)).some(code => code < 32 || code === 127);
  if (q.length > 80 || forbidden || after.length > 250 ||
    (after && !/^[A-Za-z0-9+/=_-]+$/.test(after))) throw new ApiError(400, 'invalid_search');
  const data = await shopifyGraphql(config, `query PfuschAdminPlayers($ns:String!,$player:String!,$presence:String!,$first:Int!,$after:String,$search:String) {
    customers(first:$first,after:$after,query:$search,sortKey:UPDATED_AT,reverse:true) {
      nodes { id email firstName lastName
        game:metafield(namespace:$ns,key:$player) { value }
        presence:metafield(namespace:$ns,key:$presence) { value }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`, { ns: PLAYER_NAMESPACE, player: PLAYER_KEY, presence: PRESENCE_KEY,
    first: PAGE_LIMIT, after: after || null, search: q || null }, request);
  if (!isRecord(data.customers) || !Array.isArray(data.customers.nodes) || !isRecord(data.customers.pageInfo))
    throw new ApiError(502, 'invalid_customer_listing');
  const rows = data.customers.nodes.map(node => {
    if (!isRecord(node) || typeof node.id !== 'string') return null;
    const match = /^gid:\/\/shopify\/Customer\/([1-9]\d{0,19})$/.exec(node.id);
    if (!match) return null;
    const email = typeof node.email === 'string' && node.email.length <= 320 ? node.email : null;
    const first = typeof node.firstName === 'string' ? node.firstName.slice(0, 100) : '';
    const last = typeof node.lastName === 'string' ? node.lastName.slice(0, 100) : '';
    return { id: match[1], email, name: `${first} ${last}`.trim(), player: playerSnapshot(node.game), online: isLive(node.presence, now) };
  }).filter((r): r is NonNullable<typeof r> => r !== null);
  return { rows, live: rows.filter(row => row.online).length,
    presenceWindowSeconds: LIVE_WINDOW_MS / 1000, liveSampleOnly: true,
    more: data.customers.pageInfo.hasNextPage === true,
    cursor: typeof data.customers.pageInfo.endCursor === 'string' ? data.customers.pageInfo.endCursor : null };
}

function auditEntry(actor: string, field: string, before: unknown, after: unknown, now: number) {
  return { at: new Date(now).toISOString(), actor, field, before, after };
}
async function updateGamePlayer(config: ShopifyConfig, request: ShopifyFetch, customerId: string,
  field: 'coins' | 'xp' | 'bellsEarned', value: number, actor: string, now: number) {
  if (!safeInt(value, field === 'bellsEarned' ? 100_000 : 1_000_000_000)) throw new ApiError(400, 'invalid_value');
  const data = await shopifyGraphql(config, `query PfuschAdminEdit($id:ID!,$ns:String!,$player:String!,$audit:String!){
    customer(id:$id){id game:metafield(namespace:$ns,key:$player){value compareDigest}
      audit:metafield(namespace:$ns,key:$audit){value compareDigest}}
  }`, { id: gid(customerId), ns: PLAYER_NAMESPACE, player: PLAYER_KEY, audit: AUDIT_KEY }, request);
  if (!isRecord(data.customer) || data.customer.id !== gid(customerId) || !isRecord(data.customer.game))
    throw new ApiError(404, 'player_not_found');
  const saved = data.customer.game;
  if (typeof saved.value !== 'string' || saved.value.length > 50_000 || !validDigest(saved.compareDigest))
    throw new ApiError(502, 'invalid_saved_player');
  let player: unknown;
  try { player = JSON.parse(saved.value); } catch { throw new ApiError(502, 'invalid_saved_player'); }
  if (!isRecord(player)) throw new ApiError(502, 'invalid_saved_player');
  // Validate the original server snapshot, not browser-supplied player state.
  sanitizeDigitalPlayer(player, customerId);
  const bells = player.guardianBells;
  const original = field === 'bellsEarned' && isRecord(bells) ? bells.earned : player[field];
  if (field === 'bellsEarned') {
    if (!isRecord(bells) || !safeInt(bells.spent, 100_000) || value < bells.spent)
      throw new ApiError(400, 'bells_below_spent');
    player.guardianBells = { ...bells, earned: value };
  } else {
    player[field] = value;
    if (field === 'xp') player.level = levelForXp(value);
  }
  sanitizeDigitalPlayer(player, customerId);
  const auditField = data.customer.audit;
  let history: unknown[] = [];
  if (isRecord(auditField) && typeof auditField.value === 'string' && auditField.value.length < 16000) {
    try { const old: unknown = JSON.parse(auditField.value); if (Array.isArray(old)) history = old.slice(-24); }
    catch { throw new ApiError(502, 'invalid_admin_audit'); }
  }
  const changes = [...history, auditEntry(actor, field, original, value, now)];
  const input = [
    { ownerId: gid(customerId), namespace: PLAYER_NAMESPACE, key: PLAYER_KEY, type: 'json',
      value: JSON.stringify(player), compareDigest: saved.compareDigest },
    { ownerId: gid(customerId), namespace: PLAYER_NAMESPACE, key: AUDIT_KEY, type: 'json',
      value: JSON.stringify(changes), compareDigest: isRecord(auditField) && validDigest(auditField.compareDigest) ? auditField.compareDigest : null },
  ];
  const result = await shopifyGraphql(config, `mutation PfuschAdminSave($fields:[MetafieldsSetInput!]!){
    metafieldsSet(metafields:$fields){ userErrors{code} metafields{key compareDigest} }
  }`, { fields: input }, request);
  const mutation = result.metafieldsSet;
  if (!isRecord(mutation) || !Array.isArray(mutation.userErrors)) throw new ApiError(502, 'invalid_admin_save');
  if (mutation.userErrors.length) {
    if (mutation.userErrors.some(entry => isRecord(entry) &&
      (entry.code === 'STALE_OBJECT' || entry.code === 'INVALID_COMPARE_DIGEST'))) throw new ApiError(409, 'edit_conflict_reload');
    throw new ApiError(503, 'admin_save_rejected');
  }
  return { changed: field, value };
}

async function updateEmail(config: ShopifyConfig, request: ShopifyFetch, customerId: string,
  value: string, expected: string) {
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || expected.length > 320)
    throw new ApiError(400, 'invalid_email');
  const data = await shopifyGraphql(config, `query AdminCustomerEmail($id:ID!){customer(id:$id){id email}}`, { id: gid(customerId) }, request);
  if (!isRecord(data.customer) || data.customer.id !== gid(customerId)) throw new ApiError(404, 'customer_not_found');
  if ((data.customer.email ?? '') !== expected) throw new ApiError(409, 'email_changed_reload');
  const updated = await shopifyGraphql(config, `mutation PfuschAdminEmail($input:CustomerInput!){
    customerUpdate(input:$input){customer{id email} userErrors{field code}}
  }`, { input: { id: gid(customerId), email: value } }, request);
  const payload = updated.customerUpdate;
  if (!isRecord(payload) || !Array.isArray(payload.userErrors)) throw new ApiError(502, 'invalid_email_update');
  if (payload.userErrors.length) throw new ApiError(409, 'email_update_rejected');
  if (!isRecord(payload.customer) || payload.customer.id !== gid(customerId) || payload.customer.email !== value)
    throw new ApiError(502, 'invalid_email_update');
  return { changed: 'email', value };
}

/** Admin pages require signed short-lived Shopify ID tokens on EVERY API call. */
export async function handleDashboardPlayers(request: Request, config: ShopifyConfig | null,
  fetcher: ShopifyFetch, editorIds: string | undefined, now = Date.now()) {
  if (!config?.clientId) return json(503, { error: 'admin_not_configured' });
  try {
    const staffId = await verifyAdminIdToken(request.headers.get('authorization'), config, now);
    if (request.method === 'GET') {
      const result = await listDashboardPlayers(config, fetcher, new URL(request.url), now);
      return json(200, { ...result, editor: isDashboardEditor(staffId, editorIds), staffId });
    }
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    if (!isDashboardEditor(staffId, editorIds)) throw new ApiError(403, 'admin_editor_not_authorized');
    if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json')
      throw new ApiError(415, 'json_required');
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 2048) throw new ApiError(413, 'too_large');
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new ApiError(400, 'invalid_json'); }
    if (!isRecord(value) || Object.keys(value).some(key => !['id', 'field', 'value', 'expected'].includes(key)))
      throw new ApiError(400, 'invalid_input');
    const customerId = parseId(value.id);
    if (!customerId) throw new ApiError(400, 'invalid_customer');
    if (value.field === 'email' && typeof value.value === 'string' && typeof value.expected === 'string')
      return json(200, await updateEmail(config, fetcher, customerId, value.value, value.expected));
    if ((value.field === 'coins' || value.field === 'xp' || value.field === 'bellsEarned') && typeof value.value === 'number')
      return json(200, await updateGamePlayer(config, fetcher, customerId, value.field, value.value, staffId, now));
    throw new ApiError(400, 'invalid_field');
  } catch (error) { return adminError(error); }
}

/** Authenticated customer heartbeat. No cookies, customer IDs or IP stored in presence JSON. */
export async function handleGamePresence(request: Request, config: ShopifyConfig | null,
  customerId: string, fetcher: ShopifyFetch, now = Date.now()) {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!config || !parseId(customerId)) return json(401, { error: 'unauthorized' });
  try {
    const data = await shopifyGraphql(config, `query PfuschPresence($id:ID!,$ns:String!,$key:String!){
      customer(id:$id){id metafield(namespace:$ns,key:$key){value}}
    }`, { id: gid(customerId), ns: PLAYER_NAMESPACE, key: PRESENCE_KEY }, fetcher);
    if (!isRecord(data.customer) || data.customer.id !== gid(customerId)) throw new ApiError(401, 'unauthorized');
    let lastSeen = 0;
    if (isRecord(data.customer.metafield) && typeof data.customer.metafield.value === 'string') {
      try {
        const existing: unknown = JSON.parse(data.customer.metafield.value);
        if (isRecord(existing) && typeof existing.lastSeen === 'number') lastSeen = existing.lastSeen;
      } catch { /* A corrupt presence marker is simply replaced. */ }
    }
    if (lastSeen > now - PRESENCE_RATE_MS && lastSeen <= now + 5_000) return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    const saved = await shopifyGraphql(config, `mutation SavePfuschPresence($fields:[MetafieldsSetInput!]!){
      metafieldsSet(metafields:$fields){userErrors{code}}
    }`, { fields: [{ ownerId: gid(customerId), namespace: PLAYER_NAMESPACE, key: PRESENCE_KEY,
      type: 'json', value: JSON.stringify({ lastSeen: now }) }] }, fetcher);
    if (!isRecord(saved.metafieldsSet) || !Array.isArray(saved.metafieldsSet.userErrors) || saved.metafieldsSet.userErrors.length)
      throw new ApiError(503, 'presence_unavailable');
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return adminError(error); }
}
