import { gameShareText, gameShareUrl, type GameShare } from '../domain/gameShare';

export interface SharePlatform {
  share?: (data: { title: string; text: string; url: string }) => Promise<void>;
  clipboard?: { writeText(text: string): Promise<void> };
}

/** Opens a message draft; following the link does not confirm sharing. */
export function whatsappGameShareUrl(share: GameShare): string {
  return `https://wa.me/?text=${encodeURIComponent(`${gameShareText(share)}\n${gameShareUrl(share)}`)}`;
}

export async function shareGame(share: GameShare, platform: SharePlatform): Promise<'shared' | 'cancelled' | 'unavailable' | 'failed'> {
  if (!platform.share) return 'unavailable';
  try {
    await platform.share({ title: 'PFUSCH · Wheelie Escape', text: gameShareText(share), url: gameShareUrl(share) });
    return 'shared';
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return 'cancelled';
    return 'failed';
  }
}
