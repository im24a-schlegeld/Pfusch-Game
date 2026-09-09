import type {
  AnalyticsEvent,
  Player,
  Product,
  RunReward,
  RunStats,
} from '../domain/types';
import {
  finishRun,
  levelForXp,
  newPlayer,
  refreshDaily,
} from '../domain/progression';
import { BIKES, REWARDS } from '../domain/config';

export interface AuthService {
  getUser(): Promise<{ id: string; kind: 'guest' | 'customer' }>;
}
export interface PlayerRepository {
  load(): Promise<Player>;
  save(player: Player): void;
  export(player: Player): string;
  readonly warning: string;
}
export interface ProductProvider {
  list(): Promise<Product[]>;
}
export interface RewardService {
  settle(
    player: Player,
    run: RunStats,
  ): { player: Player; reward: RunReward } | null;
  redeem(player: Player, rewardId: string): Player | null;
}
export interface LeaderboardService {
  list(
    player: Player,
    period: 'Today' | 'This week' | 'All time',
  ): LeaderboardEntry[];
}
export interface AnalyticsService {
  track(event: AnalyticsEvent, data?: Record<string, string | number>): void;
}
export interface LeaderboardEntry {
  name: string;
  score: number;
  you: boolean;
}
export interface StorageDriver {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export class GuestAuthService implements AuthService {
  async getUser() {
    return { id: 'guest-local', kind: 'guest' as const };
  }
}

const key = 'pfusch:player:v1';
const stringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export function decodePlayer(raw: string): Player {
  const v: unknown = JSON.parse(raw);
  if (!isRecord(v) || v.version !== 1)
    throw new Error('Unsupported save version');
  const base = newPlayer();
  const p = { ...base };
  for (const field of [
    'xp',
    'coins',
    'tickets',
    'highScore',
    'totalDistance',
    'runsPlayed',
    'totalNearMisses',
    'totalWheelieMeters',
  ] as const) {
    const n = v[field];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0)
      throw new Error('Invalid save');
    p[field] = n;
  }
  for (const field of [
    'ownedItems',
    'irlItems',
    'redeemedRewards',
    'processedRuns',
  ] as const) {
    if (!stringArray(v[field])) throw new Error('Invalid inventory');
    p[field] = v[field];
  }
  if (typeof v.bike === 'string' && BIKES.some((b) => b.id === v.bike))
    p.bike = v.bike;
  for (const field of ['paint', 'rims'] as const)
    if (typeof v[field] === 'string' && /^#[0-9a-f]{6}$/i.test(v[field]))
      p[field] = v[field];
  // Additive v1 migration: obsolete vehicle registration customization is discarded.
  p.ownedItems=p.ownedItems.filter(id=>!id.startsWith("decal:"));
  p.redeemedRewards=p.redeemedRewards.filter(id=>id!=="crew-decal");
  if (isRecord(v.equipped))
    for (const slot of [
      'upper',
      'lower',
      'head',
      'accessory',
      'collectible',
      'bike',
    ] as const)
      if (typeof v.equipped[slot] === 'string')
        p.equipped[slot] = v.equipped[slot];
  if (isRecord(v.variants))
    for (const [id, value] of Object.entries(v.variants))
      if (typeof value === 'string') p.variants[id] = value;
  // Additive v1 migration: earlier saves have no garment customization map.
  if (isRecord(v.customizations))
    for (const [id, value] of Object.entries(v.customizations))
      if (
        isRecord(value) &&
        typeof value.customNumber === 'string' &&
        /^\d{1,2}$/.test(value.customNumber)
      )
        p.customizations[id] = { customNumber: value.customNumber };
  if (isRecord(v.settings)) {
    for (const field of ['muted', 'reducedMotion', 'tutorialSeen'] as const)
      if (typeof v.settings[field] === 'boolean')
        p.settings[field] = v.settings[field];
    if (v.settings.quality === 'low') p.settings.quality = 'low';
  }
  if (
    isRecord(v.challenges) &&
    typeof v.challenges.date === 'string' &&
    isRecord(v.challenges.values) &&
    stringArray(v.challenges.claimed)
  ) {
    const values: Record<string, number> = {};
    for (const [id, n] of Object.entries(v.challenges.values))
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) values[id] = n;
    p.challenges = {
      date: v.challenges.date,
      values,
      claimed: v.challenges.claimed,
    };
  }
  if (Array.isArray(v.history))
    p.history = v.history
      .filter(
        (h): h is { score: number; date: string } =>
          isRecord(h) &&
          typeof h.score === 'number' &&
          Number.isFinite(h.score) &&
          h.score >= 0 &&
          typeof h.date === 'string',
      )
      .slice(-200);
  p.level = levelForXp(p.xp);
  return refreshDaily(p);
}
export class LocalPlayerRepository implements PlayerRepository {
  warning = '';
  private writable = true;
  constructor(private storage: StorageDriver) {}
  async load() {
    try {
      const raw = this.storage.getItem(key);
      if (!raw) return newPlayer();
      try {
        return decodePlayer(raw);
      } catch {
        this.storage.setItem(`${key}:recovery`, raw);
        this.warning =
          'Your previous save could not be read. A recovery copy was kept on this device.';
        return newPlayer();
      }
    } catch {
      this.writable = false;
      this.warning =
        'Browser storage is unavailable. This session works, but progress will not survive closing the page.';
      return newPlayer();
    }
  }
  save(p: Player) {
    if (!this.writable) return;
    try {
      this.storage.setItem(key, JSON.stringify(p));
    } catch {
      this.warning =
        'Saving failed. Export your progress in Settings before closing.';
    }
  }
  export(p: Player) {
    return JSON.stringify(p, null, 2);
  }
}
export class LocalProductProvider implements ProductProvider {
  async list() {
    const response = await fetch('/catalog/products.json');
    if (!response.ok)
      throw new Error('The gear catalog could not load. Please reload.');
    const data: unknown = await response.json();
    if (!Array.isArray(data) || data.length === 0)
      throw new Error('The gear catalog is empty.');
    return data as Product[];
  }
}
export class MockRewardService implements RewardService {
  settle = finishRun;
  redeem(p: Player, id: string) {
    const r = REWARDS.find((x) => x.id === id);
    if (
      !r ||
      r.kind === 'future' ||
      r.level > p.level ||
      p.redeemedRewards.includes(id)
    )
      return null;
    const next = { ...p, redeemedRewards: [...p.redeemedRewards, id] };
    if (r.kind === 'coins') next.coins += 100;
    if (r.kind === 'cosmetic')
      next.ownedItems = [...p.ownedItems, 'rims:#d9f365'];
    return next;
  }
}
export class LocalLeaderboardService implements LeaderboardService {
  list(p: Player, period: 'Today' | 'This week' | 'All time') {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const monday = new Date(`${today}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const scores = p.history
      .filter(
        (r) =>
          period === 'All time' ||
          (period === 'Today'
            ? r.date === today
            : r.date >= monday.toISOString().slice(0, 10)),
      )
      .map((r) => r.score);
    const top = period === 'All time' ? p.highScore : Math.max(0, ...scores);
    const factor = period === 'Today' ? 1 : period === 'This week' ? 1.8 : 3;
    return [
      { name: 'NIGHTSHIFT', score: Math.floor(8200 * factor), you: false },
      { name: 'SUMO.ELI', score: Math.floor(5800 * factor), you: false },
      { name: 'ZIPTIE.KID', score: Math.floor(3500 * factor), you: false },
      { name: 'LATE.APEX', score: Math.floor(1800 * factor), you: false },
      { name: 'YOU', score: top, you: true },
    ].sort((a, b) => b.score - a.score);
  }
}
export class LocalAnalyticsService implements AnalyticsService {
  events: {
    event: AnalyticsEvent;
    data?: Record<string, string | number>;
    time: number;
  }[] = [];
  track(event: AnalyticsEvent, data?: Record<string, string | number>) {
    this.events.push({ event, data, time: Date.now() });
    if (this.events.length > 100) this.events.shift();
  }
}
export interface Services {
  auth: AuthService;
  players: PlayerRepository;
  products: ProductProvider;
  rewards: RewardService;
  leaderboard: LeaderboardService;
  analytics: AnalyticsService;
}
export function createServices(): Services {
  const storage: StorageDriver = {
    getItem: (k) => window.localStorage.getItem(k),
    setItem: (k, v) => window.localStorage.setItem(k, v),
  };
  return {
    auth: new GuestAuthService(),
    players: new LocalPlayerRepository(storage),
    products: new LocalProductProvider(),
    rewards: new MockRewardService(),
    leaderboard: new LocalLeaderboardService(),
    analytics: new LocalAnalyticsService(),
  };
}
