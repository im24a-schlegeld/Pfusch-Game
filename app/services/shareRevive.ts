import type { GameShare } from '../domain/gameShare';
import { shareGame, type SharePlatform, type ShareTarget } from './gameShare';

export type ShareReviveResult = 'ready' | 'cancelled' | 'failed' | 'unavailable';

/** One explicit app-draft handoff per ride. Delivery is not verifiable here;
 * only the server may confirm referrals or award referral currency. */
export class ShareReviveGate {
  private pending = false;
  private used = false;
  private closed = false;
  close() { this.closed = true; }
  async request(share: GameShare, target: Exclude<ShareTarget, 'email'>, platform: SharePlatform): Promise<ShareReviveResult> {
    if (this.pending || this.used || this.closed || !platform.open) return 'unavailable';
    this.pending = true;
    try {
      const result = await shareGame(share, target, platform);
      if (this.closed) return 'cancelled';
      if (result !== 'opened') return 'failed';
      this.used = true;
      return 'ready';
    } finally { this.pending = false; }
  }
}
