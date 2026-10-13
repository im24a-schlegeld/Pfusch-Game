/** Public, presentation-only links. Never use these values to settle a run or unlock rewards. */
export const GAME_SHARE_ORIGIN = 'https://game.pfusch-clothing.ch';
export type SharePeriod = 'day' | 'week' | 'all';
export type GameShare =
  | { kind: 'invite'; name: string; referral?: string }
  | { kind: 'score'; name: string; score: number; date: string }
  | { kind: 'rank'; name: string; score: number; rank: number; period: SharePeriod; date: string };

const publicName = (value: string | null) => [...(value ?? '')]
  .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
  .join('').trim().slice(0, 24);
const validDate = (date: string | null): date is string => !!date && /^\d{4}-\d{2}-\d{2}$/.test(date)
  && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
const scoreValue = (value: string | null) => value && /^\d{1,13}$/.test(value) && Number(value) <= 1e12 ? Number(value) : null;
export const isReferralCode = (value: unknown): value is string => typeof value === 'string' && value.length <= 512 && /^v1\.[\w-]{16}\.[\w-]+$/.test(value);

export function readGameShare(search: string): GameShare | null {
  if (search.length > 2048) return null;
  const params = new URLSearchParams(search);
  const kind = params.get('share');
  const name = publicName(params.get('name'));
  if (kind === 'invite') {
    const referral = params.get('ref');
    return { kind, name, ...(isReferralCode(referral) ? { referral } : {}) };
  }
  if (kind !== 'score' && kind !== 'rank') return null;
  const score = scoreValue(params.get('points'));
  const date = params.get('date');
  if (score === null || !validDate(date)) return null;
  if (kind === 'score') return { kind, name, score, date };
  const rawRank = params.get('rank');
  const period = params.get('period');
  if (!rawRank || !/^\d{1,3}$/.test(rawRank) || Number(rawRank) < 1 || Number(rawRank) > 100
    || !['day', 'week', 'all'].includes(period ?? '')) return null;
  return { kind, name, score, date, rank: Number(rawRank), period: period as SharePeriod };
}

export function gameShareUrl(share: GameShare): string {
  const url = new URL('/', GAME_SHARE_ORIGIN);
  url.searchParams.set('share', share.kind);
  if (publicName(share.name)) url.searchParams.set('name', publicName(share.name));
  if (share.kind === 'invite' && isReferralCode(share.referral)) url.searchParams.set('ref', share.referral);
  if (share.kind !== 'invite') {
    url.searchParams.set('points', String(Math.max(0, Math.min(1e12, Math.floor(share.score)))));
    url.searchParams.set('date', share.date);
  }
  if (share.kind === 'rank') {
    url.searchParams.set('rank', String(share.rank));
    url.searchParams.set('period', share.period);
  }
  return url.href;
}

export function sharePeriodLabel(period: SharePeriod, date: string): string {
  const prettyDate = date.split('-').reverse().join('.');
  if (period === 'day') return `Tagesrangliste · ${prettyDate} (UTC)`;
  if (period === 'week') {
    const start = new Date(`${date}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
    return `Wochenrangliste · ab ${start.toISOString().slice(0, 10).split('-').reverse().join('.')} (UTC)`;
  }
  return `Gesamtrangliste · Stand ${prettyDate}`;
}

export function gameShareText(share: GameShare): string {
  if (share.kind === 'invite') return `${share.name ? `${share.name} lädt dich ein` : 'Fahr mit'}: PFUSCH Wheelie Escape. Schaffst du den nächsten Highscore?`;
  const points = share.score.toLocaleString('de-CH');
  const rider = share.name || 'Ich';
  if (share.kind === 'rank') return `${rider}: Platz ${share.rank} mit ${points} Punkten bei PFUSCH Wheelie Escape. ${sharePeriodLabel(share.period, share.date)}. Fahr mit!`;
  return `${rider}: ${points} Punkte bei PFUSCH Wheelie Escape. Schlägst du diesen Highscore?`;
}

/** A local best-score fallback is never a community rank. */
export function rankedGameShare(
  snapshot: { source: 'shopify' | 'local'; entries: { name: string; score: number; you: boolean }[] } | null,
  period: SharePeriod,
  date: string,
): Extract<GameShare, { kind: 'rank' }> | null {
  if (snapshot?.source !== 'shopify') return null;
  const index = snapshot.entries.findIndex((entry) => entry.you);
  if (index < 0) return null;
  const entry = snapshot.entries[index];
  return { kind: 'rank', name: entry.name === 'DU' ? '' : publicName(entry.name), score: entry.score, rank: index + 1, period, date };
}
