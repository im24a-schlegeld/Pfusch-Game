import type { Player } from '../../app/domain/types.js';
import { normalizeLeaderboardName } from '../../app/domain/progression.js';
import { ApiError, assertCustomerIdentity, authenticateProxy, type CustomerAuthenticator, type ShopifyConfig } from './auth.js';
import { hmacSha256 } from './crypto.js';
import { shopifyGraphql, PLAYER_KEY, PLAYER_NAMESPACE, type ShopifyFetch } from './playerStore.js';
import { isRecord, MAX_BODY_BYTES, sanitizeDigitalPlayer } from './playerValidation.js';

type Period = 'day' | 'week' | 'all';
interface Row { alias: string; score: number; name?: string }
interface Window { key: string; rows: Row[] }
export interface Board { version: 1; day: Window; week: Window; all: Window }
interface RankingField { ownerId: string; namespace: string; key: string; type: 'json'; value: string; compareDigest: string | null }
const periods: Period[] = ['day', 'week', 'all'];
const KEY = 'leaderboard_v1';
const LIMIT = 50;
const validScore = (score: unknown): score is number => typeof score === 'number' && Number.isSafeInteger(score) && score > 0 && score <= 1e12;
export async function playerAlias(config: ShopifyConfig, customerId: string) {
  return (await hmacSha256(`pfusch-ranking-v1:${config.shop}:${customerId}`, config.secret)).slice(0, 16);
}
export function rankingWindows(now: number): Record<Period, string> {
  const day = new Date(now).toISOString().slice(0, 10);
  const week = new Date(`${day}T00:00:00Z`);
  week.setUTCDate(week.getUTCDate() - (week.getUTCDay() + 6) % 7);
  return { day, week: week.toISOString().slice(0, 10), all: 'all' };
}
function emptyBoard(now: number): Board {
  const keys = rankingWindows(now);
  return { version: 1, day: { key: keys.day, rows: [] }, week: { key: keys.week, rows: [] }, all: { key: 'all', rows: [] } };
}
function decodeBoard(raw: unknown, now: number): Board {
  if (!isRecord(raw) || raw.version !== 1) throw new ApiError(502, 'invalid_ranking');
  const board = emptyBoard(now);
  for (const period of periods) {
    const window = raw[period];
    if (!isRecord(window) || !Array.isArray(window.rows) || window.rows.length > LIMIT) throw new ApiError(502, 'invalid_ranking');
    // A request started before UTC rollover may read a board already advanced
    // by another request. Never roll that newer window backwards during CAS.
    if (period !== 'all' && typeof window.key === 'string' && window.key > board[period].key)
      throw new ApiError(409, 'ranking_window_changed');
    if (window.key !== board[period].key) continue;
    const seen = new Set<string>();
    board[period].rows = window.rows.map(row => {
      if (!isRecord(row) || typeof row.alias !== 'string' || !/^[a-f0-9]{16}$/.test(row.alias) || seen.has(row.alias) || !validScore(row.score))
        throw new ApiError(502, 'invalid_ranking');
      seen.add(row.alias);
      const name = row.name === undefined ? '' : normalizeLeaderboardName(row.name);
      if (row.name !== undefined && typeof row.name !== 'string') throw new ApiError(502, 'invalid_ranking');
      if (row.name !== undefined && row.name !== '' && !name) throw new ApiError(502, 'invalid_ranking');
      return { alias: row.alias, score: row.score, ...(name ? { name } : {}) };
    }).sort((a, b) => b.score - a.score || a.alias.localeCompare(b.alias));
  }
  return board;
}

/** Actual saved digital results. These scores are not a proof for real prizes. */
export function mergeRanking(board: Board, alias: string, player: Player, now: number): Board {
  const next = decodeBoard(board, now), keys = rankingWindows(now);
  for (const period of periods) {
    const score = Math.floor(period === 'all' ? player.highScore : Math.min(player.highScore, player.history.reduce((best, run) =>
      run.date >= keys[period] && run.date <= keys.day ? Math.max(best, run.score) : best, 0)));
    const rows = next[period].rows;
    const previous = rows.find(row => row.alias === alias);
    if (!validScore(score) && !previous) continue;
    const name = normalizeLeaderboardName(player.leaderboardName);
    next[period].rows = [...rows.filter(row => row.alias !== alias), { alias, score: Math.max(validScore(score) ? score : 0, previous?.score ?? 0), ...(name ? { name } : {}) }]
      .sort((a, b) => b.score - a.score || a.alias.localeCompare(b.alias)).slice(0, LIMIT);
  }
  return next;
}
/** An admin correction replaces the lifetime value, including downward or zero.
 * Existing period records can only be reduced by this lifetime edit. */
export function correctRankingHighScore(board: Board, alias: string, score: number, now: number): Board {
  if (!/^[a-f0-9]{16}$/.test(alias) || !Number.isSafeInteger(score) || score < 0 || score > 1e12)
    throw new ApiError(400, 'invalid_ranking_score');
  const next = decodeBoard(board, now);
  for (const period of periods) {
    const previous = next[period].rows.find(row => row.alias === alias);
    const corrected = period === 'all' ? score : Math.min(previous?.score ?? 0, score);
    next[period].rows = next[period].rows.filter(row => row.alias !== alias);
    if (corrected > 0) next[period].rows.push({ alias, score: corrected, ...(previous?.name ? { name: previous.name } : {}) });
    next[period].rows.sort((a, b) => b.score - a.score || a.alias.localeCompare(b.alias));
    next[period].rows = next[period].rows.slice(0, LIMIT);
  }
  return next;
}

async function loadBoard(config: ShopifyConfig, request: ShopifyFetch, now: number, customerId?: string) {
  const query = customerId ? `query GameRanking($namespace: String!, $key: String!, $customerId: ID!, $player: String!) {
    shop { id metafield(namespace: $namespace, key: $key) { value compareDigest } }
    customer(id: $customerId) { id metafield(namespace: $namespace, key: $player) { value compareDigest } }
  }` : `query GameRanking($namespace: String!, $key: String!) {
    shop { id metafield(namespace: $namespace, key: $key) { value compareDigest } }
  }`;
  const data = await shopifyGraphql(config, query, { namespace: PLAYER_NAMESPACE, key: KEY,
    ...(customerId ? { customerId: `gid://shopify/Customer/${customerId}`, player: PLAYER_KEY } : {}) }, request);
  if (!isRecord(data.shop) || typeof data.shop.id !== 'string' || !/^gid:\/\/shopify\/Shop\/\d+$/.test(data.shop.id))
    throw new ApiError(502, 'invalid_ranking');
  let player: Player | undefined, guardField: RankingField | undefined;
  if (customerId) {
    const customer = data.customer;
    if (!isRecord(customer) || customer.id !== `gid://shopify/Customer/${customerId}` || !isRecord(customer.metafield))
      throw new ApiError(502, 'invalid_ranking_player');
    const current = customer.metafield;
    if (typeof current.value !== 'string' || new TextEncoder().encode(current.value).length > MAX_BODY_BYTES ||
      typeof current.compareDigest !== 'string' || !/^[a-f0-9]{64}$/.test(current.compareDigest))
      throw new ApiError(502, 'invalid_ranking_player');
    try { player = sanitizeDigitalPlayer(JSON.parse(current.value), customerId); }
    catch { throw new ApiError(502, 'invalid_ranking_player'); }
    guardField = { ownerId: customer.id, namespace: PLAYER_NAMESPACE, key: PLAYER_KEY, type: 'json',
      value: current.value, compareDigest: current.compareDigest };
  }
  if (data.shop.metafield === null) return { ownerId: data.shop.id, board: emptyBoard(now), compareDigest: null, player, guardField };
  const field = data.shop.metafield;
  if (!isRecord(field) || typeof field.value !== 'string' || field.value.length > 32768 || typeof field.compareDigest !== 'string' || !/^[a-f0-9]{64}$/.test(field.compareDigest))
    throw new ApiError(502, 'invalid_ranking');
  let raw: unknown;
  try { raw = JSON.parse(field.value); } catch { throw new ApiError(502, 'invalid_ranking'); }
  return { ownerId: data.shop.id, board: decodeBoard(raw, now), compareDigest: field.compareDigest, player, guardField };
}

/** Prepared for the same atomic mutation as the authenticated player edit. */
export async function rankingCorrectionField(config: ShopifyConfig, customerId: string, player: Player,
  request: ShopifyFetch, now: number): Promise<RankingField> {
  const saved = await loadBoard(config, request, now);
  const alias = await playerAlias(config, customerId);
  const board = correctRankingHighScore(saved.board, alias, player.highScore, now);
  const name = normalizeLeaderboardName(player.leaderboardName);
  for (const period of periods) for (const row of board[period].rows) {
    if (row.alias !== alias) continue;
    if (name) row.name = name; else delete row.name;
  }
  return { ownerId: saved.ownerId, namespace: PLAYER_NAMESPACE, key: KEY, type: 'json',
    value: JSON.stringify(board), compareDigest: saved.compareDigest };
}

export async function updateRanking(config: ShopifyConfig, customerId: string, _player: Player, request: ShopifyFetch, now?: number) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const attemptNow = now ?? Date.now();
    const saved = await loadBoard(config, request, attemptNow, customerId);
    if (!saved.player || !saved.guardField) throw new ApiError(502, 'invalid_ranking_player');
    const board = mergeRanking(saved.board, await playerAlias(config, customerId), saved.player, attemptNow);
    if (JSON.stringify(saved.board) === JSON.stringify(board)) return;
    const result = await shopifyGraphql(config, `mutation SaveGameRanking($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { code } }
    }`, { metafields: [{ ownerId: saved.ownerId, namespace: PLAYER_NAMESPACE, key: KEY, type: 'json',
      value: JSON.stringify(board), compareDigest: saved.compareDigest },
      // Compare-and-set the unchanged raw player value as well. An admin edit
      // or gift between read and publication must invalidate this transaction.
      saved.guardField] }, request);
    if (!isRecord(result.metafieldsSet) || !Array.isArray(result.metafieldsSet.userErrors)) throw new ApiError(502, 'invalid_ranking');
    const errors = result.metafieldsSet.userErrors;
    if (!errors.length) return;
    if (!errors.every(error => isRecord(error) && ['STALE_OBJECT', 'INVALID_COMPARE_DIGEST'].includes(String(error.code))))
      throw new ApiError(503, 'ranking_unavailable');
    // Another customer saved at the same time: reload and merge, never replace.
  }
  throw new ApiError(409, 'ranking_busy');
}
export async function handleRankingRequest(method: string, url: string, config: ShopifyConfig | null, request: ShopifyFetch, now = Date.now(),
  authenticate: CustomerAuthenticator = authenticateProxy) {
  try {
    if (method !== 'GET') throw new ApiError(405, 'method_not_allowed');
    if (!config) throw new ApiError(503, 'not_configured');
    const identity = assertCustomerIdentity(await authenticate(url, config, now), config);
    const query = new URL(url, 'https://backend.invalid').searchParams;
    const period = query.get('period');
    if (query.getAll('period').length !== 1 || !periods.includes(period as Period)) throw new ApiError(400, 'invalid_period');
    const { board } = await loadBoard(config, request, now);
    const you = await playerAlias(config, identity.customerId);
    return { status: 200, body: { source: 'shopify', entries: board[period as Period].rows.map(row => ({
      name: row.name || (row.alias === you ? 'DU' : `RIDER ${row.alias.slice(0, 6).toUpperCase()}`), score: row.score, you: row.alias === you,
    })), message: 'Top 50 · gespeicherte Fahrten aus dem Shop' } };
  } catch (error) {
    return { status: error instanceof ApiError ? error.status : 503, body: { error: error instanceof ApiError ? error.code : 'ranking_unavailable' } };
  }
}
