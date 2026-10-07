import type { ServerResponse } from 'node:http';
import { readShopifyConfig } from '../../server/shopify/auth.js';
import { handleRewardRequest, MAX_REWARD_FINISH_BODY_BYTES, type RewardAction } from '../../server/shopify/rewardEndpoint.js';
import { readBoundedJson, withFetchDeadline, type NodeRequest } from '../../server/shopify/http.js';

/** Legacy Node host: only Shopify-signed App Proxy identity is accepted. */
export default async function rewards(request: NodeRequest, response: ServerResponse) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const routes: Record<string, RewardAction> = { '/api/rewards/status': 'status', '/api/rewards/run/start': 'run/start',
    '/api/rewards/run/finish': 'run/finish', '/api/rewards/claim': 'claim' };
  const action = routes[new URL(request.url ?? '/', 'https://backend.invalid').pathname];
  const result = action ? await handleRewardRequest(action, { method: request.method ?? '', url: request.url ?? '',
    contentType: request.headers['content-type'], readBody: () => readBoundedJson(request, action === 'run/finish' ? MAX_REWARD_FINISH_BODY_BYTES : undefined) },
  { config: readShopifyConfig(process.env), enabled: process.env.SHOPIFY_GAME_REWARDS_ENABLED === 'true', request: withFetchDeadline(fetch, 15000) })
    : { status: 404, body: { error: 'not_found' } };
  if (result.status === 405) response.setHeader('Allow', action === 'status' ? 'GET' : 'POST');
  response.statusCode = result.status;
  response.end(JSON.stringify(result.body));
}
