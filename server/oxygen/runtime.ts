import { ApiError, readShopifyConfig } from '../shopify/auth.js';
import { handlePlayerRequest } from '../shopify/playerEndpoint.js';
import { loadCustomerPurchases } from '../shopify/purchaseStore.js';
import { finishReferral, handleReferralRequest } from '../shopify/referrals.js';
import { handleRankingRequest, updateRanking } from '../shopify/leaderboard.js';
import { handleRewardRequest, MAX_REWARD_FINISH_BODY_BYTES, type RewardAction } from '../shopify/rewardEndpoint.js';
import { readBoundedWebJson, withFetchDeadline } from '../shopify/http.js';
import { authenticateOxygen, clearSessionCookies, finishLogin, readOxygenAuth, SHOP_ORIGINS, startLogin } from './auth.js';
import installManifest from '../../public/manifest.json' with { type: 'json' };
import { handleAdminOverview, renderAdminDashboard } from './adminDashboard.js';

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
  let refreshedCookies: string[] = [];
  const authenticatedResponse = (response: Response) => {
    for (const value of refreshedCookies) response.headers.append('Set-Cookie', value);
    return harden(response);
  };
  try {
    const url = new URL(request.url), path = url.pathname;
    // Oxygen's asset CDN does not publish .webmanifest files. New pages use the
    // supported JSON asset, while existing tabs/installers retain this URL.
    // This metadata is public and never reads identity, cookies or Shopify.
    if (path === '/manifest.webmanifest') {
      if (!['GET', 'HEAD'].includes(request.method)) return harden(json(405, { error: 'method_not_allowed' }));
      return harden(new Response(request.method === 'HEAD' ? null : JSON.stringify(installManifest), {
        headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
      }));
    }
    if (path === '/' || path === '/index.html') {
      if (!['GET', 'HEAD'].includes(request.method)) return harden(json(405, { error: 'method_not_allowed' }));
      const config = '<script type="application/json" id="pfusch-runtime-config">{"version":1,"mode":"oxygen"}</script>';
      if (!html.includes('</head>')) throw new ApiError(503, 'shell_unavailable');
      return harden(new Response(request.method === 'HEAD' ? null : html.replace('</head>', `${config}</head>`), { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
    }
    // Embedded Shopify Admin app: isolated from the storefront/customer routes.
    // Shell has no customer information; JSON requires a signed App Bridge ID token.
    if (path === '/admin' || path === '/admin/' || path === '/api/admin/overview') {
      const shopify = readShopifyConfig(env), adminAuth = readOxygenAuth(env);
      if (!shopify?.clientId || !adminAuth) return harden(json(503, { error: 'admin_not_configured' }));
      if (url.origin !== adminAuth.origin) return harden(json(403, { error: 'invalid_origin' }));
      const response = path === '/api/admin/overview'
        ? await handleAdminOverview(request, shopify, withFetchDeadline(fetcher, 10000))
        : request.method === 'GET' ? renderAdminDashboard(shopify) : json(405, { error: 'method_not_allowed' });
      harden(response);
      response.headers.set('Content-Security-Policy', `frame-ancestors https://admin.shopify.com https://${shopify.shop}`);
      response.headers.set('Referrer-Policy', 'no-referrer');
      return response;
    }
    const rewardRoutes: Record<string, RewardAction> = { '/api/rewards/status': 'status', '/api/rewards/run/start': 'run/start',
      '/api/rewards/run/finish': 'run/finish', '/api/rewards/claim': 'claim' };
    const rewardAction = rewardRoutes[path];
    if (!rewardAction && !['/auth/login', '/auth/callback', '/auth/logout', '/api/player', '/api/leaderboard', '/api/referral'].includes(path)) return harden(json(404, { error: 'not_found' }));
    const config = readOxygenAuth(env);
    if (!config) throw new ApiError(503, 'not_configured');
    if (url.origin !== config.origin) throw new ApiError(403, 'invalid_origin');
    if (request.method === 'POST' && request.headers.get('origin') !== config.origin) throw new ApiError(403, 'invalid_origin');
    const boundedFetch = withFetchDeadline(fetcher, rewardAction ? 15000 : 10000);
    if (path === '/auth/login' || path === '/auth/callback') {
      if (request.method !== 'GET') throw new ApiError(405, 'method_not_allowed');
      return harden(await (path === '/auth/login' ? startLogin : finishLogin)(request, config, boundedFetch));
    }
    if (path === '/auth/logout') {
      if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed');
      const response = new Response(null, { status: 204 });
      for (const value of clearSessionCookies()) response.headers.append('Set-Cookie', value);
      return harden(response);
    }
    // Capture identity only in this server closure; request headers/query/body cannot supply it.
    const authenticate = () => authenticateOxygen(request, config, boundedFetch, Date.now(), cookies => { refreshedCookies = cookies; });
    const shopify = readShopifyConfig(env);
    // Purchase lookup has its own small budget; it cannot consume the cloud-save deadline.
    let playerFetch: typeof fetch | undefined;
    const requestPlayer: typeof fetch = (input, init) => (playerFetch ??= withFetchDeadline(fetcher, 10000))(input, init);
    const result = path === '/api/referral'
      ? await handleReferralRequest({ method: request.method, url: request.url, contentType: request.headers.get('content-type') ?? undefined,
        readBody: () => readBoundedWebJson(request, 2048) }, { config: shopify, request: requestPlayer, authenticate })
      : rewardAction
      ? await handleRewardRequest(rewardAction, { method: request.method, url: request.url, contentType: request.headers.get('content-type') ?? undefined,
        readBody: () => readBoundedWebJson(request, rewardAction === 'run/finish' ? MAX_REWARD_FINISH_BODY_BYTES : undefined) }, { config: shopify, request: boundedFetch, authenticate, enabled: env.SHOPIFY_GAME_REWARDS_ENABLED === 'true' })
      : path === '/api/player'
      ? await handlePlayerRequest({ method: request.method, url: request.url, contentType: request.headers.get('content-type') ?? undefined,
        readBody: () => readBoundedWebJson(request) }, { config: shopify, request: requestPlayer, authenticate,
        purchases: shopify ? customerId => loadCustomerPurchases(shopify, customerId, withFetchDeadline(fetcher, 5000)) : undefined,
        afterSave: shopify ? async (customerId, player) => {
          await Promise.allSettled([
            updateRanking(shopify, customerId, player, withFetchDeadline(fetcher, 1500)),
            ...(player.runsPlayed > 0 ? [finishReferral(shopify, customerId, withFetchDeadline(fetcher, 5000))] : []),
          ]);
        } : undefined })
      : await handleRankingRequest(request.method, request.url, shopify, boundedFetch, Date.now(), authenticate);
    // Retry a pending first-ride credit on the friend's next connection too,
    // even when the previous save succeeded but its secondary reward call failed.
    if (path === '/api/player' && request.method === 'GET' && result.status === 200 && shopify
      && 'customer' in result.body && 'player' in result.body) {
      const customer = result.body.customer as { id?: string } | undefined;
      const player = result.body.player as { runsPlayed?: number } | undefined;
      if (customer?.id && player?.runsPlayed && player.runsPlayed > 0)
        await finishReferral(shopify, customer.id, withFetchDeadline(fetcher, 2000)).catch(() => {});
    }
    const response = json(result.status, result.body);
    if (result.status === 401) refreshedCookies = clearSessionCookies();
    return authenticatedResponse(response);
  } catch (error) {
    const known = error instanceof ApiError;
    if (known && error.status === 401) refreshedCookies = clearSessionCookies();
    return authenticatedResponse(json(known ? error.status : 503, { error: known ? error.code : 'service_unavailable' }));
  }
}
