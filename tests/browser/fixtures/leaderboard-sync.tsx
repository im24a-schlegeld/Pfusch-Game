import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Leaderboard } from '../../../app/ui/Screens';
import { newPlayer } from '../../../app/domain/progression';
import type { Player } from '../../../app/domain/types';
import { createServices, decodePlayer, LocalLeaderboardService, LocalPlayerRepository } from '../../../app/services';
import { ShopifyCloudRepository } from '../../../app/services/shopifyCloud';
import { ShopifyLeaderboardService } from '../../../app/services/shopifyLeaderboard';
import { trialAccess } from '../../../app/services/playerAccess';
import type { CloudResponse, CloudTransport } from '../../../app/services/shopifyBridge';

const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
let committed: Player = { ...newPlayer(), leaderboardName: 'Sam', highScore: 100, runsPlayed: 4 };
let pending: (() => void) | undefined;
const probe = { fetches: 0, posts: 0, periods: [] as string[], saving: false, acknowledge: () => pending?.(), completeTrial: () => {} };
declare global { interface Window { leaderboardSyncProbe: typeof probe } }
window.leaderboardSyncProbe = probe;
const snapshot = (): CloudResponse => ({ status: 200, data: {
  customer: { id: '123' }, player: committed, compareDigest: 'a'.repeat(64), csrfToken: 'csrf-token-for-test-only', storage: trialAccess(committed.runsPlayed),
} });
const transport: CloudTransport = {
  async request(method, body, resource, period) {
    if (resource === 'leaderboard') {
      probe.fetches += 1;
      probe.periods.push(period ?? '');
      return { status: 200, data: { source: 'shopify', message: 'Confirmed test ranking', entries: [
        { name: committed.leaderboardName || 'DU', score: committed.highScore, you: true },
        { name: 'Sam', score: 80, you: false },
      ] } };
    }
    if (method === 'GET') return snapshot();
    probe.posts += 1;
    probe.saving = true;
    return new Promise<CloudResponse>(resolve => {
      pending = () => {
        // Model the endpoint's awaited afterSave ranking update before its 200.
        committed = (body as { player: Player }).player;
        probe.saving = false;
        pending = undefined;
        resolve(snapshot());
      };
    });
  },
};
const repository = new ShopifyCloudRepository(transport, storage, new LocalPlayerRepository(storage), decodePlayer);
const player = await repository.load();
const services = { ...createServices(), auth: repository, players: repository, leaderboard: new ShopifyLeaderboardService(transport, new LocalLeaderboardService()) };
function Review() {
  const [current, setCurrent] = useState(player);
  const update = (next: Player) => { setCurrent(next); repository.save(next); };
  probe.completeTrial = () => update({ ...current, highScore: 222, runsPlayed: 5 });
  return <Leaderboard player={current} services={services} update={update} back={() => {}} />;
}
createRoot(document.getElementById('root')!).render(<Review />);
