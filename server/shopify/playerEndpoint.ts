import { ApiError, authenticateProxy, createCsrf, verifyCsrf, type ShopifyConfig } from './auth.js';
import { loadCustomerPlayer, saveCustomerPlayer, type ShopifyFetch } from './playerStore.js';
import { isRecord, sanitizeDigitalPlayer } from './playerValidation.js';
import type { Player } from '../../app/domain/types.js';
import { canSave, retainRunCount, storageAccess, type StorageAccess } from './storagePolicy.js';

export interface PlayerRequest {
  method: string;
  url: string;
  contentType?: string;
  readBody(): Promise<unknown>;
}
export interface PlayerEndpointDependencies {
  config: ShopifyConfig | null;
  request: ShopifyFetch;
  now?: () => number;
  afterSave?: (customerId: string, player: Player) => Promise<void>;
}
export interface JsonResult { status: number; body: Record<string, unknown> }

export async function handlePlayerRequest(input: PlayerRequest, dependencies: PlayerEndpointDependencies): Promise<JsonResult> {
  try {
    if (input.method !== 'GET' && input.method !== 'POST') throw new ApiError(405, 'method_not_allowed');
    const config = dependencies.config;
    if (!config) throw new ApiError(503, 'not_configured');
    const now = (dependencies.now ?? Date.now)();
    const identity = authenticateProxy(input.url, config, now);
    let result, storage: StorageAccess;
    if (input.method === 'GET') {
      const current = await loadCustomerPlayer(config, identity.customerId, dependencies.request);
      result = { player: current.player, compareDigest: current.compareDigest };
      storage = storageAccess(current.marketingState, current.player?.runsPlayed ?? 0);
    }
    else {
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(input.contentType ?? ''))
        throw new ApiError(415, 'json_required');
      const body = await input.readBody();
      if (!isRecord(body) || Object.keys(body).length !== 3 ||
        Object.keys(body).some(key => !['player', 'compareDigest', 'csrfToken'].includes(key)))
        throw new ApiError(400, 'invalid_request');
      verifyCsrf(body.csrfToken, identity, config.secret, now);
      if (body.compareDigest !== null && (typeof body.compareDigest !== 'string' || !/^[a-f0-9]{64}$/i.test(body.compareDigest)))
        throw new ApiError(400, 'invalid_compare_digest');
      const incoming = sanitizeDigitalPlayer(body.player, identity.customerId);
      // Re-read live consent on every save, including for a previously granted
      // session. Never write consent or accept it from a browser field.
      const current = await loadCustomerPlayer(config, identity.customerId, dependencies.request);
      const player = retainRunCount(incoming, current.player);
      storage = storageAccess(current.marketingState, player.runsPlayed);
      if (!canSave(current.marketingState, current.player?.runsPlayed ?? 0, player.runsPlayed))
        return { status: 403, body: { error: storage.reason === 'unsubscribed' ? 'newsletter_unsubscribed' : 'newsletter_required', storage } };
      if (body.compareDigest !== current.compareDigest) throw new ApiError(409, 'conflict');
      result = await saveCustomerPlayer(config, identity.customerId,
        player, body.compareDigest as string | null, dependencies.request);
      // A secondary digital leaderboard outage must never turn an acknowledged
      // cloud save into a failed save or cause a client to overwrite it again.
      try { await dependencies.afterSave?.(identity.customerId, result.player); } catch { /* Save is already durable. */ }
    }
    return { status: 200, body: { customer: { id: identity.customerId }, ...result, storage,
      csrfToken: createCsrf(identity, config.secret, now) } };
  } catch (error) {
    return error instanceof ApiError ? { status: error.status, body: { error: error.code } }
      : { status: 503, body: { error: 'service_unavailable' } };
  }
}
