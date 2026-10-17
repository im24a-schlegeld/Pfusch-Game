import { gameShareText, gameShareUrl, type GameShare } from '../domain/gameShare';

export interface SharePlatform {
  share?: (data: { title: string; text: string; url: string }) => Promise<void>;
  open?: (url: string) => boolean;
}

/** Opens a message draft; following the link does not confirm sharing. */
export function whatsappGameShareUrl(share: GameShare): string {
  return `https://wa.me/?text=${encodeURIComponent(`${gameShareText(share)}\n${gameShareUrl(share)}`)}`;
}

/** Open the fallback message draft.
 * A successful handoff does not prove delivery or grant referral rewards. */
export function openShareDraft(url: string, host: Pick<Window, 'open'> = window): boolean {
  const draft = host.open('about:blank', '_blank');
  if (!draft) return false;
  try {
    draft.opener = null;
    draft.location.href = url;
    return true;
  } catch { draft.close(); return false; }
}

export async function shareGame(share: GameShare, platform: SharePlatform): Promise<'shared' | 'opened' | 'cancelled' | 'unavailable' | 'failed'> {
  if (platform.share) {
    try {
      await platform.share({ title: 'PFUSCH · Wheelie Escape', text: gameShareText(share), url: gameShareUrl(share) });
      return 'shared';
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return 'cancelled';
      return 'failed';
    }
  }
  if (!platform.open) return 'unavailable';
  try { return platform.open(whatsappGameShareUrl(share)) ? 'opened' : 'failed'; }
  catch { return 'failed'; }
}
