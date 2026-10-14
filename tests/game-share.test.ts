import { describe, expect, it, vi } from 'vitest';
import { gameShareText, gameShareUrl, rankedGameShare, readGameShare, sharePeriodLabel, type GameShare } from '../app/domain/gameShare';
import { shareGame, whatsappGameShareUrl } from '../app/services/gameShare';

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
  it('keeps only well-formed referral codes in invitation links', () => {
    const invite: GameShare = { kind: 'invite', name: 'Alex', referral: 'v1.1234567890abcdef.Signed_public_invite-code' };
    expect(readGameShare(new URL(gameShareUrl(invite)).search)).toEqual(invite);
    expect(readGameShare('?share=invite&ref=https://evil.test')).toEqual({ kind: 'invite', name: '' });
    expect(gameShareUrl({ kind: 'invite', name: '', referral: 'invalid' })).not.toContain('ref=');
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
  it('leaves the clipboard untouched when native sharing is unavailable or fails', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    expect(await shareGame(score, { clipboard })).toBe('unavailable');
    const share = vi.fn().mockRejectedValue({ name: 'NotAllowedError' });
    expect(await shareGame(score, { share, clipboard })).toBe('failed');
    expect(await shareGame(score, {})).toBe('unavailable');
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });
  it.each<GameShare>([
    score,
    { kind: 'rank', name: 'Alex & Crew', score: 200, rank: 2, period: 'week', date: '2026-10-13' },
    { kind: 'invite', name: 'Alex + Crew', referral: 'v1.1234567890abcdef.Signed_public_invite-code' },
  ])('keeps the $kind message and game data inside one WhatsApp text parameter', content => {
    const url = new URL(whatsappGameShareUrl(content));
    expect(url.origin).toBe('https://wa.me');
    expect(url.pathname).toBe('/');
    expect([...url.searchParams.keys()]).toEqual(['text']);
    const [message, gameUrl] = url.searchParams.get('text')!.split('\n');
    expect(message).toContain(content.name);
    expect(message).toContain('PFUSCH Wheelie Escape');
    const destination = new URL(gameUrl);
    expect(destination.origin).toBe('https://game.pfusch-clothing.ch');
    expect(readGameShare(destination.search)).toEqual(content);
  });
});
