import type { ServerResponse } from 'node:http';
import { readShopifyConfig } from '../../server/shopify/auth.js';
import { handleRankingRequest } from '../../server/shopify/leaderboard.js';
import type { NodeRequest } from '../../server/shopify/http.js';

export default async function leaderboard(request: NodeRequest, response: ServerResponse) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const result = await handleRankingRequest(request.method ?? '', request.url ?? '', readShopifyConfig(process.env), fetch);
  if (result.status === 405) response.setHeader('Allow', 'GET');
  response.statusCode = result.status;
  response.end(JSON.stringify(result.body));
}
