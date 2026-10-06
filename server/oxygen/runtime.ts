import { ApiError, readShopifyConfig } from '../shopify/auth.js';
import { handlePlayerRequest } from '../shopify/playerEndpoint.js';
import { handleRankingRequest, updateRanking } from '../shopify/leaderboard.js';
import { readBoundedWebJson, withFetchDeadline } from '../shopify/http.js';
import { authenticateOxygen, finishLogin, readOxygenAuth, sessionCookie, SHOP_ORIGINS, startLogin } from './auth.js';

export type OxygenEnvironment = Record<string, string | undefined>;
function harden(response: Response) {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Content-Security-Policy', `frame-ancestors 'self' ${SHOP_ORIGINS.join(' ')}`);
  return response;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
export async function handleOxygenRequest(request: Request, env: OxygenEnvironment, html: string, fetcher: typeof fetch = fetch) {
  try {
    const url = new URL(request.url), path = url.pathname;
    if (path === '/' || path === '/index.html') {
      if (!['GET', 'HEAD'].includes(request.method)) return harden(json(405, { error: 'method_not_allowed' }));
      const config = '<script type="application/json" id="pfusch-runtime-config">{"version":1,"mode":"oxygen"}</script>';
      if (!html.includes('</head>')) throw new ApiError(503, 'shell_unavailable');
      return harden(new Response(request.method === 'HEAD' ? null : html.replace('</head>', `${config}</head>`), { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
    }
    if (!['/auth/login', '/auth/callback', '/auth/logout', '/api/player', '/api/leaderboard'].includes(path)) return harden(json(404, { error: 'not_found' }));
    const config = readOxygenAuth(env);
    if (!config) throw new ApiError(503, 'not_configured');
    if (url.origin !== config.origin) throw new ApiError(403, 'invalid_origin');
    if (request.method === 'POST' && request.headers.get('origin') !== config.origin) throw new ApiError(403, 'invalid_origin');
    const boundedFetch = withFetchDeadline(fetcher, 10000);
    if (path === '/auth/login' || path === '/auth/callback') {
      if (request.method !== 'GET') throw new ApiError(405, 'method_not_allowed');
      return harden(await (path === '/auth/login' ? startLogin : finishLogin)(request, config, boundedFetch));
    }
    if (path === '/auth/logout') {
      if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed');
      return harden(new Response(null, { status: 204, headers: { 'Set-Cookie': sessionCookie('', 0) } }));
    }
    // Capture identity only in this server closure; request headers/query/body cannot supply it.
    const authenticate = () => authenticateOxygen(request, config, boundedFetch);
    const shopify = readShopifyConfig(env);
    const result = path === '/api/player'
      ? await handlePlayerRequest({ method: request.method, url: request.url, contentType: request.headers.get('content-type') ?? undefined,
        readBody: () => readBoundedWebJson(request) }, { config: shopify, request: boundedFetch, authenticate,
        afterSave: shopify ? (customerId, player) => updateRanking(shopify, customerId, player, withFetchDeadline(fetcher, 1500)) : undefined })
      : await handleRankingRequest(request.method, request.url, shopify, boundedFetch, Date.now(), authenticate);
    const response = json(result.status, result.body);
    if (result.status === 401) response.headers.set('Set-Cookie', sessionCookie('', 0));
    return harden(response);
  } catch (error) {
    const known = error instanceof ApiError;
    return harden(json(known ? error.status : 503, { error: known ? error.code : 'service_unavailable' }));
  }
}
