import { gameShareText, gameShareUrl, type GameShare } from '../domain/gameShare';

export interface SharePlatform {
  share?: (data: { title: string; text: string; url: string }) => Promise<void>;
  clipboard?: { writeText(text: string): Promise<void> };
}

export async function shareGame(share: GameShare, platform: SharePlatform): Promise<'shared' | 'copied' | 'cancelled' | 'manual'> {
  const url = gameShareUrl(share);
  if (platform.share) {
    try {
      await platform.share({ title: 'PFUSCH · Wheelie Escape', text: gameShareText(share), url });
      return 'shared';
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    if (platform.clipboard) {
      await platform.clipboard.writeText(url);
      return 'copied';
    }
  } catch { /* A selectable link remains available without clipboard permission. */ }
  return 'manual';
}
