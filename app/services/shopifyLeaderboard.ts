import type { Player } from '../domain/types';
import type { LeaderboardService, LeaderboardSnapshot } from './index';
import type { CloudTransport } from './shopifyBridge';

export class ShopifyLeaderboardService implements LeaderboardService {
  constructor(private transport: CloudTransport, private local: LeaderboardService) {}
  list(player: Player, period: 'Today' | 'This week' | 'All time') { return this.local.list(player, period); }
  async fetch(player: Player, period: 'Today' | 'This week' | 'All time'): Promise<LeaderboardSnapshot> {
    try {
      const response = await this.transport.request('GET', undefined, 'leaderboard', period === 'Today' ? 'day' : period === 'This week' ? 'week' : 'all');
      const data = response.data;
      if (response.status !== 200 || !data || typeof data !== 'object') throw new Error('Leaderboard unavailable');
      const value = data as Record<string, unknown>;
      if (value.source !== 'shopify' || !Array.isArray(value.entries) || value.entries.length > 100 || typeof value.message !== 'string' || value.message.length > 500) throw new Error('Invalid leaderboard');
      const entries = value.entries.map((entry: unknown) => {
        if (!entry || typeof entry !== 'object') throw new Error('Invalid leaderboard entry');
        const row = entry as Record<string, unknown>;
        if (typeof row.name !== 'string' || row.name.length < 1 || row.name.length > 60 || typeof row.score !== 'number'
          || !Number.isSafeInteger(row.score) || row.score < 0 || typeof row.you !== 'boolean') throw new Error('Invalid leaderboard entry');
        return { name: row.name, score: row.score, you: row.you };
      });
      return { entries, source: 'shopify', message: value.message };
    } catch {
      return { entries: this.list(player, period), source: 'local', message: 'Kontorangliste nicht erreichbar. Hier siehst du nur deinen eigenen Bestwert.' };
    }
  }
}
