import { ApiError, type ShopifyConfig } from '../shopify/auth.js';
import { isRecord } from '../shopify/playerValidation.js';
import { shopifyGraphql, PLAYER_KEY, PLAYER_NAMESPACE, type ShopifyFetch } from '../shopify/playerStore.js';
import { REWARD_KEY } from '../shopify/rewardStore.js';
import { verifyHmacHex } from '../shopify/crypto.js';
import { isDashboardEditor } from './adminPermissions.js';
import { savedPlayerStatistics } from './adminStatistics.js';

const RANKING_KEY = 'leaderboard_v1';
const SAMPLE_SIZE = 25;
const encoder = new TextEncoder();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' },
});
const nonnegative = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
/** Validate UTF-16 code units without decomposing Unicode grapheme clusters. */
function safeRankingName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 24) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return false;
  }
  return true;
}

const canonicalJson = (value: unknown) => JSON.stringify(value, (_key, field: unknown) =>
  isRecord(field) ? Object.fromEntries(Object.keys(field).sort().map(key => [key, field[key]])) : field);

/** Shopify App Bridge ID tokens, not storefront customer cookies or URL query parameters. */
export async function verifyAdminIdToken(raw: string | null, config: ShopifyConfig, now = Date.now()): Promise<string> {
  if (!config.clientId || !raw || raw.length > 6000 || !/^Bearer [A-Za-z0-9._-]+$/.test(raw)) throw new ApiError(401, 'admin_unauthorized');
  const parts = raw.slice(7).split('.');
  if (parts.length !== 3 || parts.some(part => !part || part.length > 4096)) throw new ApiError(401, 'admin_unauthorized');
  const decode = (text: string) => {
    if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('invalid base64url');
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '='));
    const bytes = Uint8Array.from(binary, value => value.charCodeAt(0));
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  };
  try {
    const header = decode(parts[0]), claims = decode(parts[1]);
    if (!isRecord(header) || header.alg !== 'HS256' || !isRecord(claims)) throw new Error('invalid JWT');
    const signature = decodeBytes(parts[2]);
    if (signature.length !== 32) throw new Error('invalid HMAC');
    const key = await crypto.subtle.importKey('raw', encoder.encode(config.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC', key, signature, encoder.encode(`${parts[0]}.${parts[1]}`))) throw new Error('invalid signature');
    const nowSeconds = Math.floor(now / 1000);
    if (claims.aud !== config.clientId || typeof claims.exp !== 'number' || !Number.isInteger(claims.exp)
      || typeof claims.nbf !== 'number' || !Number.isInteger(claims.nbf)
      || typeof claims.iat !== 'number' || !Number.isInteger(claims.iat) || Number(claims.exp) <= nowSeconds - 5
      || Number(claims.nbf) > nowSeconds + 5 || Number(claims.iat) > nowSeconds + 5
      || Number(claims.exp) - Number(claims.iat) > 180 || Number(claims.exp) < Number(claims.iat)
      || typeof claims.sub !== 'string' || !/^[1-9]\d{0,19}$/.test(claims.sub)) throw new Error('invalid claims');
    if (typeof claims.dest !== 'string' || typeof claims.iss !== 'string') throw new Error('missing shop');
    const dest = new URL(claims.dest), issuer = new URL(claims.iss);
    if (dest.protocol !== 'https:' || issuer.protocol !== 'https:' || dest.origin !== `https://${config.shop}`
      || dest.hostname !== issuer.hostname || issuer.origin !== dest.origin || issuer.pathname !== '/admin'
      || dest.pathname !== '/' || dest.search || issuer.search || dest.hash || issuer.hash || dest.username || issuer.username)
      throw new Error('untrusted shop');
    return claims.sub;
  } catch { throw new ApiError(401, 'admin_unauthorized'); }
}
function decodeBytes(text: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('invalid base64url');
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=')), value => value.charCodeAt(0));
}

interface SampledPlayer { runsPlayed: number; coins: number; totalDistance: number; bellsRemaining: number; bellsSpent: number; saved: Record<string, unknown> }
function playerSummary(raw: unknown): SampledPlayer | null {
  if (typeof raw !== 'string' || raw.length > 50000) return null;
  try {
    const p: unknown = JSON.parse(raw);
    if (!isRecord(p) || p.version !== 1 || !nonnegative(p.runsPlayed) || !nonnegative(p.coins) || !nonnegative(p.totalDistance)) return null;
    const bells = p.guardianBells;
    const earned = isRecord(bells) && nonnegative(bells.earned) ? bells.earned : 0;
    const spent = isRecord(bells) && nonnegative(bells.spent) ? bells.spent : 0;
    if (spent > earned || earned > 100000) return null;
    return { runsPlayed: p.runsPlayed, coins: p.coins, totalDistance: Math.floor(p.totalDistance),
      bellsRemaining: earned - spent, bellsSpent: spent, saved: p };
  } catch { return null; }
}
async function rewardSummary(raw: unknown, config: ShopifyConfig, customerId: string) {
  if (typeof raw !== 'string' || raw.length > 40000) return null;
  try {
    const envelope: unknown = JSON.parse(raw);
    if (!isRecord(envelope) || !isRecord(envelope.ledger) || typeof envelope.signature !== 'string'
      || !/^[a-f0-9]{64}$/.test(envelope.signature)) return null;
    const message = `pfusch-verified-ledger-v1\n${config.shop}\n${customerId}\n${canonicalJson(envelope.ledger)}`;
    if (!await verifyHmacHex(envelope.signature, message, config.secret)) return null;
    const ledger = envelope.ledger;
    if (!nonnegative(ledger.points) || !nonnegative(ledger.runs)) return null;
    const reservations = [ledger.reward, ...(Array.isArray(ledger.rewardHistory) ? ledger.rewardHistory.slice(0, 8) : [])];
    return { points: ledger.points, runs: ledger.runs, issued: reservations.filter(r => isRecord(r) && r.state === 'issued').length };
  } catch { return null; }
}

/** Read-only, bounded sample of recently updated Shopify customers, not a full census. */
export async function readAdminOverview(config: ShopifyConfig, request: ShopifyFetch, now = Date.now()) {
  const data = await shopifyGraphql(config, `query PfuschAdminDashboard($namespace: String!, $player: String!, $reward: String!, $ranking: String!, $limit: Int!) {
    shop { name currencyCode metafield(namespace: $namespace, key: $ranking) { value } }
    currentAppInstallation { accessScopes { handle } }
    customers(first: $limit, sortKey: UPDATED_AT, reverse: true) {
      nodes { id playerField: metafield(namespace: $namespace, key: $player) { value }
                 rewardField: metafield(namespace: $namespace, key: $reward) { value } }
      pageInfo { hasNextPage }
    }
  }`, { namespace: PLAYER_NAMESPACE, player: PLAYER_KEY, reward: REWARD_KEY, ranking: RANKING_KEY, limit: SAMPLE_SIZE }, request);
  if (!isRecord(data.shop) || typeof data.shop.name !== 'string' || !isRecord(data.customers)
    || !Array.isArray(data.customers.nodes) || data.customers.nodes.length > SAMPLE_SIZE)
    throw new ApiError(502, 'invalid_admin_data');
  const metrics = { players: 0, runs: 0, distanceKm: 0, coins: 0, bellsAvailable: 0, bellsSpent: 0,
    verifiedRuns: 0, verifiedPoints: 0, issuedCoupons: 0 };
  const rows: { rider: string; runs: number; coins: number; bells: number }[] = [];
  const savedPlayers: Record<string, unknown>[] = [];
  for (const node of data.customers.nodes) {
    if (!isRecord(node) || typeof node.id !== 'string') continue;
    const match = /^gid:\/\/shopify\/Customer\/([1-9]\d{0,19})$/.exec(node.id);
    if (!match) continue;
    const summary = isRecord(node.playerField) ? playerSummary(node.playerField.value) : null;
    if (summary) {
      savedPlayers.push(summary.saved);
      metrics.players++; metrics.runs += summary.runsPlayed; metrics.coins += summary.coins;
      metrics.distanceKm += summary.totalDistance / 1000; metrics.bellsAvailable += summary.bellsRemaining;
      metrics.bellsSpent += summary.bellsSpent;
      rows.push({ rider: `SPIELER ${String(rows.length + 1).padStart(2, '0')}`, runs: summary.runsPlayed,
        coins: summary.coins, bells: summary.bellsRemaining });
    }
    const reward = isRecord(node.rewardField) ? await rewardSummary(node.rewardField.value, config, match[1]) : null;
    if (reward) { metrics.verifiedRuns += reward.runs; metrics.verifiedPoints += reward.points; metrics.issuedCoupons += reward.issued; }
  }
  metrics.distanceKm = Math.round(metrics.distanceKm * 10) / 10;
  let top: { name: string; score: number }[] = [];
  if (isRecord(data.shop.metafield) && typeof data.shop.metafield.value === 'string' && data.shop.metafield.value.length < 32768) {
    try {
      const board: unknown = JSON.parse(data.shop.metafield.value);
      if (isRecord(board) && isRecord(board.all) && Array.isArray(board.all.rows))
        top = board.all.rows.slice(0, 10).filter((entry): entry is Record<string, unknown> =>
          isRecord(entry) && nonnegative(entry.score) && entry.score > 0).map(entry => ({
          name: safeRankingName(entry.name) ? entry.name : 'RIDER', score: entry.score as number,
        }));
    } catch { /* Invalid ranking stays unavailable; no impact on game data. */ }
  }
  const scopes = isRecord(data.currentAppInstallation) && Array.isArray(data.currentAppInstallation.accessScopes)
    ? data.currentAppInstallation.accessScopes.filter(isRecord).map(scope => scope.handle).filter((value): value is string => typeof value === 'string') : [];
  return { shop: data.shop.name.slice(0, 100), currency: data.shop.currencyCode === 'CHF' ? 'CHF' : 'other',
    sampledCustomers: data.customers.nodes.length, moreCustomers: isRecord(data.customers.pageInfo) && data.customers.pageInfo.hasNextPage === true,
    sampleOnly: true, metrics, rows, top, statistics: savedPlayerStatistics(savedPlayers), diagnostics: { customersAccess: scopes.includes('write_customers') || scopes.includes('read_customers'),
      discountsAccess: scopes.includes('write_discounts'), serverClock: new Date(now).toISOString() } };
}

export async function handleAdminOverview(request: Request, config: ShopifyConfig | null, shopifyFetch: ShopifyFetch = fetch, now = Date.now(), editorIds?: string): Promise<Response> {
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' });
  if (!config?.clientId) return json(503, { error: 'admin_not_configured' });
  try {
    const staffId = await verifyAdminIdToken(request.headers.get('Authorization'), config, now);
    if (!isDashboardEditor(staffId, editorIds)) throw new ApiError(403, 'admin_editor_not_authorized');
    return json(200, await readAdminOverview(config, shopifyFetch, now));
  } catch (error) {
    return json(error instanceof ApiError ? error.status : 503, { error: error instanceof ApiError ? error.code : 'admin_unavailable' });
  }
}

/** No privileged data in this shell; the browser asks Shopify App Bridge for a signed token. */
export function renderAdminDashboard(config: ShopifyConfig | null): Response {
  if (!config?.clientId || !/^[A-Za-z0-9_-]{6,200}$/.test(config.clientId))
    return new Response('Shopify-Admin-App nicht konfiguriert.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const html = String.raw`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="shopify-api-key" content="__API_KEY__"><title>Wheelie Escape · Shopify Verwaltung</title>
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;color:#303030;background:#f1f1f1;font-size:14px;font-synthesis:none;line-height:1.45}*{box-sizing:border-box}body{margin:0}button,input,select{font:inherit}button{cursor:pointer}button:disabled{opacity:.5;cursor:not-allowed}button,input,select,summary{outline-offset:3px}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid #005bd3}h1,h2,h3,p{overflow-wrap:anywhere}h1{font-size:27px;letter-spacing:-.65px;line-height:1.2;margin:5px 0 7px;font-weight:700}h2{font-size:16px;margin:0;font-weight:650}h3{font-size:15px;margin:0;font-weight:650}p{margin:0}main{max-width:1440px;margin:0 auto;padding:28px 28px 48px}.top{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:22px}.eyebrow{font-size:12px;color:#616161;font-weight:550}.subtitle,.muted{color:#616161}.subtitle{font-size:13px}.actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.btn{background:#fff;border:1px solid #b5b5b5;border-radius:8px;color:#303030;padding:8px 13px;font-weight:600;min-height:38px;box-shadow:0 1px 1px #0000000d;line-height:1.3}.btn:hover:not(:disabled){background:#f7f7f7;border-color:#8a8a8a}.btn.primary{background:#303030;color:#fff;border-color:#303030;box-shadow:inset 0 1px #ffffff26,0 1px 1px #00000026}.btn.primary:hover:not(:disabled){background:#151515}.pill{display:inline-flex;gap:7px;align-items:center;border:1px solid #d7d7d7;border-radius:999px;font-size:12px;padding:5px 10px;background:#fff;color:#616161;white-space:nowrap}.green{background:#e4f5e9;color:#12652e;border-color:#bedfc7}.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:0 0 22px}.card{min-width:0;background:#fff;border:1px solid #ddd;border-radius:12px;box-shadow:0 1px 2px #00000008;overflow:hidden}.stat{padding:17px 20px}.stat .num{font-size:29px;font-weight:700;line-height:1.1;margin:12px 0 6px;font-variant-numeric:tabular-nums;letter-spacing:-.6px}.stat .label{font-size:12px;color:#616161}.stat .context{font-size:11px;color:#767676}.layout{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(360px,1fr);gap:18px;align-items:start}.card-head{display:flex;justify-content:space-between;align-items:center;padding:17px 20px;border-bottom:1px solid #e6e6e6;gap:12px;flex-wrap:wrap}.card-body{padding:20px}.search{border:1px solid #aaa;padding:10px 12px;border-radius:8px;width:100%;background:#fff;color:#303030;min-height:40px}.filters{display:flex;gap:9px;align-items:center;padding:16px 20px;flex-wrap:wrap}.filters input{flex:1;min-width:140px}.filter-select{padding:9px 10px;background:#fff;color:#303030;border:1px solid #aaa;border-radius:8px;max-width:230px;min-height:40px}.filters .filter-select{flex-basis:100%;max-width:none}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse}th{background:#f8f8f8;text-align:left;color:#616161;font-size:12px;font-weight:600}td,th{padding:13px 16px;border-top:1px solid #e9e9e9;vertical-align:middle}td{font-size:13px;font-variant-numeric:tabular-nums}td:first-child{width:45%}tbody tr:hover{background:#fafafa}tbody tr.selected{background:#f0f5ff}tbody tr.selected td:first-child{box-shadow:inset 3px 0 #005bd3}.player-btn{border:0;background:transparent;text-align:left;font-weight:650;text-decoration:underline;text-decoration-color:#b5b5b5;text-underline-offset:3px;color:#303030;padding:3px 0;overflow-wrap:anywhere}.player-btn:hover{text-decoration-color:#303030}.email{color:#616161;font-size:12px;overflow-wrap:anywhere;margin-top:2px}.table-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 20px;border-top:1px solid #eee}.table-actions .mini{max-width:430px}.table-actions .btn{flex-shrink:0}.badge{display:inline-block;border-radius:6px;padding:3px 7px;font-size:11px;background:#eee;color:#616161;white-space:nowrap}.badge.online{background:#e4f5e9;color:#146c37}.detail-empty{padding:48px 25px;color:#616161;text-align:center}.detail-empty strong{display:block;color:#303030;margin-bottom:7px}.detail-empty p{font-size:13px;max-width:260px;margin:auto}.editor{padding:20px}.identity{padding-bottom:4px}.identity h3{font-size:19px;margin:4px 0}.identity h3:focus{outline:none}.editor label,.field-label{display:block;font-size:12px;font-weight:600;margin:14px 0 6px}.editor input,.editor select{width:100%;min-width:0;padding:10px;border:1px solid #aaa;border-radius:8px;background:#fff;color:#303030;min-height:40px}.editor input:disabled,.editor select:disabled{background:#f6f6f6;color:#777}.editor .buttons{display:flex;gap:9px;margin-top:16px;flex-wrap:wrap}.section-sub{font-size:12px;color:#616161;line-height:1.5;margin-top:7px}.notice{background:#f8f8f8;border:1px solid #e3e3e3;border-radius:8px;padding:12px;color:#616161;line-height:1.5;font-size:12px;margin-top:15px}.error{color:#b42318;font-size:13px;font-weight:600;margin:12px 0}.success{color:#106c34;font-size:13px;font-weight:600;margin:12px 0}.mini{font-size:12px;color:#616161}.cols{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.cols>div{min-width:0}.cols b{overflow-wrap:anywhere}.footer{margin-top:20px;font-size:12px;color:#616161;line-height:1.5}.edit-section{border:1px solid #dedede;border-radius:8px;margin:12px 0 0;padding:0;min-width:0}.edit-section>summary,.dashboard-disclosure>summary{padding:13px 14px;font-weight:600;cursor:pointer;min-height:46px}.edit-section>summary::marker,.dashboard-disclosure>summary::marker{color:#616161}.edit-section[open]>summary,.dashboard-disclosure[open]>summary{border-bottom:1px solid #e6e6e6}.edit-section>summary:hover,.dashboard-disclosure>summary:hover{background:#f7f7f7}.disclosure-content{padding:0 14px 14px}.gift-section[open]{border-color:#c7dccd;background:#f6fbf7}.dashboard-disclosure{margin-top:14px}.dashboard-disclosure .kpis{margin:0 0 20px}.dashboard-disclosure .stat{box-shadow:none;background:#fafafa}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}#garageEditor .badge{float:right}#garageEditor .catalog-grid{grid-template-columns:repeat(2,minmax(0,1fr));padding:14px;gap:10px}#garageEditor .catalog-section{padding:0 14px 14px}#garageEditor .asset-actions{width:100%;flex-wrap:wrap}#garageEditor .asset-actions button{flex:1}#garageEditor .catalog-row .asset-name{flex-basis:100%}.gift-section .buttons .btn{width:100%}.gift-section .section-sub{color:#486650}.gift-feedback:empty{display:none}.readonly-field{padding:9px 11px;border-radius:8px;border:1px solid #e3e3e3;background:#f7f7f7;overflow-wrap:anywhere;font-size:13px}.system-grid{gap:24px}.system-grid b{display:block;margin-top:5px}.catalog-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;padding:20px}.catalog-grid label{font-size:12px;color:#555;display:block;font-weight:600}.catalog-grid select{display:block;width:100%;padding:10px;border:1px solid #aaa;border-radius:8px;background:#fff;margin-top:6px;min-height:40px}.catalog-section{padding:0 20px 20px}.catalog-section summary{font-size:14px;font-weight:600;cursor:pointer;padding:12px;background:#f7f7f7;border-radius:8px;margin:7px 0}.catalog-row{display:flex;align-items:center;gap:9px;padding:11px 3px;border-bottom:1px solid #eee;flex-wrap:wrap;min-height:42px}.catalog-row:last-child{border-bottom:0}.catalog-row .asset-name{flex:1;min-width:150px;font-size:13px}.catalog-row .asset-status{font-size:11px;color:#616161}.catalog-row .asset-actions{display:flex;gap:6px}.catalog-row button{padding:7px 9px;min-height:34px;font-size:12px}.color-dot{display:inline-block;width:16px;height:16px;border:1px solid #aaa;border-radius:5px;vertical-align:middle;margin-right:6px}#inventorySearch{max-width:520px}#message:empty{display:none}#message:not(:empty){border:1px solid currentColor;border-radius:8px;padding:11px 14px;margin:0 0 16px;background:#fff}#editMessage:not(:empty),#giftFeedback:not(:empty){margin-top:12px;line-height:1.5}.hidden,[hidden]{display:none!important}
@media(max-width:1100px){.layout{grid-template-columns:minmax(0,1.3fr) minmax(330px,1fr)}.editor .cols{grid-template-columns:repeat(2,minmax(0,1fr))}.table-wrap td,.table-wrap th{padding:12px}.catalog-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:920px){.layout{grid-template-columns:minmax(0,1fr)}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.editor .cols{grid-template-columns:repeat(3,minmax(0,1fr))}#playerDetail{scroll-margin-top:16px}}
@media(max-width:760px){main{padding:18px 12px 35px;max-width:100%}.top{align-items:flex-start;flex-direction:column;gap:15px;margin-bottom:18px}.top h1{font-size:24px}.top .actions{width:100%;justify-content:space-between;gap:8px}.kpis{gap:9px;margin-bottom:16px}.stat{padding:13px}.stat .num{font-size:25px;margin:9px 0 4px}.stat .label{font-size:12px}.layout{gap:14px}.card-head,.card-body,.editor{padding:16px}.card-head h2{font-size:16px}.filters{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:13px}.filters input{min-width:0}.filters .filter-select{grid-column:1/-1;width:100%}.btn,.filter-select,.search,.editor input,.editor select,.catalog-grid select{min-height:44px}.table-wrap{padding:0 12px;overflow:visible}table,tbody{display:block;width:100%}thead{display:none}tbody tr{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px 7px;border:1px solid #e3e3e3;border-radius:9px;padding:12px;margin:0 0 9px;background:#fff}tbody tr.selected{border-color:#9dbbea}tbody tr.selected td:first-child{box-shadow:none}.table-wrap td{display:block;width:auto;padding:5px 2px;border:0;min-width:0;overflow-wrap:anywhere;font-size:12px}.table-wrap td:first-child{grid-column:1/-1;border-bottom:1px solid #e6e6e6;padding-bottom:10px;font-size:14px}.table-wrap td:nth-child(2):before{content:'Fahrten';display:block;color:#616161;font-size:11px;margin-bottom:4px}.table-wrap td:nth-child(3):before{content:'Coins';display:block;color:#616161;font-size:11px;margin-bottom:4px}.table-wrap td:nth-child(4):before{content:'Aktivität';display:block;color:#616161;font-size:11px;margin-bottom:4px}.player-btn{min-height:36px;width:100%}.table-actions{padding:12px;align-items:flex-start;flex-wrap:wrap}.table-actions .btn{width:100%}.editor .cols,.cols{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.editor .buttons .btn{width:100%}.catalog-grid{padding:16px;gap:12px}.catalog-section{padding:0 16px 16px}.catalog-row{gap:7px;padding:11px 0}.catalog-row .asset-name{min-width:120px;flex-basis:100%}.catalog-row .asset-actions{width:100%;gap:6px;flex-wrap:wrap}.catalog-row .asset-actions button{flex:1 1 100px;min-height:44px}#inventorySearch{max-width:none;width:100%}.system-grid{grid-template-columns:1fr}.footer{font-size:11px}}
@media(max-width:380px){.top .actions{align-items:stretch;flex-direction:column}.pill{align-self:flex-start}.editor .cols,.catalog-grid{grid-template-columns:1fr}.stat{padding:11px}.stat .num{font-size:23px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
</style></head><body><main>
<header class="top"><div><div class="eyebrow">Wheelie Escape · Shopify</div><h1>Spielerverwaltung</h1></div><div class="actions"><span class="pill" id="connection">Verbindung wird geprüft</span><button class="btn" id="refresh" type="button">Aktualisieren</button></div></header>
<div id="message" role="status" aria-live="polite"></div>


<section id="playersPanel" aria-label="Spielerverwaltung">
<div class="layout">
<section class="card"><div class="card-head"><div><h2>Spieler &amp; Kunden</h2></div><span class="badge" id="resultCount">–</span></div>
<div class="filters"><input class="search" type="search" id="search" maxlength="80" placeholder="Kundenname oder E-Mail suchen" aria-label="Shopify-Kunden suchen"><button class="btn" id="searchBtn" type="button">Suchen</button><select class="filter-select" id="registrationFilter" aria-label="Kunden nach Spielstand filtern"><option value="all">Alle Shopify-Kunden</option><option value="with">Mit Spielstand</option><option value="without">Ohne Spielstand</option></select></div>
<div class="table-wrap"><table><thead><tr><th>Benutzer / E-Mail</th><th>Fahrten</th><th>Coins</th><th>Aktivität</th></tr></thead><tbody id="users"><tr><td colspan="4">Daten werden geladen …</td></tr></tbody></table></div>
<div class="table-actions"><span class="mini" id="pagingInfo">E-Mail wird angezeigt, soweit Shopify sie freigibt.</span><button class="btn" id="next" type="button" disabled>Weitere Kunden</button></div></section>
<aside class="card" id="playerDetail" aria-labelledby="detailHeading"><div class="card-head"><h2 id="detailHeading">Spielerdetails</h2><span class="badge" id="editStatus">Auswahl</span></div>
<div id="empty" class="detail-empty"><strong>Spieler auswählen</strong><p>Wähle einen Kunden aus der Liste.</p></div>
<form id="editor" class="editor hidden">
<div class="identity"><div class="eyebrow" id="customerId">–</div><h3 id="customerName" tabindex="-1">–</h3><span class="sr-only" id="emailLabel">E-Mail-Adresse · Shopify-Kundenkonto</span><div id="editEmail" class="email" aria-labelledby="emailLabel">–</div><div class="section-sub" id="permissionHint">Berechtigung wird geprüft.</div></div>
<details id="giftSection" class="edit-section gift-section"><summary>Geschenk senden</summary>
<section aria-label="Geschenk senden" class="disclosure-content"><p class="section-sub">Zusätzliche Gutschrift.</p>
<label for="giftKind">Geschenk</label><select id="giftKind"><option value="coins">Coins</option><option value="guardianBells">Guardian Bells</option></select>
<label for="giftAmount">Menge</label><input id="giftAmount" type="number" min="1" max="2000" step="1" value="100" inputmode="numeric" aria-describedby="giftLimit"><p id="giftLimit" class="section-sub">1 bis 2’000 Coins pro Geschenk.</p>
<label for="giftMessage">Nachricht (optional, max. 80 Zeichen)</label><input id="giftMessage" type="text" maxlength="80">
<div class="buttons"><button class="btn primary" id="sendGift" type="button">Geschenk senden</button></div>
<div id="giftFeedback" role="status" aria-live="polite" class="mini"></div>
</section></details>
<details id="valuesSection" class="edit-section"><summary>Spielwerte korrigieren</summary><div class="disclosure-content"><p class="section-sub">Absolute Werte ersetzen den gespeicherten Stand.</p>
<div class="cols"><div><label for="editCoins">Coins</label><input id="editCoins" type="number" min="0" max="1000000000" step="1"></div>
<div><label for="editXp">XP</label><input id="editXp" type="number" min="0" max="1000000000" step="1"></div>
<div><label for="editBells">Bells verdient</label><input id="editBells" type="number" min="0" max="100000" step="1"></div></div>
<div class="cols"><div><label for="editHighScore">Highscore</label><input id="editHighScore" type="number" min="0" max="1000000000" step="1"></div>
<div><label for="editRuns">Fahrten</label><input id="editRuns" type="number" min="0" max="1000000000" step="1"></div><div><label for="editDistance">Meter gesamt</label><input id="editDistance" type="number" min="0" max="1000000000" step="1"></div>
<div><label for="editNearMisses">Knapp vorbei</label><input id="editNearMisses" type="number" min="0" max="1000000000" step="1"></div>
<div><label for="editWheelie">Wheelie-Meter</label><input id="editWheelie" type="number" min="0" max="1000000000" step="1"></div></div>
<div class="section-sub" id="playerDetails">Gespeicherte digitale Spielwerte.</div>
<div class="buttons"><button class="btn primary" id="saveGame" type="button">Spielwerte speichern</button></div>
<div class="notice">Änderungen werden protokolliert. Aktive Spielsessions können Speicherkonflikte auslösen.</div>
</div></details>
<div id="editMessage" role="status" aria-live="polite" class="mini"></div>
<details class="edit-section hidden" id="garageEditor"><summary>Inventar &amp; Garage <span class="badge" id="garageStatus">Nur Lesen</span></summary>
<div class="catalog-grid" id="appearanceSelectors"></div>
<div class="catalog-section"><label for="editRiderName">Name in der Bestenliste</label><div class="actions" style="margin-top:7px"><input class="search" id="editRiderName" maxlength="24" style="max-width:320px" placeholder="RIDER" aria-label="Bestenlistenname"><button class="btn" type="button" id="saveRiderName">Name speichern</button></div></div>
<div class="catalog-section"><input class="search" type="search" id="inventorySearch" placeholder="Inventar durchsuchen: Artikel, Farben, Motorrad …" aria-label="Inventar durchsuchen"><div id="inventoryContent"></div></div>
<div class="catalog-section"><label for="stickerTarget">Stickerplatzierungen zurücksetzen</label><div class="actions" style="margin-top:8px"><select id="stickerTarget" class="filter-select" aria-label="Sticker-Ziel"></select><button class="btn" id="resetStickers" type="button">Sticker dieses Ziels entfernen</button></div></div>
<p class="section-sub" style="margin:0 14px 14px">Änderungen betreffen ausschliesslich die digitale Garage.</p>
</details>
</form></aside></div>

</section>
<details id="economyPanel" class="card dashboard-disclosure"><summary>Spielpreise</summary><div class="card-body">
<label class="field-label" for="flagCoinPrice">Flagge · Preis in Coins</label>
<input id="flagCoinPrice" class="search" type="number" min="1" max="1000000000" step="1" inputmode="numeric" disabled aria-describedby="economyHint">
<p id="economyHint" class="section-sub">Gilt für die digitale Freischaltung im Spiel. Der neue Preis gilt beim nächsten Laden des Spiels. Offline gilt der zuletzt geladene Preis.</p>
<div class="buttons"><button id="saveEconomy" class="btn primary" type="button" disabled>Flaggenpreis speichern</button><button id="reloadEconomy" class="btn" type="button">Preis neu laden</button></div>
<div id="economyFeedback" class="mini" role="status" aria-live="polite"></div>
</div></details>
<details id="statisticsPanel" class="card dashboard-disclosure"><summary>Statistik</summary><div class="card-body"><section class="kpis" aria-label="Dashboard Kennzahlen">
<div class="card stat"><div class="label">Live-Spieler</div><div class="num" id="live">–</div><div class="context">Aktuelle Kundenseite</div></div>
<div class="card stat"><div class="label">Gespeicherte Spielstände</div><div class="num" id="players">–</div><div class="context">Stichprobe · bis zu 25 Kunden</div></div>
<div class="card stat"><div class="label">Fahrten</div><div class="num" id="runs">–</div><div class="context">Gespeichert in der Stichprobe</div></div>
<div class="card stat"><div class="label">Verifizierte Shop-Punkte</div><div class="num" id="verified">–</div><div class="context">Servergeprüft · Stichprobe</div></div>
</section>
<section aria-label="Spielstatistik Stichprobe"><label class="field-label" for="statisticsTopic">Auswertung</label><select class="filter-select" id="statisticsTopic" aria-label="Statistikthema"><option>Daten werden geladen …</option></select><div id="statisticsRows" role="status">–</div><p class="section-sub" id="statisticsSample">Bis zu 25 zuletzt aktualisierte Kunden: letzter gespeicherter Spielstand, keine Besucher- oder Sessionstatistik. Fehlende Angaben bleiben unbekannt; Gerätekategorien sind unverifiziert.</p></section>
<p class="section-sub">Live zählt angemeldete Spieler mit aktiver, sichtbarer Spielseite und Shopify-Verbindung auf der aktuellen Kundenseite. Gäste und andere Seiten sind nicht erfasst.</p></div></details>
<details id="systemPanel" class="card dashboard-disclosure"><summary>System</summary><div class="card-body"><div class="cols system-grid"><div><div class="eyebrow">Shop</div><b id="shopName">–</b></div><div><div class="eyebrow">Berechtigung zum Bearbeiten</div><b id="role">Wird geprüft</b></div><div><div class="eyebrow">Shopify Staff-ID</div><b id="staff">–</b></div></div><p class="section-sub">Schreibzugriff: Staff-ID in der Oxygen-Variable <code>SHOPIFY_DASHBOARD_EDITOR_IDS</code> freigeben und neu deployen.</p></div></details>
</main><script>
(function(){
 const $=id=>document.getElementById(id);let selected=null,rows=[],cursor=null,more=false,editor=false,busy=false,editing=false,search='',staffId='',catalog=null,full=null,giftDraft=null,giftBusy=false;
 const num=n=>new Intl.NumberFormat('de-CH').format(Number.isFinite(Number(n))?Number(n):0);
 let statistics=[],statisticsPlayers=0;
 function drawStatistics(){const topic=statistics.find(item=>item.id===$('statisticsTopic').value);$('statisticsRows').replaceChildren();if(!topic||!topic.rows.length){$('statisticsRows').textContent='Keine gespeicherten Spielstände in der Stichprobe.';return}for(const row of topic.rows){const line=document.createElement('div');line.className='catalog-row';const label=document.createElement('span');label.className='asset-name';label.textContent=row.label;const count=document.createElement('b');count.textContent=num(row.count)+' · '+(statisticsPlayers?Math.round(row.count/statisticsPlayers*100):0)+' %';line.append(label,count);$('statisticsRows').append(line)}}
 function loadStatistics(overview){const previous=$('statisticsTopic').value;statistics=Array.isArray(overview.statistics)?overview.statistics:[];statisticsPlayers=overview.metrics.players;$('statisticsTopic').replaceChildren();for(const topic of statistics){const option=document.createElement('option');option.value=topic.id;option.textContent=topic.label;$('statisticsTopic').append(option)}if(statistics.some(topic=>topic.id===previous))$('statisticsTopic').value=previous;drawStatistics()}
 $('statisticsTopic').addEventListener('change',drawStatistics);
 function status(text,kind){$('message').textContent=text||'';$('message').className=kind||''}
 function detail(text,kind){$('editMessage').textContent=text||'';$('editMessage').className=kind||'mini'}
 async function api(path,body){if(!window.shopify||typeof window.shopify.idToken!=='function')throw Error('Bitte das Dashboard in Shopify → Apps → Wheelie Escape öffnen.');const token=await window.shopify.idToken();const response=await fetch(path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,credentials:'omit',cache:'no-store'});let result;try{result=await response.json()}catch{result={error:'invalid_response'}}if(!response.ok)throw Error(response.status===401?'Shopify-Sitzung abgelaufen. Bitte App erneut öffnen.':(result.error||'Serverfehler')+' (HTTP '+response.status+')');return result}
 let economy=null,economyBusy=false;
 function economyError(error,action){const message=error instanceof Error?error.message:'';if(message.includes('edit_conflict_reload'))return 'Der Flaggenpreis wurde inzwischen geändert. Bitte Preis neu laden und erneut prüfen.';if(message.includes('admin_editor_not_authorized'))return 'Für deinen Shopify-Zugang ist das Bearbeiten der Spielpreise nicht freigegeben.';if(message.includes('Shopify-Sitzung abgelaufen'))return 'Deine Shopify-Sitzung ist abgelaufen. Bitte die App erneut öffnen.';if(message.includes('Bitte das Dashboard in Shopify'))return 'Bitte das Dashboard in Shopify → Apps → Wheelie Escape öffnen.';return action==='load'?'Der Flaggenpreis konnte nicht geladen werden. Bitte erneut versuchen.':'Der Flaggenpreis konnte nicht gespeichert werden. Bitte Preis neu laden und erneut versuchen.'}
 function economyControls(){for(const id of ['flagCoinPrice','saveEconomy'])$(id).disabled=economyBusy||!economy;$('reloadEconomy').disabled=economyBusy;$('saveEconomy').textContent=economyBusy?'Wird gespeichert …':'Flaggenpreis speichern'}
 async function loadEconomy(){if(economyBusy)return;economyBusy=true;economyControls();$('economyFeedback').textContent='Preis wird geladen …';try{economy=await api('/api/admin/economy');$('flagCoinPrice').value=economy.flagCoinPrice;$('economyFeedback').textContent='Aktueller Preis geladen.';$('economyFeedback').className='mini'}catch(e){economy=null;$('economyFeedback').textContent=economyError(e,'load');$('economyFeedback').className='error'}finally{economyBusy=false;economyControls()}}
 $('economyPanel').addEventListener('toggle',()=>{if($('economyPanel').open&&!economy)void loadEconomy()});
 $('reloadEconomy').addEventListener('click',()=>void loadEconomy());
 $('saveEconomy').addEventListener('click',async()=>{if(economyBusy||!economy)return;const value=$('flagCoinPrice').value.trim(),price=Number(value);if(!/^[0-9]+$/.test(value)||!Number.isSafeInteger(price)||price<1||price>1000000000){$('economyFeedback').textContent='Bitte eine ganze Zahl zwischen 1 und 1’000’000’000 eingeben.';$('economyFeedback').className='error';return}economyBusy=true;economyControls();$('economyFeedback').textContent='Preis wird gespeichert …';try{economy=await api('/api/admin/economy',{version:1,flagCoinPrice:price,compareDigest:economy.compareDigest});$('flagCoinPrice').value=economy.flagCoinPrice;$('economyFeedback').textContent='Flaggenpreis gespeichert. Für neu geladene Spiele innerhalb von 30 Sekunden verfügbar.';$('economyFeedback').className='success'}catch(e){$('economyFeedback').textContent=economyError(e,'save');$('economyFeedback').className='error'}finally{economyBusy=false;economyControls()}});
 function td(tr,val,cls){const el=document.createElement('td');el.textContent=val==null?'–':String(val);if(cls)el.className=cls;tr.appendChild(el);return el}
 const gameFields=[['coins','editCoins',1000000000],['xp','editXp',1000000000],['bellsEarned','editBells',100000],['highScore','editHighScore',1000000000],['runsPlayed','editRuns',1000000000],['totalDistance','editDistance',1000000000],['totalNearMisses','editNearMisses',1000000000],['totalWheelieMeters','editWheelie',1000000000]];
 function showEditor(row){
  if(!selected||selected.id!==row.id){giftDraft=null;$('giftKind').value='coins';$('giftAmount').value='100';$('giftAmount').max='2000';$('giftMessage').value='';$('giftFeedback').textContent=''}
  selected=row;editing=false;full=null;$('empty').classList.add('hidden');$('editor').classList.remove('hidden');$('garageEditor').classList.add('hidden');
  giftControls();
  $('customerName').textContent=row.name||'Ohne Namen';$('customerId').textContent='Shopify-Kunde #'+row.id;$('editEmail').textContent=row.email||'Keine E-Mail hinterlegt / nicht freigegeben';
  const m={coins:row.player?.coins,xp:row.player?.xp,bellsEarned:row.player?.bellsEarned,highScore:row.player?.highScore,runsPlayed:row.player?.runs,totalDistance:undefined,totalNearMisses:undefined,totalWheelieMeters:undefined};
  gameFields.forEach(([field,id])=>{$(id).value=m[field]??'';$(id).disabled=!editor||!row.player});
  $('playerDetails').textContent=row.player?'Level '+num(row.player.level)+' · '+num(row.player.bellsSpent)+' Bells verbraucht.':'Ohne Spielstand: digitale Werte können erst nach der ersten Speicherung bearbeitet werden.';
  $('saveGame').disabled=!editor||!row.player;$('editStatus').textContent=editor?'Bearbeitbar':'Nur Lesen';$('permissionHint').textContent=editor?'Bearbeitung freigegeben.':'Nur Lesen. Freigabe unter System.';detail('');
  void loadDetails(row.id);
 }
 async function loadDetails(id){
  try{const d=await api('/api/admin/players?id='+encodeURIComponent(id));if(!selected||selected.id!==id)return;full=d.player;
   if(!full){$('garageEditor').classList.add('hidden');return;}
   const m={...full,bellsEarned:full.guardianBells?.earned};gameFields.forEach(([field,input])=>{$(input).value=m[field]??''});
   $('playerDetails').textContent='Level '+num(full.level)+' · '+num(full.guardianBells?.spent)+' Bells verbraucht · Highscore '+num(full.highScore);
   $('garageEditor').classList.remove('hidden');$('garageStatus').textContent=editor?'Änderbar':'Nur Lesen';$('editRiderName').value=full.leaderboardName||'';
   renderGarage();
  }catch(e){if(selected&&selected.id===id)detail('Spielstand-Details nicht geladen: '+String(e.message||e),'error')}
 }

 function draw(){const tbody=$('users');tbody.replaceChildren();const filter=$('registrationFilter').value;
  const shown=rows.filter(row=>filter==='all'||(filter==='with'?Boolean(row.player):!row.player));
  shown.forEach(row=>{const tr=document.createElement('tr');tr.classList.toggle('selected',selected?.id===row.id);const first=document.createElement('td');const button=document.createElement('button');button.type='button';button.className='player-btn';button.setAttribute('aria-pressed',String(selected?.id===row.id));button.textContent=row.name||'Kunde #'+row.id;button.addEventListener('click',()=>{showEditor(row);draw();$('customerName').focus({preventScroll:true});if(window.matchMedia('(max-width:920px)').matches)$('playerDetail').scrollIntoView({block:'start'})});first.appendChild(button);const mail=document.createElement('div');mail.className='email';mail.textContent=row.email||'Keine E-Mail hinterlegt / nicht freigegeben';first.appendChild(mail);tr.appendChild(first);td(tr,row.player?num(row.player.runs):'–');td(tr,row.player?num(row.player.coins):'–');const activity=td(tr,'');const badge=document.createElement('span');badge.className=row.online?'badge online':'mini';badge.textContent=row.online?'● Live':'Offline';activity.appendChild(badge);tbody.appendChild(tr)});
  if(!shown.length){const tr=document.createElement('tr');td(tr,'Keine Kunden gefunden. Suche oder Spielstand-Filter anpassen.').colSpan=4;tbody.appendChild(tr)}
  $('resultCount').textContent=shown.length+' von '+rows.length+' Kunden';$('live').textContent=num(rows.filter(r=>r.online).length);$('next').disabled=!more;
  $('pagingInfo').textContent='Aktuelle Seite · bis zu 25 Kunden. '+(more?'Weitere Seiten verfügbar.':'Letzte Seite.');
 }
 async function load(next){if(busy)return;busy=true;$('refresh').disabled=true;$('searchBtn').disabled=true;status('');try{const query=new URLSearchParams();if(search)query.set('q',search);if(next&&cursor)query.set('after',cursor);const [d,overview]=await Promise.all([api('/api/admin/players?'+query.toString()),next?Promise.resolve(null):api('/api/admin/overview')]);editor=d.editor===true;staffId=d.staffId||'';rows=d.rows||[];cursor=d.cursor;more=d.more===true;draw();$('role').textContent=editor?'Freigegeben':'Nur Lesen – Oxygen-Staff-ID freigeben';$('staff').textContent=staffId;if(overview){loadStatistics(overview);$('shopName').textContent=overview.shop||'–';$('players').textContent=num(overview.metrics.players);$('runs').textContent=num(overview.metrics.runs);$('verified').textContent=num(overview.metrics.verifiedPoints)}$('connection').textContent='● Shopify verbunden';$('connection').className='pill green';if(selected){const update=rows.find(r=>r.id===selected.id);if(update&&!editing)showEditor(update);else if(!update){$('editor').classList.add('hidden');$('empty').classList.remove('hidden');selected=null}}}catch(e){status(e instanceof Error?e.message:'Kunden konnten nicht geladen werden','error');$('connection').textContent='Verbindung prüfen'}finally{busy=false;$('refresh').disabled=false;$('searchBtn').disabled=false}}
 async function saveField(field,value,expected){if(!selected||!editor)return false;const id=selected.id;detail('Speichere …');try{await api('/api/admin/players',{id,field,value,...(expected!==undefined?{expected}:{})});detail('Gespeichert. Daten werden neu geladen.','success');editing=false;await load(false);return true}catch(e){detail((e instanceof Error?e.message:'Speichern fehlgeschlagen')+' – Daten prüfen und erneut laden.','error');return false}}
 function numberValue(id,max){const raw=$(id).value.trim();if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)>max)throw Error('Bitte eine gültige ganze Zahl zwischen 0 und '+max+' eingeben.');return Number(raw)}
 function giftControls(){for(const id of ['giftKind','giftAmount','giftMessage','sendGift'])$(id).disabled=!editor||giftBusy;$('sendGift').textContent=giftBusy?'Wird gesendet …':'Geschenk senden';$('giftLimit').textContent=$('giftKind').value==='coins'?'1 bis '+num(2000)+' Coins pro Geschenk.':'1 bis 5 Guardian Bells pro Geschenk.'}
 $('editor').addEventListener('submit',event=>event.preventDefault());
 $('giftKind').addEventListener('change',()=>{const coins=$('giftKind').value==='coins';$('giftAmount').max=coins?'2000':'5';$('giftAmount').value=coins?'100':'1';giftControls()});
 $('sendGift').addEventListener('click',async()=>{
  if(!selected||!editor||giftBusy)return;
  const customer=selected.id,kind=$('giftKind').value,message=$('giftMessage').value,max=kind==='coins'?2000:5;
  let delivered=false;
  try{const raw=$('giftAmount').value.trim(),amount=Number(raw);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(amount)||amount<1||amount>max)throw Error('Bitte eine Menge zwischen 1 und '+max+' eingeben.');if(message.length>80)throw Error('Die Nachricht darf höchstens 80 Zeichen enthalten.');
   const signature=JSON.stringify({kind,amount,message});if(!giftDraft||giftDraft.customer!==customer||giftDraft.signature!==signature)giftDraft={customer,signature,gift:{id:crypto.randomUUID(),kind,amount,message}};
   giftBusy=true;giftControls();$('giftFeedback').textContent='Geschenk wird gesendet …';$('giftFeedback').className='mini';
   await api('/api/admin/players',{id:customer,field:'gift',value:giftDraft.gift});delivered=true;giftDraft=null;editing=false;
   if(selected?.id===customer){$('giftFeedback').textContent='Geschenk gesendet: +'+num(amount)+' '+(kind==='coins'?'Coins':'Guardian Bells')+'.';$('giftFeedback').className='success';$('giftMessage').value=''}
  }catch(e){if(selected?.id===customer){$('giftFeedback').textContent=e instanceof Error?e.message:'Geschenk konnte nicht gesendet werden';$('giftFeedback').className='error'}}
  finally{giftBusy=false;giftControls()}
  if(delivered)await load(false);
 });
 $('refresh').addEventListener('click',()=>load(false));$('next').addEventListener('click',()=>load(true));$('searchBtn').addEventListener('click',()=>{search=$('search').value.trim();cursor=null;load(false)});$('search').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('searchBtn').click()}});
 $('registrationFilter').addEventListener('change',draw);
 gameFields.forEach(([,id])=>$(id).addEventListener('input',()=>{editing=true}));
 $('saveGame').addEventListener('click',async()=>{
  if(!selected||!full||!editor)return;
  try{const changes=gameFields.map(([field,id,max])=>[field,numberValue(id,max)]).filter(([field,value])=>value!==(field==='bellsEarned'?full.guardianBells?.earned:full[field]));
   if(!changes.length){detail('Keine Änderungen.');return;}
   if(!window.confirm('Digitale Spielwerte von '+(selected.name||selected.email||'Kunde')+' ändern? '+changes.length+' Änderung(en) werden protokolliert.'))return;
   for(const [field,value] of changes){if(!(await saveField(field,value)))break}
  }catch(e){detail(e instanceof Error?e.message:'Ungültiger Wert','error')}
 });
 async function cosmeticChange(value,label){if(!selected||!full||!editor){detail('Nur Lesen: Staff-ID in Oxygen freigeben.','error');return}
  if(!window.confirm(label+' bei '+(selected.name||selected.email||'Kunde')+' ändern?'))return;
  await saveField('cosmetic',value);
 }
 function button(label,click,disabled){const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=label;b.disabled=Boolean(disabled);b.addEventListener('click',click);return b}
 function assetRow(container,label,key,selection){const defaults=['bike:125','paint:#e7e7df','rims:#a6acb0','helmet:fullface','helmetColor:#d7dbd7','helmetVisor:#34454d'];const owned=full.ownedItems.includes(key)||defaults.includes(key);const row=document.createElement('div');row.className='catalog-row';row.dataset.search=(label+' '+key).toLowerCase();
  const name=document.createElement('span');name.className='asset-name';name.textContent=label;const hex=key.slice(key.indexOf(':')+1);if(/^#[0-9a-f]{6}$/i.test(hex)){const dot=document.createElement('span');dot.className='color-dot';dot.style.background=hex;name.prepend(dot)}row.appendChild(name);
  const state=document.createElement('span');state.className='asset-status';state.textContent=owned?'Digital freigeschaltet':'Gesperrt';row.appendChild(state);
  const actions=document.createElement('div');actions.className='asset-actions';actions.appendChild(button(owned?'Entziehen':'Freigeben',()=>cosmeticChange({kind:'owned',key,owned:!owned},label),!editor||defaults.includes(key)));
  if(selection)actions.appendChild(button('Verwenden',()=>cosmeticChange({kind:'appearance',key:selection,value:key.slice(selection.length+1)},label),!editor||!owned||full[selection]===key.slice(selection.length+1)));
  row.appendChild(actions);container.appendChild(row);
 }
 function assetGroup(name,items,makeRow){const details=document.createElement('details');details.className='catalog-section';const summary=document.createElement('summary');summary.textContent=name+' · '+items.length;details.appendChild(summary);items.forEach(item=>makeRow(details,item));$('inventoryContent').appendChild(details)}
 function renderGarage(){if(!full||!catalog)return;const selects=$('appearanceSelectors');selects.replaceChildren();
  for(const [key,label,list] of [['bike','Motorrad',catalog.bikes],['paint','Lack',catalog.paint],['rims','Felgen',catalog.rims],['helmet','Helm',catalog.helmets],['helmetColor','Helmfarbe',catalog.helmetColor],['helmetVisor','Visier',catalog.helmetVisor],['pantsColor','Hosenfarbe',catalog.pantsColor],['shoesColor','Schuhfarbe',catalog.shoesColor]]){
   const box=document.createElement('label');box.textContent=label;const select=document.createElement('select');select.setAttribute('aria-label',label);select.disabled=!editor;for(const item of list){const opt=document.createElement('option');opt.value=item.id||item.value;opt.textContent=item.name;select.appendChild(opt)}select.value=full[key]||'';
   select.addEventListener('change',()=>{const value=select.value;select.value=full[key];void cosmeticChange({kind:'appearance',key,value},label+' → '+value)});
   box.appendChild(select);selects.appendChild(box);
  }
  const owned=new Set(full.ownedItems);$('inventoryContent').replaceChildren();
  assetGroup('Motorräder',catalog.bikes,(el,item)=>assetRow(el,item.name,'bike:'+item.id,'bike'));
  for(const [section,label,prefix] of [['paint','Lackfarben','paint'],['rims','Felgenfarben','rims'],['helmetColor','Helmfarben','helmetColor'],['helmetVisor','Visierfarben','helmetVisor']])
   assetGroup(label,catalog[section],(el,item)=>assetRow(el,item.name+' ('+item.value+')',prefix+':'+item.value,prefix));
  assetGroup('Helme',catalog.helmets,(el,item)=>assetRow(el,item.name,'helmet:'+item.id,'helmet'));
  for(const section of ['upper','lower','head','accessory','keychain','cape','collectible','bike']){
   const products=catalog.products.filter(p=>p.category===section);if(!products.length)continue;
   assetGroup('Shop-Artikel · '+section,products,(el,product)=>{
    for(const variant of product.variants){const row=document.createElement('div');row.className='catalog-row';row.dataset.search=(product.title+' '+variant.title+' '+section).toLowerCase();
     const label=document.createElement('span');label.className='asset-name';label.textContent=product.title+' · '+variant.title;if(/^#[0-9a-f]{6}$/i.test(variant.color)){const dot=document.createElement('span');dot.className='color-dot';dot.style.background=variant.color;label.prepend(dot)}row.appendChild(label);
     const isOwned=owned.has(variant.key)||owned.has(product.id)&&!product.variants.some(v=>owned.has(v.key))&&variant.id===(full.variants[product.id]||product.variants[0]?.id);
     const state=document.createElement('span');state.className='asset-status';state.textContent=isOwned?'Digital freigeschaltet':'Gesperrt';row.appendChild(state);
     const buttons=document.createElement('div');buttons.className='asset-actions';buttons.appendChild(button(isOwned?'Entziehen':'Freigeben',()=>cosmeticChange({kind:'owned',key:variant.key,owned:!isOwned},product.title+' '+variant.title),!editor));
     buttons.appendChild(button(full.equipped[section]===product.id&&full.variants[product.id]===variant.id?'Angelegt':'Anlegen',()=>cosmeticChange({kind:'equip',slot:section,productId:product.id,variantId:variant.id},product.title+' anlegen'),!editor||!isOwned));row.appendChild(buttons);el.appendChild(row);
    }
   });
  }
  $('garageStatus').textContent=editor?'Bearbeitbar':'Nur Lesen';$('editRiderName').disabled=!editor;$('saveRiderName').disabled=!editor;
  const target=$('stickerTarget');target.replaceChildren();for(const key of Object.keys(full.stickers)){const opt=document.createElement('option');opt.value=key;opt.textContent=key+' ('+full.stickers[key]+')';target.appendChild(opt)}
  $('resetStickers').disabled=!editor||!target.options.length;
  filterInventory();
 }
 function filterInventory(){const q=$('inventorySearch').value.trim().toLowerCase();for(const row of $('inventoryContent').querySelectorAll('.catalog-row')){row.classList.toggle('hidden',Boolean(q)&&!row.dataset.search.includes(q))}if(q)for(const detail of $('inventoryContent').querySelectorAll('details'))detail.open=true}
 $('inventorySearch').addEventListener('input',filterInventory);
 $('saveRiderName').addEventListener('click',()=>{if(!full)return;void cosmeticChange({kind:'leaderboardName',value:$('editRiderName').value},'Bestenlistenname')});
 $('resetStickers').addEventListener('click',()=>{void cosmeticChange({kind:'resetStickers',target:$('stickerTarget').value},'Sticker entfernen')});
 void api('/api/admin/players?catalog=1').then(d=>{catalog=d.catalog;if(full)renderGarage()}).catch(e=>status('Inventarkatalog konnte nicht geladen werden: '+e.message,'error'));
 load(false);setInterval(()=>{if(document.visibilityState==='visible'&&!editing)load(false)},30000);
})();
</script></body></html>
`.replace('__API_KEY__', config.clientId);
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } });
}
