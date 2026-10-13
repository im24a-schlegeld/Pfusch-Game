import type { GameShare } from '../domain/gameShare';
import { shareGame, type SharePlatform } from './gameShare';

export type ShareReviveResult = 'ready' | 'cancelled' | 'failed' | 'unavailable';

/** Native sharing can confirm handing content to an app, not that it was sent.
 * Clipboard, fallback links, failure and dismissal never grant a continuation. */
export class ShareReviveGate {
  private pending = false;
  private used = false;
  private closed = false;
  close() { this.closed = true; }
  async request(share: GameShare, platform: SharePlatform): Promise<ShareReviveResult> {
    if (this.pending || this.used || this.closed || !platform.share) return 'unavailable';
    this.pending = true;
    try {
      const result = await shareGame(share, { share: data => platform.share!(data) });
      if (this.closed) return 'cancelled';
      if (result === 'cancelled') return 'cancelled';
      if (result !== 'shared') return 'failed';
      this.used = true;
      return 'ready';
    } finally { this.pending = false; }
  }
}
