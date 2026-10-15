import { ApiError, type ShopifyConfig } from '../shopify/auth.js';
import { isRecord } from '../shopify/playerValidation.js';
import { shopifyGraphql, PLAYER_KEY, PLAYER_NAMESPACE, type ShopifyFetch } from '../shopify/playerStore.js';
import { REWARD_KEY } from '../shopify/rewardStore.js';
import { verifyHmacHex } from '../shopify/crypto.js';

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

interface SampledPlayer { runsPlayed: number; coins: number; totalDistance: number; bellsRemaining: number; bellsSpent: number }
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
      bellsRemaining: earned - spent, bellsSpent: spent };
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
  for (const node of data.customers.nodes) {
    if (!isRecord(node) || typeof node.id !== 'string') continue;
    const match = /^gid:\/\/shopify\/Customer\/([1-9]\d{0,19})$/.exec(node.id);
    if (!match) continue;
    const summary = isRecord(node.playerField) ? playerSummary(node.playerField.value) : null;
    if (summary) {
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
    sampleOnly: true, metrics, rows, top, diagnostics: { customersAccess: scopes.includes('write_customers') || scopes.includes('read_customers'),
      discountsAccess: scopes.includes('write_discounts'), serverClock: new Date(now).toISOString() } };
}

export async function handleAdminOverview(request: Request, config: ShopifyConfig | null, shopifyFetch: ShopifyFetch = fetch, now = Date.now()): Promise<Response> {
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' });
  if (!config?.clientId) return json(503, { error: 'admin_not_configured' });
  try {
    await verifyAdminIdToken(request.headers.get('Authorization'), config, now);
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
:root{font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;color:#303030;background:#f1f1f1;font-size:14px}*{box-sizing:border-box}body{margin:0;background:#f1f1f1}button,input,select{font:inherit}button{cursor:pointer}button:disabled{opacity:.48;cursor:not-allowed}main{max-width:1400px;margin:0 auto;padding:30px 28px 80px}.top{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:27px;flex-wrap:wrap}h1{font-size:27px;letter-spacing:-.7px;margin:7px 0;font-weight:700}h2{font-size:17px;margin:0;font-weight:680}h3{font-size:15px;margin:0}.muted{color:#6a6a6a}.eyebrow{font-size:12px;color:#686868}.actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.btn{background:#fff;border:1px solid #bdbdbd;border-radius:9px;color:#303030;padding:9px 15px;font-weight:620;min-height:38px;box-shadow:0 1px 1px #0000000a}.btn:hover:not(:disabled){background:#f7f7f7}.btn.primary{background:#303030;color:white;border-color:#303030}.btn.primary:hover:not(:disabled){background:#151515}.pill{display:inline-flex;gap:7px;align-items:center;border:1px solid #dedede;border-radius:999px;font-size:12px;padding:6px 11px;background:white;color:#616161}.green{background:#e4f5e9;color:#12652e;border-color:#bedfc7}.dot{width:7px;height:7px;background:#16813f;border-radius:50%;display:inline-block}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:18px 0}.card{background:#fff;border:1px solid #dedede;border-radius:13px;box-shadow:0 1px 2px #00000008;overflow:hidden}.stat{padding:18px 20px}.stat .num{font-size:29px;font-weight:720;line-height:1.1;margin:12px 0 6px;font-variant-numeric:tabular-nums;letter-spacing:-.6px}.stat .label{font-size:12px;color:#616161}.layout{display:grid;grid-template-columns:minmax(0,1.9fr) minmax(310px,1fr);gap:14px;align-items:start}.card-head{display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid #e6e6e6;gap:10px}.card-body{padding:18px 20px}.search{border:1px solid #bdbdbd;padding:11px 12px;border-radius:9px;width:100%;outline-offset:2px;background:#fff;color:#303030}.search:focus{outline:2px solid #303030}.filters{display:flex;gap:10px;align-items:center;padding:15px 20px}.filters input{flex:1;min-width:0}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse}th{background:#f8f8f8;text-align:left;color:#5a5a5a;font-size:12px;font-weight:650}td,th{padding:13px 16px;border-top:1px solid #e9e9e9;vertical-align:middle}td{font-size:13px}.player-btn{border:0;background:transparent;text-align:left;font-weight:650;text-decoration:underline;text-decoration-color:#aaa;text-underline-offset:3px;color:#303030;padding:0}.email{color:#515151;font-size:12px;overflow-wrap:anywhere}.table-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:15px 20px;border-top:1px solid #eee}.badge{border-radius:8px;padding:4px 8px;font-size:11px;background:#f1f1f1;color:#696969;white-space:nowrap}.badge.online{background:#e4f5e9;color:#146c37}.detail-empty{padding:40px 20px;color:#777;text-align:center}.editor{padding:20px}.editor label{display:block;font-size:12px;font-weight:650;margin:15px 0 7px}.editor input,.editor select{width:100%;padding:11px;border:1px solid #bdbdbd;border-radius:8px;background:#fff;color:#303030}.editor input:disabled,.editor select:disabled{background:#f4f4f4}.editor .buttons{display:flex;gap:9px;margin-top:16px;flex-wrap:wrap}.section-sub{font-size:12px;color:#757575;line-height:1.5;margin-top:8px}.notice{background:#f8f8f8;border:1px solid #e3e3e3;border-radius:10px;padding:13px;color:#535353;line-height:1.5;font-size:12px;margin-top:15px}.error{color:#c01818;font-size:13px;font-weight:650;margin:12px 0}.success{color:#106c34;font-size:13px;font-weight:650;margin:12px 0}.mini{font-size:12px;color:#747474}.cols{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.cols>div{min-width:0}.footer{margin-top:19px;font-size:12px;color:#707070;line-height:1.5}
.filter-select{padding:10px;background:white;color:#303030;border:1px solid #bdbdbd;border-radius:8px;max-width:210px}
.catalog-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:18px}
.catalog-grid label{font-size:12px;color:#555;display:block;font-weight:650}
.catalog-grid select{display:block;width:100%;padding:11px;border:1px solid #bdbdbd;border-radius:8px;background:#fff;margin-top:6px}
.catalog-section{padding:0 18px 18px}.catalog-section summary{font-size:14px;font-weight:700;cursor:pointer;padding:13px 7px;background:#f8f8f8;border-radius:9px;margin:7px 0}
.catalog-row{display:flex;align-items:center;gap:9px;padding:9px 3px;border-bottom:1px solid #eee;flex-wrap:wrap;min-height:42px}
.catalog-row .asset-name{flex:1;min-width:150px;font-size:13px}.catalog-row .asset-status{font-size:11px;color:#666}
.catalog-row .asset-actions{display:flex;gap:6px}.catalog-row button{padding:7px 9px;min-height:34px;font-size:12px}
.color-dot{display:inline-block;width:16px;height:16px;border:1px solid #bbb;border-radius:5px;vertical-align:middle;margin-right:6px}
.readonly-field{padding:12px;border-radius:8px;border:1px solid #dedede;background:#f6f6f6;overflow-wrap:anywhere}
#inventorySearch{max-width:420px}.hidden{display:none!important}@media(max-width:1040px){.kpis{grid-template-columns:repeat(2,1fr)}.layout{grid-template-columns:1fr}}@media(max-width:580px){main{padding:16px 10px 80px}.stat{padding:14px}.stat .num{font-size:23px}.top{margin-bottom:12px}h1{font-size:23px}.cols,.catalog-grid{grid-template-columns:1fr}.filters{flex-wrap:wrap}.card-head,.card-body{padding:15px}}
</style></head><body><main>
<header class="top"><div><div class="eyebrow">Shopify / Apps / Wheelie Escape</div><h1>Spielerverwaltung</h1><div class="muted">Shop-Daten, digitale Spielstände und aktuelle Spielsitzungen</div></div><div class="actions"><span class="pill" id="connection">Verbindung wird geprüft</span><button class="btn" id="refresh" type="button">↻ Aktualisieren</button></div></header>
<div id="message" role="status"></div>
<section class="kpis" aria-label="Dashboard Kennzahlen">
<div class="card stat"><div class="label">Live-Spieler</div><div class="num" id="live">–</div><div class="mini">Angemeldet, in den letzten 2 Minuten · aktuelle Kundenliste</div></div>
<div class="card stat"><div class="label">Spieler mit Spielstand</div><div class="num" id="players">–</div><div class="mini">Letzte 25 Kunden · Stichprobe</div></div>
<div class="card stat"><div class="label">Gespeicherte Fahrten</div><div class="num" id="runs">–</div><div class="mini">In der Stichprobe</div></div>
<div class="card stat"><div class="label">Verifizierte Belohnungspunkte</div><div class="num" id="verified">–</div><div class="mini">Nur lesbar · getrennt vom Spielstand</div></div>
</section>
<div class="layout">
<section class="card"><div class="card-head"><h2>Benutzer und E-Mail-Adressen</h2><span class="badge" id="resultCount">–</span></div>
<div class="filters"><input class="search" type="search" id="search" maxlength="80" placeholder="Kundenname oder E-Mail suchen" aria-label="Shopify-Kunden suchen"><button class="btn" id="searchBtn" type="button">Suchen</button><select class="filter-select" id="registrationFilter" aria-label="Kunden nach Spielstand filtern"><option value="all">Alle Shopify-Kunden</option><option value="with">Mit Spielstand</option><option value="without">Ohne Spielstand</option></select></div>
<div class="table-wrap"><table><thead><tr><th>Benutzer / E-Mail</th><th>Fahrten</th><th>Coins</th><th>Aktivität</th></tr></thead><tbody id="users"><tr><td colspan="4">Daten werden geladen …</td></tr></tbody></table></div>
<div class="table-actions"><span class="mini" id="pagingInfo">E-Mail wird angezeigt, soweit Shopify sie freigibt.</span><button class="btn" id="next" type="button" disabled>Weitere Kunden</button></div></section>
<aside class="card"><div class="card-head"><h2>Benutzer bearbeiten</h2><span class="badge" id="editStatus">Auswahl</span></div>
<div id="empty" class="detail-empty">Wähle links einen Benutzer aus.</div>
<form id="editor" class="editor hidden">
<div class="eyebrow" id="customerId">–</div><h3 id="customerName">–</h3><div class="notice" id="permissionHint">Coins und Ausrüstung können erst nach der Freigabe deiner Staff-ID in Oxygen verändert werden.</div>
<label>E-Mail-Adresse (Shopify-Kundenkonto)</label><div id="editEmail" class="readonly-field" aria-label="E-Mail nur lesen">–</div><div class="section-sub">E-Mail ist ausschließlich lesbar. Änderungen nur direkt über Shopify → Kunden.</div>
<div class="cols"><div><label for="editCoins">Coins</label><input id="editCoins" type="number" min="0" max="1000000000" step="1"></div>
<div><label for="editXp">XP</label><input id="editXp" type="number" min="0" max="1000000000" step="1"></div>
<div><label for="editBells">Bells verdient</label><input id="editBells" type="number" min="0" max="100000" step="1"></div></div>
<div class="cols"><div><label for="editHighScore">Highscore</label><input id="editHighScore" type="number" min="0" max="1000000000" step="1"></div>
<div><label for="editRuns">Fahrten</label><input id="editRuns" type="number" min="0" max="1000000000" step="1"></div><div><label for="editDistance">Meter gesamt</label><input id="editDistance" type="number" min="0" max="1000000000" step="1"></div>
<div><label for="editNearMisses">Knapp vorbei</label><input id="editNearMisses" type="number" min="0" max="1000000000" step="1"></div>
<div><label for="editWheelie">Wheelie-Meter</label><input id="editWheelie" type="number" min="0" max="1000000000" step="1"></div></div>
<div class="section-sub" id="playerDetails">Gespeicherte digitale Spielwerte.</div>
<div class="buttons"><button class="btn primary" id="saveGame" type="button">Spielwerte speichern</button></div>
<div class="notice">Bearbeitungen werden serverseitig geprüft und protokolliert. Bereits verbrauchte Bells lassen sich nicht rückwirkend ausgeben. Verifizierte Shop-Punkte, Rabatte und Gutscheine sind nicht bearbeitbar. Eine offene Spielsession kann beim nächsten Speichern einen Konflikt auslösen.</div>
<div id="editMessage" role="status" class="mini"></div>
</form></aside></div>
<section class="card hidden" id="garageEditor" style="margin-top:14px" aria-label="Vollständige digitale Garage-Verwaltung">
<div class="card-head"><div><h2>Digitale Garage &amp; Inventar</h2><p class="section-sub">Alle im Spiel vorhandenen Shop-Artikel, Farbvarianten, Motorräder und digitale Ausrüstung.</p></div><span class="badge" id="garageStatus">Nur Lesen</span></div>
<div class="catalog-grid" id="appearanceSelectors"></div>
<div class="catalog-section"><label for="editRiderName">Name in der Bestenliste</label><div class="actions" style="margin-top:7px"><input class="search" id="editRiderName" maxlength="24" style="max-width:320px" placeholder="RIDER" aria-label="Bestenlistenname"><button class="btn" type="button" id="saveRiderName">Name speichern</button></div></div>
<div class="catalog-section"><input class="search" type="search" id="inventorySearch" placeholder="Inventar durchsuchen: Artikel, Farben, Motorrad …" aria-label="Inventar durchsuchen"><div id="inventoryContent"></div></div>
<div class="catalog-section"><label for="stickerTarget">Stickerplatzierungen zurücksetzen</label><div class="actions" style="margin-top:8px"><select id="stickerTarget" class="filter-select" aria-label="Sticker-Ziel"></select><button class="btn" id="resetStickers" type="button">Sticker dieses Ziels entfernen</button></div></div>
<div class="notice" style="margin:12px 18px 20px">Alle Änderungen gelten nur für digitale Spielfreischaltungen. Physisch gekaufte Shopify-Produkte, Bestellungen, E-Mail-Adressen, verifizierte Shop-Punkte und Gutscheine können hier nicht verändert werden. Nach Admin-Änderungen muss ein Spieler die Spielseite möglicherweise neu laden.</div>
</section>
<section class="card" style="margin-top:14px"><div class="card-head"><h2>Systemstatus</h2></div><div class="card-body"><div class="cols"><div><div class="eyebrow">Shop</div><b id="shopName">–</b></div><div><div class="eyebrow">Berechtigung zum Bearbeiten</div><b id="role">Wird geprüft</b></div><div><div class="eyebrow">Shopify Staff-ID</div><b id="staff">–</b></div></div><p class="section-sub">Wenn hier <b>Nur Lesen</b> steht, funktionieren auch Coin-Änderungen nicht. Die <b>eigene Staff-ID</b> als Oxygen-Umgebungsvariable <code>SHOPIFY_DASHBOARD_EDITOR_IDS</code> freigeben und Oxygen neu deployen. Ohne Freigabe keine Änderungen.</p></div></section>
<p class="footer">Live erfasst nur angemeldete Spieler mit aktiver, sichtbarer Spielseite und erfolgreicher Shopify-Verbindung, derzeit innerhalb der angezeigten Kundenliste (max. 25 pro Seite). Gäste und andere Seiten werden nicht gezählt; die Zahl ist keine Gesamtbesucherstatistik.</p>
</main><script>
(function(){
 const $=id=>document.getElementById(id);let selected=null,rows=[],cursor=null,more=false,editor=false,busy=false,editing=false,search='',staffId='',catalog=null,full=null;
 const num=n=>new Intl.NumberFormat('de-CH').format(Number.isFinite(Number(n))?Number(n):0);
 function status(text,kind){$('message').textContent=text||'';$('message').className=kind||''}
 function detail(text,kind){$('editMessage').textContent=text||'';$('editMessage').className=kind||'mini'}
 async function api(path,body){if(!window.shopify||typeof window.shopify.idToken!=='function')throw Error('Bitte das Dashboard in Shopify → Apps → Wheelie Escape öffnen.');const token=await window.shopify.idToken();const response=await fetch(path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,credentials:'omit',cache:'no-store'});let result;try{result=await response.json()}catch{result={error:'invalid_response'}}if(!response.ok)throw Error(response.status===401?'Shopify-Sitzung abgelaufen. Bitte App erneut öffnen.':(result.error||'Serverfehler')+' (HTTP '+response.status+')');return result}
 function td(tr,val,cls){const el=document.createElement('td');el.textContent=val==null?'–':String(val);if(cls)el.className=cls;tr.appendChild(el);return el}
 const gameFields=[['coins','editCoins',1000000000],['xp','editXp',1000000000],['bellsEarned','editBells',100000],['highScore','editHighScore',1000000000],['runsPlayed','editRuns',1000000000],['totalDistance','editDistance',1000000000],['totalNearMisses','editNearMisses',1000000000],['totalWheelieMeters','editWheelie',1000000000]];
 function showEditor(row){
  selected=row;editing=false;full=null;$('empty').classList.add('hidden');$('editor').classList.remove('hidden');$('garageEditor').classList.add('hidden');
  $('customerName').textContent=row.name||'Ohne Namen';$('customerId').textContent='Shopify-Kunde #'+row.id;$('editEmail').textContent=row.email||'Keine E-Mail hinterlegt / nicht freigegeben';
  const m={coins:row.player?.coins,xp:row.player?.xp,bellsEarned:row.player?.bellsEarned,highScore:row.player?.highScore,runsPlayed:row.player?.runs,totalDistance:undefined,totalNearMisses:undefined,totalWheelieMeters:undefined};
  gameFields.forEach(([field,id])=>{$(id).value=m[field]??'';$(id).disabled=!editor||!row.player});
  $('playerDetails').textContent=row.player?'Level '+num(row.player.level)+' · '+num(row.player.bellsSpent)+' Bells verbraucht.':'Ohne Spielstand: digitale Werte können erst nach der ersten Speicherung bearbeitet werden.';
  $('saveGame').disabled=!editor||!row.player;$('editStatus').textContent=editor?'Bearbeitbar':'Nur Lesen';$('permissionHint').textContent=editor?'Du bist zum Bearbeiten freigegeben. Änderungen werden protokolliert.':'Nur Lesen: In Oxygen SHOPIFY_DASHBOARD_EDITOR_IDS auf deine Staff-ID '+staffId+' setzen und Oxygen neu deployen.';detail('');
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
  shown.forEach(row=>{const tr=document.createElement('tr');const first=document.createElement('td');const button=document.createElement('button');button.type='button';button.className='player-btn';button.textContent=row.name||'Kunde #'+row.id;button.addEventListener('click',()=>showEditor(row));first.appendChild(button);const mail=document.createElement('div');mail.className='email';mail.textContent=row.email||'Keine E-Mail hinterlegt / nicht freigegeben';first.appendChild(mail);tr.appendChild(first);td(tr,row.player?num(row.player.runs):'–');td(tr,row.player?num(row.player.coins):'–');td(tr,row.online?'● Live':'Offline',row.online?'badge online':'mini');tbody.appendChild(tr)});
  if(!shown.length){const tr=document.createElement('tr');td(tr,'Keine passenden Kunden auf dieser Seite');tbody.appendChild(tr)}
  $('resultCount').textContent=shown.length+' von '+rows.length+' Kunden';$('live').textContent=num(rows.filter(r=>r.online).length);$('next').disabled=!more;
  $('pagingInfo').textContent='Filter gilt für die aktuelle Shopify-Kundenseite (max. 25 Einträge). '+(more?'Weitere Seiten verfügbar.':'Letzte Seite.')+' Gäste ohne Shopify-Konto sind nicht einzeln erfasst.';
 }
 async function load(next){if(busy)return;busy=true;$('refresh').disabled=true;$('searchBtn').disabled=true;status('');try{const query=new URLSearchParams();if(search)query.set('q',search);if(next&&cursor)query.set('after',cursor);const [d,overview]=await Promise.all([api('/api/admin/players?'+query.toString()),next?Promise.resolve(null):api('/api/admin/overview')]);editor=d.editor===true;staffId=d.staffId||'';rows=d.rows||[];cursor=d.cursor;more=d.more===true;draw();$('role').textContent=editor?'Freigegeben':'Nur Lesen – Oxygen-Staff-ID freigeben';$('staff').textContent=staffId;if(overview){$('shopName').textContent=overview.shop||'–';$('players').textContent=num(overview.metrics.players);$('runs').textContent=num(overview.metrics.runs);$('verified').textContent=num(overview.metrics.verifiedPoints)}$('connection').textContent='● Shopify verbunden';$('connection').className='pill green';if(selected){const update=rows.find(r=>r.id===selected.id);if(update&&!editing)showEditor(update);else if(!update){$('editor').classList.add('hidden');$('empty').classList.remove('hidden');selected=null}}}catch(e){status(e instanceof Error?e.message:'Kunden konnten nicht geladen werden','error');$('connection').textContent='Verbindung prüfen'}finally{busy=false;$('refresh').disabled=false;$('searchBtn').disabled=false}}
 async function saveField(field,value,expected){if(!selected||!editor)return false;const id=selected.id;detail('Speichere …');try{await api('/api/admin/players',{id,field,value,...(expected!==undefined?{expected}:{})});detail('Gespeichert. Daten werden neu geladen.','success');editing=false;await load(false);return true}catch(e){detail((e instanceof Error?e.message:'Speichern fehlgeschlagen')+' – Daten prüfen und erneut laden.','error');return false}}
 function numberValue(id,max){const raw=$(id).value.trim();if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)>max)throw Error('Bitte eine gültige ganze Zahl zwischen 0 und '+max+' eingeben.');return Number(raw)}
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
