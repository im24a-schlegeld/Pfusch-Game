import { describe, expect, it, vi } from 'vitest';
import { gameShareText, gameShareUrl, rankedGameShare, readGameShare, sharePeriodLabel, type GameShare } from '../app/domain/gameShare';
import { shareGame } from '../app/services/gameShare';

describe('public game sharing', () => {
  const score: GameShare = { kind: 'score', name: 'Fahrer + #1 & Crew', score: 158863, date: '2026-10-13' };
  it('round-trips display data without leaking account data or changing the canonical origin', () => {
    const url = new URL(gameShareUrl(score));
    expect(url.origin).toBe('https://game.pfusch-clothing.ch');
    expect(readGameShare(url.search)).toEqual(score);
    expect([...url.searchParams.keys()]).toEqual(['share', 'name', 'points', 'date']);
    expect(gameShareText(score)).toMatch(/158['’]863/);
    const attack = readGameShare('?share=invite&name=%3Cscript%3E&customerId=123&coins=9999&return_to=https%3A%2F%2Fevil.test');
    expect(attack).toEqual({ kind: 'invite', name: '<script>' });
    expect(gameShareUrl(attack!)).not.toContain('evil.test');
  });
  it('rejects malformed, excessive and incomplete score/rank links', () => {
    for (const query of [
      '?share=score&points=-1&date=2026-10-13',
      '?share=score&points=1.5&date=2026-10-13',
      '?share=score&points=NaN&date=2026-10-13',
      '?share=score&points=1000000000001&date=2026-10-13',
      '?share=score&points=5&date=2026-02-30',
      '?share=rank&points=5&date=2026-10-13&rank=0&period=day',
      '?share=rank&points=5&date=2026-10-13&rank=101&period=day',
      '?share=rank&points=5&date=2026-10-13&rank=2&period=unknown',
      '?share=rank&points=5&date=2026-10-13',
      `?share=invite&name=${'a'.repeat(2100)}`,
    ]) expect(readGameShare(query)).toBeNull();
  });
  it('never turns local best scores or absent players into a community rank', () => {
    const entries = [{ name: 'Alex', score: 500, you: false }, { name: 'DU', score: 200, you: true }];
    expect(rankedGameShare({ source: 'local', entries }, 'week', '2026-10-13')).toBeNull();
    expect(rankedGameShare(null, 'week', '2026-10-13')).toBeNull();
    expect(rankedGameShare({ source: 'shopify', entries: entries.slice(0, 1) }, 'week', '2026-10-13')).toBeNull();
    const rank = rankedGameShare({ source: 'shopify', entries }, 'week', '2026-10-13');
    expect(rank).toEqual({ kind: 'rank', name: '', score: 200, rank: 2, period: 'week', date: '2026-10-13' });
    expect(readGameShare(new URL(gameShareUrl(rank!)).search)).toEqual(rank);
    expect(sharePeriodLabel('week', '2026-10-13')).toBe('Wochenrangliste · ab 12.10.2026 (UTC)');
  });
  it('opens the system share sheet, treating a user cancellation as a normal outcome', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await shareGame(score, { share, clipboard })).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'PFUSCH · Wheelie Escape', text: gameShareText(score), url: gameShareUrl(score) });
    share.mockRejectedValue({ name: 'AbortError' });
    expect(await shareGame(score, { share, clipboard })).toBe('cancelled');
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });
  it('copies a direct link when sharing is unavailable, with a selectable-link fallback', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    expect(await shareGame(score, { clipboard })).toBe('copied');
    expect(clipboard.writeText).toHaveBeenCalledWith(gameShareUrl(score));
    const share = vi.fn().mockRejectedValue({ name: 'NotAllowedError' });
    expect(await shareGame(score, { share, clipboard })).toBe('copied');
    clipboard.writeText.mockRejectedValue(new Error('Clipboard unavailable'));
    expect(await shareGame(score, { clipboard })).toBe('manual');
    expect(await shareGame(score, {})).toBe('manual');
  });
});
