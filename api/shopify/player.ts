import type { ServerResponse } from 'node:http';
import { readShopifyConfig } from '../../server/shopify/auth.js';
import { handlePlayerRequest } from '../../server/shopify/playerEndpoint.js';
import { readBoundedJson, withFetchDeadline, type NodeRequest } from '../../server/shopify/http.js';
import { updateRanking } from '../../server/shopify/leaderboard.js';

/** Vercel Node function. Browser identity is accepted only through a signed
 * Shopify App Proxy request; no CORS or customer IDs from request bodies. */
export default async function player(request: NodeRequest, response: ServerResponse) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store, max-age=0');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const config = readShopifyConfig(process.env);
  const result = await handlePlayerRequest({ method: request.method ?? '', url: request.url ?? '',
    contentType: request.headers['content-type'], readBody: () => readBoundedJson(request) },
  { config, request: withFetchDeadline(fetch, 10000), afterSave: config ? (customerId, saved) =>
    updateRanking(config, customerId, saved, withFetchDeadline(fetch, 1500)) : undefined });
  if (result.status === 405) response.setHeader('Allow', 'GET, POST');
  response.statusCode = result.status;
  response.end(JSON.stringify(result.body));
}
