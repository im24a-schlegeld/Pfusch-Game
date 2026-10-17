import type { GameShare } from '../domain/gameShare';
import { shareGame, type SharePlatform } from './gameShare';

export type ShareReviveResult = 'ready' | 'unconfirmed' | 'cancelled' | 'failed' | 'unavailable';

/** One completed native share per ride. A fallback draft cannot confirm sharing;
 * only the server may confirm referrals or award referral currency. */
export class ShareReviveGate {
  private pending = false;
  private used = false;
  private closed = false;
  close() { this.closed = true; }
  async request(share: GameShare, platform: SharePlatform): Promise<ShareReviveResult> {
    if (this.pending || this.used || this.closed) return 'unavailable';
    this.pending = true;
    try {
      const result = await shareGame(share, platform);
      if (this.closed) return 'cancelled';
      if (result === 'opened') return 'unconfirmed';
      if (result !== 'shared') return result;
      this.used = true;
      return 'ready';
    } finally { this.pending = false; }
  }
}
