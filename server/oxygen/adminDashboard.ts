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
  const key = config.clientId;
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="shopify-api-key" content="${key}"><title>Wheelie Escape – Admin</title>
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
<style>
:root{font-family:Inter,system-ui,sans-serif;color:#eaf0f9;background:#101722}*{box-sizing:border-box}body{margin:0;background:#101722}main{max-width:1240px;margin:auto;padding:32px 24px 60px}.eyebrow{font-size:12px;font-weight:800;letter-spacing:.15em;color:#94a6c4}h1{font-size:clamp(30px,4vw,46px);line-height:1.08;margin:10px 0}p{color:#a7b7d0;line-height:1.55}.head{display:flex;align-items:end;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:22px}.pill{font-size:12px;border:1px solid #3b4b62;border-radius:999px;padding:7px 12px;color:#cad7e8}.button{background:#e7f676;border:0;border-radius:10px;padding:12px 17px;font-weight:800;color:#121921;cursor:pointer}.button:disabled{opacity:.5;cursor:wait}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.stat,.panel{border:1px solid #33445c;background:#192333;border-radius:16px;padding:20px}.stat .label{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:#b1c0d7}.stat .value{font-size:32px;font-weight:850;margin:12px 0 4px}.stat small{color:#8fa0b8}.layout{display:grid;grid-template-columns:1.25fr 1fr;gap:16px;margin-top:18px}.panel h2{font-size:18px;margin:0 0 18px}.tablewrap{overflow:auto}table{border-collapse:collapse;width:100%;min-width:300px}th,td{text-align:left;padding:12px 5px;border-bottom:1px solid #324258;font-size:13px}th{color:#8da1bc;font-weight:600}td{color:#e9f0fa}.tag{display:inline-block;background:#263b34;color:#a8f3bd;padding:4px 9px;border-radius:999px}.tag.warn{background:#483522;color:#ffd6a0}#error{color:#ffb2a8;min-height:23px}#subtitle{margin:0 0 24px}footer{font-size:12px;color:#8da1bc;margin-top:20px}@media(max-width:850px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.layout{grid-template-columns:1fr}}@media(max-width:430px){main{padding:22px 12px}.stats{gap:8px}.stat{padding:14px}.stat .value{font-size:25px}}
</style></head><body><main><header class="head"><div><div class="eyebrow">PFUSCH / SHOPIFY APP</div><h1>WHEELIE ESCAPE<br>ADMIN DASHBOARD</h1></div><div><span class="pill" id="live">Shopify-Anmeldung wird geprüft …</span> <button id="refresh" class="button" type="button">Aktualisieren</button></div></header>
<p id="subtitle">Spieler, Fahrten und Shop-Belohnungen – nur lesender Überblick, ohne Änderungen an Spielständen.</p><div id="error" role="alert"></div>
<section class="stats" aria-label="Kennzahlen">
<div class="stat"><div class="label">Spieler mit Spielstand</div><div class="value" id="players">–</div><small>In der Kunden-Stichprobe</small></div>
<div class="stat"><div class="label">Gespeicherte Fahrten</div><div class="value" id="runs">–</div><small>In der Kunden-Stichprobe</small></div>
<div class="stat"><div class="label">Verifizierte Shop-Punkte</div><div class="value" id="points">–</div><small>Signierte Belohnungsstände der Stichprobe</small></div>
<div class="stat"><div class="label">Ausgegebene Rabattcodes</div><div class="value" id="coupons">–</div><small>Signierte Belohnungsstände der Stichprobe</small></div>
<div class="stat"><div class="label">Guardian Bells verfügbar</div><div class="value" id="bells">–</div><small>In der Kunden-Stichprobe</small></div>
<div class="stat"><div class="label">Guardian Bells verbraucht</div><div class="value" id="bellsSpent">–</div><small>In der Kunden-Stichprobe</small></div>
<div class="stat"><div class="label">Virtuelle Coins</div><div class="value" id="coins">–</div><small>In der Kunden-Stichprobe</small></div>
<div class="stat"><div class="label">Gefahrene Kilometer</div><div class="value" id="km">–</div><small>In der Kunden-Stichprobe</small></div></section>
<section class="layout"><article class="panel"><h2>Top 10 – gespeicherte Bestenliste</h2><div class="tablewrap"><table><thead><tr><th>#</th><th>Spielername</th><th>Punkte</th></tr></thead><tbody id="ranking"><tr><td colspan="3">Wird geladen …</td></tr></tbody></table></div></article>
<article class="panel"><h2>Spieler-Stichprobe</h2><p id="sample">Die letzten 25 im Shop aktualisierten Kunden werden geprüft. Das ist keine vollständige Spielerzählung.</p><div class="tablewrap"><table><thead><tr><th>Profil</th><th>Fahrten</th><th>Coins</th><th>Bells</th></tr></thead><tbody id="riders"><tr><td colspan="4">Wird geladen …</td></tr></tbody></table></div></article>
<article class="panel"><h2>Shopify-Verbindung</h2><p>Nur lesende API-Zugriffe. Rabattcodes und Spielstände werden nicht verändert.</p><p>Shop: <strong id="shop">–</strong></p><p>Kundenberechtigung: <span id="customersScope">–</span></p><p>Rabattberechtigung: <span id="discountsScope">–</span></p></article>
<article class="panel"><h2>System & Sicherheit</h2><p>Shopify Admin App Bridge mit kurzlebigem signiertem ID-Token. Verifikation erfolgt auf dem Oxygen-Server vor jeder Datenabfrage.</p><p>Letzte Serverprüfung: <strong id="clock">–</strong></p><p>Der Zugriff ist auf die installierte Shopify-App und deren Shop beschränkt.</p></article></section>
<footer>Stand: erste Admin-Version. Kennzahlen beruhen auf einer begrenzten Stichprobe; für exakte Gesamtauswertungen braucht das Spiel einen separaten serverseitigen Statistikzähler.</footer></main>
<script>
(function(){
 const $=id=>document.getElementById(id), number=x=>new Intl.NumberFormat('de-CH').format(x||0);
 const row=(tbody,values)=>{const tr=document.createElement('tr');values.forEach(value=>{const td=document.createElement('td');td.textContent=String(value);tr.appendChild(td)});tbody.appendChild(tr)};
 let busy=false;
 async function load(){
  if(busy)return;busy=true;$('refresh').disabled=true;$('error').textContent='';
  try{
   if(!window.shopify||typeof window.shopify.idToken!=='function')throw Error('Shopify App Bridge ist nicht aktiv. Öffne diese Seite unter Shopify → Apps → Wheelie Escape.');
   const token=await window.shopify.idToken();
   const res=await fetch('/api/admin/overview',{headers:{'Authorization':'Bearer '+token,'Accept':'application/json'},credentials:'omit',cache:'no-store'});
   if(!res.ok)throw Error(res.status===401?'Shopify-Sitzung abgelaufen. Öffne die App im Shopify-Adminbereich neu.': 'Admin-Daten konnten nicht geladen werden (HTTP '+res.status+').');
   const d=await res.json(),m=d.metrics;$('live').textContent='Shopify verbunden';$('shop').textContent=d.shop;
   [['players',m.players],['runs',m.runs],['points',m.verifiedPoints],['coupons',m.issuedCoupons],['bells',m.bellsAvailable],['bellsSpent',m.bellsSpent],['coins',m.coins],['km',m.distanceKm]].forEach(([id,value])=>{$(id).textContent=number(value)});
   $('sample').textContent='Geprüft: '+d.sampledCustomers+' kürzlich aktualisierte Shop-Kunden. '+(d.moreCustomers?'Es gibt weitere Kunden;':'')+' Nur Spieler mit vorhandenem Spielstand werden gezählt.';
   $('customersScope').textContent=d.diagnostics.customersAccess?'Verfügbar':'Fehlt';$('discountsScope').textContent=d.diagnostics.discountsAccess?'Verfügbar':'Fehlt';$('clock').textContent=new Date(d.diagnostics.serverClock).toLocaleString('de-CH');
   $('ranking').replaceChildren();(d.top||[]).forEach((r,i)=>row($('ranking'),[i+1,r.name,number(r.score)]));if(!d.top.length)row($('ranking'),['–','Noch keine Einträge','–']);
   $('riders').replaceChildren();(d.rows||[]).forEach(r=>row($('riders'),[r.rider,number(r.runs),number(r.coins),number(r.bells)]));if(!d.rows.length)row($('riders'),['Keine Spielstände','–','–','–']);
  }catch(e){$('live').textContent='Keine Verbindung';$('error').textContent=String(e&&e.message||e);}finally{$('refresh').disabled=false;busy=false;}
 }
 $('refresh').addEventListener('click',load);load();
})();
</script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } });
}
