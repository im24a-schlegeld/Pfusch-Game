import { validFlagCoinPrice } from '../../app/domain/economy.js';
import { ApiError, type ShopifyConfig } from '../shopify/auth.js';
import type { ShopifyFetch } from '../shopify/playerStore.js';
import { isRecord } from '../shopify/playerValidation.js';
import { loadEconomy, saveEconomy } from '../shopify/economyStore.js';
import { readBoundedWebJson } from '../shopify/http.js';
import { verifyAdminIdToken } from './adminDashboard.js';
import { isDashboardEditor } from './adminPermissions.js';

const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' } });

export async function handleAdminEconomy(request: Request, config: ShopifyConfig | null,
  fetcher: ShopifyFetch, editorIds: string | undefined, now = Date.now()) {
  if (!config?.clientId) return json(503, { error: 'admin_not_configured' });
  try {
    const staff = await verifyAdminIdToken(request.headers.get('authorization'), config, now);
    if (!isDashboardEditor(staff, editorIds)) throw new ApiError(403, 'admin_editor_not_authorized');
    if (request.method === 'GET') {
      const saved = await loadEconomy(config, fetcher);
      return json(200, { version: 1, flagCoinPrice: saved.economy.flagCoinPrice, compareDigest: saved.compareDigest });
    }
    if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed');
    if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json')
      throw new ApiError(415, 'json_required');
    const value = await readBoundedWebJson(request, 1024);
    if (!isRecord(value) || value.version !== 1 || !validFlagCoinPrice(value.flagCoinPrice)
      || !Object.hasOwn(value, 'compareDigest') || (value.compareDigest !== null
        && (typeof value.compareDigest !== 'string' || !/^[a-f0-9]{64}$/i.test(value.compareDigest)))
      || Object.keys(value).some(key => !['version', 'flagCoinPrice', 'compareDigest'].includes(key)))
      throw new ApiError(400, 'invalid_game_economy');
    return json(200, await saveEconomy(config, fetcher, value.flagCoinPrice, value.compareDigest as string | null, staff, now));
  } catch (error) {
    return json(error instanceof ApiError ? error.status : 503, { error: error instanceof ApiError ? error.code : 'economy_unavailable' });
  }
}
