import { gameShareText, gameShareUrl, type GameShare } from '../domain/gameShare';

export interface SharePlatform {
  open?: (url: string) => boolean;
}
export type ShareTarget = 'whatsapp' | 'telegram' | 'email';

/** Opens a message draft; following the link does not confirm sharing. */
export function whatsappGameShareUrl(share: GameShare): string {
  return `https://wa.me/?text=${encodeURIComponent(`${gameShareText(share)}\n${gameShareUrl(share)}`)}`;
}

export function directGameShareUrl(share: GameShare, target: ShareTarget): string {
  if (target === 'whatsapp') return whatsappGameShareUrl(share);
  if (target === 'telegram') return `https://t.me/share/url?url=${encodeURIComponent(gameShareUrl(share))}&text=${encodeURIComponent(gameShareText(share))}`;
  return `mailto:?subject=${encodeURIComponent('PFUSCH · Wheelie Escape')}&body=${encodeURIComponent(`${gameShareText(share)}\n${gameShareUrl(share)}`)}`;
}

/** Open a chosen message draft without the OS sheet's copy-link action.
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

export async function shareGame(share: GameShare, target: ShareTarget, platform: SharePlatform): Promise<'opened' | 'unavailable' | 'failed'> {
  if (!platform.open) return 'unavailable';
  try { return platform.open(directGameShareUrl(share, target)) ? 'opened' : 'failed'; }
  catch { return 'failed'; }
}
