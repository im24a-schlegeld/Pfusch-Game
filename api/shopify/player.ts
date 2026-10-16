import type { ServerResponse } from 'node:http';
import { readShopifyConfig } from '../../server/shopify/auth.js';
import { handlePlayerRequest } from '../../server/shopify/playerEndpoint.js';
import { readBoundedJson, withFetchDeadline, type NodeRequest } from '../../server/shopify/http.js';
import { updateRanking } from '../../server/shopify/leaderboard.js';
import { loadCustomerPurchases } from '../../server/shopify/purchaseStore.js';

/** Vercel Node function. Browser identity is accepted only through a signed
 * Shopify App Proxy request; no CORS or customer IDs from request bodies. */
export default async function player(request: NodeRequest, response: ServerResponse) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store, max-age=0');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const config = readShopifyConfig(process.env);
  let playerFetch: typeof fetch | undefined;
  const requestPlayer: typeof fetch = (input, init) => (playerFetch ??= withFetchDeadline(fetch, 10000))(input, init);
  const result = await handlePlayerRequest({ method: request.method ?? '', url: request.url ?? '',
    contentType: request.headers['content-type'], userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : undefined,
    mobileHint: typeof request.headers['sec-ch-ua-mobile'] === 'string' ? request.headers['sec-ch-ua-mobile'] : undefined,
    readBody: () => readBoundedJson(request) },
  { config, request: requestPlayer, purchases: config ? customerId => loadCustomerPurchases(config, customerId, withFetchDeadline(fetch, 5000)) : undefined,
    afterSave: config ? (customerId, saved) =>
    updateRanking(config, customerId, saved, withFetchDeadline(fetch, 1500)) : undefined });
  if (result.status === 405) response.setHeader('Allow', 'GET, POST');
  response.statusCode = result.status;
  response.end(JSON.stringify(result.body));
}
