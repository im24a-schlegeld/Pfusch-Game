import { ApiError, type ShopifyConfig } from '../shopify/auth.js';
import { gamePriceCatalog, loadGamePrices, saveGamePrice } from '../shopify/gamePrices.js';
import type { ShopifyFetch } from '../shopify/playerStore.js';
import { isRecord } from '../shopify/playerValidation.js';
import { verifyAdminIdToken } from './adminDashboard.js';
import { isDashboardEditor } from './adminPermissions.js';

const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' } });
const errorResponse = (error: unknown) => respond(error instanceof ApiError ? error.status : 503,
  { error: error instanceof ApiError ? error.code : 'game_prices_unavailable' });

export async function handlePublicGamePrices(method: string, config: ShopifyConfig | null, fetcher: ShopifyFetch) {
  if (method !== 'GET') return respond(405, { error: 'method_not_allowed' });
  if (!config) return respond(503, { error: 'not_configured' });
  try { const saved = await loadGamePrices(config, fetcher); return respond(200, { prices: saved.prices }); }
  catch (error) { return errorResponse(error); }
}

export async function handleAdminGamePrices(request: Request, config: ShopifyConfig | null,
  fetcher: ShopifyFetch, editorIds: string | undefined, now = Date.now()) {
  if (!config?.clientId) return respond(503, { error: 'admin_not_configured' });
  try {
    const staffId = await verifyAdminIdToken(request.headers.get('authorization'), config, now);
    if (request.method === 'GET') {
      const saved = await loadGamePrices(config, fetcher);
      return respond(200, { products: gamePriceCatalog(), prices: saved.prices,
        digest: saved.digest, editor: isDashboardEditor(staffId, editorIds) });
    }
    if (request.method !== 'POST') return respond(405, { error: 'method_not_allowed' });
    if (!isDashboardEditor(staffId, editorIds)) throw new ApiError(403, 'admin_editor_not_authorized');
    if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json')
      throw new ApiError(415, 'json_required');
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 256) throw new ApiError(413, 'too_large');
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new ApiError(400, 'invalid_json'); }
    if (!isRecord(body) || Object.keys(body).length !== 3 ||
      Object.keys(body).some(key => !['id', 'price', 'expected'].includes(key)))
      throw new ApiError(400, 'invalid_game_price');
    return respond(200, await saveGamePrice(config, fetcher, body.id, body.price, body.expected));
  } catch (error) { return errorResponse(error); }
}
