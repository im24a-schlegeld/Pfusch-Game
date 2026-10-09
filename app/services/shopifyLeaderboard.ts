import type { Player } from '../domain/types';
import type { AuthService, LeaderboardService, LeaderboardSnapshot } from './index';
import type { CloudTransport } from './shopifyBridge';

export class ShopifyLeaderboardService implements LeaderboardService {
  constructor(private transport: CloudTransport, private local: LeaderboardService, private auth?: Pick<AuthService, 'getUser'>) {}
  list(player: Player, period: 'Today' | 'This week' | 'All time') { return this.local.list(player, period); }
  async fetch(player: Player, period: 'Today' | 'This week' | 'All time'): Promise<LeaderboardSnapshot> {
    const signInRequired = (): LeaderboardSnapshot => ({ entries: this.list(player, period), source: 'local',
      message: 'Melde dich an, um die Community-Rangliste zu sehen. Hier siehst du deinen eigenen Bestwert.' });
    try {
      if (this.auth && (await this.auth.getUser()).kind === 'guest') return signInRequired();
      const response = await this.transport.request('GET', undefined, 'leaderboard', period === 'Today' ? 'day' : period === 'This week' ? 'week' : 'all');
      if (response.status === 401) return signInRequired();
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
