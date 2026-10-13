import { ApiError, assertCustomerIdentity, createCsrf, verifyCsrf, type CustomerAuthenticator, type ShopifyConfig } from './auth.js';
import { PLAYER_KEY, PLAYER_NAMESPACE, shopifyGraphql, type ShopifyFetch } from './playerStore.js';
import { isRecord } from './playerValidation.js';
import { utf8 } from './crypto.js';
import type { JsonResult, PlayerRequest } from './playerEndpoint.js';
import { newPlayer } from '../../app/domain/progression.js';

export const REFERRAL_COINS = 150;
export const REFERRAL_KEY = 'invitation_v1';
const gid = (id: string) => `gid://shopify/Customer/${id}`;
const validId = (id: unknown): id is string => typeof id === 'string' && /^[1-9]\d{0,19}$/.test(id);
const encode = (data: Uint8Array) => btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (data: string) => Uint8Array.from(atob(data.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function key(config: ShopifyConfig) {
  const raw = await crypto.subtle.digest('SHA-256', utf8(`pfusch-invitation-v1\n${config.secret}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
/** Public opaque invitation: no customer ID, credentials or personal data in the URL. */
export async function createReferralCode(config: ShopifyConfig, customerId: string) {
  if (!validId(customerId)) throw new ApiError(400, 'invalid_invitation');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(config.shop) }, await key(config), utf8(customerId));
  return `v1.${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}
export async function readReferralCode(config: ShopifyConfig, code: unknown): Promise<string> {
  if (typeof code !== 'string' || code.length > 512 || !/^v1\.[\w-]{16}\.[\w-]+$/.test(code)) throw new ApiError(400, 'invalid_invitation');
  try {
    const [, iv, encrypted] = code.split('.');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: utf8(config.shop) }, await key(config), decode(encrypted));
    const id = new TextDecoder().decode(plain);
    if (validId(id)) return id;
  } catch { /* A modified or foreign-shop invitation grants no reward. */ }
  throw new ApiError(400, 'invalid_invitation');
}
type Field = { value: Record<string, unknown>; compareDigest: string } | null;
function field(raw: unknown): Field {
  if (raw === null) return null;
  if (!isRecord(raw) || typeof raw.value !== 'string' || raw.value.length > 131072 || typeof raw.compareDigest !== 'string' || !/^[a-f0-9]{64}$/i.test(raw.compareDigest)) throw new ApiError(502, 'invalid_invitation_state');
  try { const value: unknown = JSON.parse(raw.value); if (isRecord(value)) return { value, compareDigest: raw.compareDigest }; } catch { /* Invalid persisted data must not become an empty record. */ }
  throw new ApiError(502, 'invalid_invitation_state');
}
async function load(config: ShopifyConfig, id: string, request: ShopifyFetch) {
  const data = await shopifyGraphql(config, `query GameInvitation($id: ID!, $namespace: String!) {
    customer(id: $id) { id
      player: metafield(namespace: $namespace, key: "${PLAYER_KEY}") { value compareDigest }
      invitation: metafield(namespace: $namespace, key: "${REFERRAL_KEY}") { value compareDigest }
    }
  }`, { id: gid(id), namespace: PLAYER_NAMESPACE }, request);
  if (!isRecord(data.customer) || data.customer.id !== gid(id)) throw new ApiError(404, 'invitation_account_unavailable');
  return { player: field(data.customer.player), invitation: field(data.customer.invitation) };
}
function runs(player: Field): number {
  if (!player) return 0;
  const n = player.value.runsPlayed;
  if (player.value.version !== 1 || typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) throw new ApiError(502, 'invalid_saved_player');
  return n;
}
const writeField = (id: string, name: string, value: object, compareDigest: string | null) => ({ ownerId: gid(id), namespace: PLAYER_NAMESPACE, key: name, type: 'json', value: JSON.stringify(value), compareDigest });
async function setFields(config: ShopifyConfig, metafields: ReturnType<typeof writeField>[], request: ShopifyFetch) {
  const data = await shopifyGraphql(config, `mutation SaveGameInvitation($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { metafields { compareDigest } userErrors { code } }
  }`, { metafields }, request);
  const result = data.metafieldsSet;
  if (!isRecord(result) || !Array.isArray(result.userErrors)) throw new ApiError(502, 'invalid_shopify_response');
  if (result.userErrors.some(error => isRecord(error) && ['STALE_OBJECT', 'INVALID_COMPARE_DIGEST'].includes(String(error.code)))) throw new ApiError(409, 'conflict');
  if (result.userErrors.length || !Array.isArray(result.metafields) || result.metafields.length !== metafields.length) throw new ApiError(503, 'invitation_unavailable');
}

export async function acceptReferral(config: ShopifyConfig, invitee: string, inviter: string, request: ShopifyFetch) {
  if (invitee === inviter) throw new ApiError(400, 'self_invitation');
  const current = await load(config, invitee, request);
  if (current.invitation) {
    if (current.invitation.value.inviter !== inviter) throw new ApiError(409, 'invitation_already_used');
    return; // Retrying an accepted invitation cannot replace or pay it again.
  }
  if (runs(current.player) > 0) throw new ApiError(409, 'existing_player');
  await load(config, inviter, request); // Do not persist a deleted account as recipient.
  await setFields(config, [writeField(invitee, REFERRAL_KEY, { version: 1, inviter, state: 'pending' }, null)], request);
}

/** Two compare-and-set fields commit atomically: either both credit and receipt, or neither. */
export async function finishReferral(config: ShopifyConfig, invitee: string, request: ShopifyFetch) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await load(config, invitee, request);
    const claim = current.invitation;
    if (!claim || claim.value.state !== 'pending' || runs(current.player) < 1) return;
    const inviter = claim.value.inviter;
    if (!validId(inviter) || inviter === invitee || claim.value.version !== 1) throw new ApiError(502, 'invalid_invitation_state');
    const recipient = await load(config, inviter, request);
    const saved = recipient.player?.value ?? { ...newPlayer(), id: `shopify:${inviter}` };
    const coins = saved.coins;
    if (saved.version !== 1 || typeof coins !== 'number' || !Number.isSafeInteger(coins) || coins < 0 || coins > 1e9 - REFERRAL_COINS) throw new ApiError(502, 'invalid_saved_player');
    try {
      await setFields(config, [
        writeField(inviter, PLAYER_KEY, { ...saved, coins: coins + REFERRAL_COINS }, recipient.player?.compareDigest ?? null),
        writeField(invitee, REFERRAL_KEY, { ...claim.value, state: 'credited', coins: REFERRAL_COINS }, claim.compareDigest),
      ], request);
      return;
    } catch (error) { if (!(error instanceof ApiError) || error.code !== 'conflict' || attempt === 2) throw error; }
  }
}

export async function handleReferralRequest(input: PlayerRequest, deps: { config: ShopifyConfig | null; request: ShopifyFetch; authenticate: CustomerAuthenticator; now?: () => number }): Promise<JsonResult> {
  try {
    if (!['GET', 'POST'].includes(input.method)) throw new ApiError(405, 'method_not_allowed');
    if (!deps.config) throw new ApiError(503, 'not_configured');
    const config = deps.config, now = (deps.now ?? Date.now)();
    const identity = assertCustomerIdentity(await deps.authenticate(input.url, config, now), config);
    if (input.method === 'GET') return { status: 200, body: { code: await createReferralCode(config, identity.customerId), reward: REFERRAL_COINS, csrfToken: await createCsrf(identity, config.secret, now) } };
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(input.contentType ?? '')) throw new ApiError(415, 'json_required');
    const body = await input.readBody();
    if (!isRecord(body) || Object.keys(body).length !== 2 || !('code' in body) || !('csrfToken' in body)) throw new ApiError(400, 'invalid_request');
    await verifyCsrf(body.csrfToken, identity, config.secret, now);
    await acceptReferral(config, identity.customerId, await readReferralCode(config, body.code), deps.request);
    return { status: 200, body: { accepted: true } };
  } catch (error) {
    return error instanceof ApiError ? { status: error.status, body: { error: error.code } } : { status: 503, body: { error: 'invitation_unavailable' } };
  }
}
