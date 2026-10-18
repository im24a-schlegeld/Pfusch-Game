import { DARK_CARBON } from '../domain/carbon';
import type {
  AnalyticsEvent,
  Player,
  Product,
  RunReward,
  RunStats,
  StickerPlacement,
} from '../domain/types';
import {
  finishRun,
  levelForXp,
  normalizeLeaderboardName,
  newPlayer,
  refreshDaily,
} from '../domain/progression';
import { BIKES, REWARDS } from '../domain/config';
import { isHelmet, isHelmetColor, isVisorColor, migrateHelmetInventory } from '../domain/helmet';
import { migrateProductInventory } from '../domain/productOwnership';
import { MAX_STICKERS, STICKER_TARGETS, validStickerForTarget } from '../domain/stickers';
import { shadeClothingCatalog } from '../domain/appearanceColors';
import { sanitizeSavedSetups } from '../domain/setups';
import { normalizeTutorialHints } from '../domain/tutorial';
import { getPantsColor, getShoesColor } from '../domain/riderColors';
import catalog from '../../public/catalog/products.json';
import { ShopifyParentTransport, shopifyParentOrigin } from './shopifyBridge';
import { ShopifyCloudRepository } from './shopifyCloud';
import { ShopifyLeaderboardService } from './shopifyLeaderboard';
import { readOxygenRuntime, startOxygenLogin } from './oxygenRuntime';
import { OxygenTransport } from './oxygenTransport';
import { trialAccess, type PlayerAccess } from './playerAccess';
import { OxygenVerifiedRewards, type VerifiedRewardsService } from './verifiedRewards';
import { OxygenInvites, withInvitations, type InviteService } from './referrals';
import { createAccountFetch } from './accountFetch';
import { readGuardianBells } from '../domain/guardianBells';
import type { PlayerGift } from './playerGifts';
import { InstallHintReminder } from './installHintReminder';
import { GamePriceProductProvider } from './gamePriceProducts';
export type { PlayerAccess } from './playerAccess';

export interface AuthService {
  getUser(): Promise<{ id: string; kind: 'guest' | 'customer' }>;
  login?(): void;
}
export interface PlayerRepository {
  load(): Promise<Player>;
  save(player: Player): void;
  export(player: Player): string;
  readonly warning: string;
  readonly syncStatus?: PlayerSyncStatus;
  subscribeSync?(listener: () => void): () => void;
  flush?(): Promise<void>;
  getAccess?(): PlayerAccess;
  refreshAccess?(): Promise<PlayerAccess>;
  readonly gifts?: readonly PlayerGift[];
  acknowledgeGifts?(ids: string[]): Promise<void>;
  readonly purchaseStatus?: { available: boolean; reason?: 'orders_scope_missing' | 'orders_unavailable'; history: 'all' | 'recent' };
}
export interface PlayerSyncStatus {
  state: 'local' | 'loading' | 'synced' | 'saving' | 'offline' | 'conflict' | 'guest' | 'unavailable';
  message: string;
}
export interface ProductProvider {
  list(): Promise<Product[]>;
}
export interface RewardService {
  readonly real?: VerifiedRewardsService;
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
  fetch?(player: Player, period: 'Today' | 'This week' | 'All time'): Promise<LeaderboardSnapshot>;
}
export interface LeaderboardSnapshot {
  entries: LeaderboardEntry[];
  source: 'shopify' | 'local';
  message: string;
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
    throw new Error('Nicht unterstützte Spielstand-Version');
  const base = newPlayer();
  const p = { ...base };
  p.guardianBells = readGuardianBells(v.guardianBells);
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
      throw new Error('Ungültiger Spielstand');
    p[field] = n;
  }
  for (const field of [
    'ownedItems',
    'irlItems',
    'redeemedRewards',
    'processedRuns',
  ] as const) {
    if (!stringArray(v[field])) throw new Error('Ungültiges Inventar');
    p[field] = v[field];
  }
  if (typeof v.bike === 'string' && BIKES.some((b) => b.id === v.bike))
    p.bike = v.bike;
  for (const field of ['paint', 'rims'] as const)
    if (typeof v[field] === 'string' && (/^#[0-9a-f]{6}$/i.test(v[field]) || (v[field] === DARK_CARBON && p.ownedItems.includes(`${field}:${DARK_CARBON}`))))
      p[field] = v[field];
  // Additive v1 migration: older saves keep the original full-face chalk helmet.
  // Invalid optional helmet values recover independently without losing progress.
  if (isHelmet(v.helmet)) p.helmet = v.helmet;
  if (isHelmetColor(v.helmetColor)) p.helmetColor = v.helmetColor;
  // Additive v1 migration: previous saves have neither visor tint nor placements.
  if (isVisorColor(v.helmetVisor)) p.helmetVisor = v.helmetVisor;
  // Optional schema-1 wardrobe colours recover independently of game progress.
  p.pantsColor = getPantsColor({ pantsColor: typeof v.pantsColor === 'string' ? v.pantsColor : undefined });
  p.shoesColor = getShoesColor({ shoesColor: typeof v.shoesColor === 'string' ? v.shoesColor : undefined });
  if (p.helmetColor === DARK_CARBON && !p.ownedItems.includes(`helmetColor:${DARK_CARBON}`)) p.helmetColor = newPlayer().helmetColor;
  if (p.helmetVisor === DARK_CARBON && !p.ownedItems.includes(`helmetVisor:${DARK_CARBON}`)) p.helmetVisor = newPlayer().helmetVisor;
  // Additive v1 migration: absent helmet target lists stay empty; bike paths are unchanged.
  if (isRecord(v.stickers))
    for (const target of STICKER_TARGETS) {
      const placements = v.stickers[target];
      if (Array.isArray(placements)) {
        const ids = new Set<string>();
        p.stickers[target] = placements.filter((placement): placement is StickerPlacement => validStickerForTarget(target, placement)).filter((placement) => {
          if (ids.has(placement.id) || !catalog.some((product) => product.id === placement.productId && product.handle === 'chrome-sticker')) return false;
          ids.add(placement.id);
          return p.ownedItems.includes(placement.productId) || p.irlItems.includes(placement.productId);
        }).slice(0, MAX_STICKERS);
      }
    }
  // Additive v1 migration: obsolete vehicle registration customization is discarded.
  // Replace the retired neon signal finish in existing local and cloud saves.
  if (p.paint === '#d9f365') p.paint = '#7461a5';
  if (p.rims === '#d9f365') p.rims = '#7461a5';
  p.ownedItems = p.ownedItems.map((id) => id === 'rims:#d9f365' ? 'rims:#7461a5' : id);
  p.ownedItems = p.ownedItems.filter((id) => !id.startsWith('decal:'));
  p.redeemedRewards = p.redeemedRewards.filter((id) => id !== 'crew-decal');
  if (isRecord(v.equipped))
    for (const slot of [
      'upper',
      'lower',
      'head',
      'accessory',
      'keychain',
      // Additive schema-1 slot; legacy saves have no cape until explicitly equipped.
      'cape',
      'collectible',
      'bike',
    ] as const)
      if (typeof v.equipped[slot] === 'string')
        p.equipped[slot] = v.equipped[slot];
  // Move the old exclusive accessory selection into its new independent slot.
  if (catalog.some((product) => product.handle === 'schlusselanhanger' && product.id === p.equipped.accessory)) {
    p.equipped.keychain ??= p.equipped.accessory;
    delete p.equipped.accessory;
  }
  if (isRecord(v.variants))
    for (const [id, value] of Object.entries(v.variants))
      if (typeof value === 'string') p.variants[id] = value;
  if (v.leaderboardName !== undefined) {
    const name = normalizeLeaderboardName(v.leaderboardName);
    if (typeof v.leaderboardName === 'string' && (!v.leaderboardName.trim() || name))
      p.leaderboardName = name;
  }
  // Additive v1 migration: earlier saves have no customization map or hood flag.
  // Missing/invalid hood flags stay off; recover each optional field independently.
  if (isRecord(v.customizations))
    for (const [id, value] of Object.entries(v.customizations)) {
      if (!isRecord(value)) continue;
      const customization: Player['customizations'][string] = {};
      if (
        typeof value.customNumber === 'string' &&
        /^\d{1,2}$/.test(value.customNumber)
      )
        customization.customNumber = value.customNumber;
      if (typeof value.hoodEnabled === 'boolean')
        customization.hoodEnabled = value.hoodEnabled;
      if (Object.keys(customization).length) p.customizations[id] = customization;
    }
  if (isRecord(v.settings)) {
    // Additive v1 migration: preserve absence rather than inventing historical device data.
    if (typeof v.settings.deviceType === 'string' && ['mobile', 'tablet', 'desktop', 'unknown'].includes(v.settings.deviceType))
      p.settings.deviceType = v.settings.deviceType as Player['settings']['deviceType'];
    for (const field of ['muted', 'reducedMotion', 'tutorialSeen'] as const)
      if (typeof v.settings[field] === 'boolean')
        p.settings[field] = v.settings[field];
    if (v.settings.quality === 'low') p.settings.quality = 'low';
    // Additive v1 migration: old snapshots without this preference retain the
    // original swipe behaviour. New snapshots created by newPlayer use buttons.
    if (v.settings.touchControls === 'swipe' || v.settings.touchControls === 'buttons')
      p.settings.touchControls = v.settings.touchControls;
    else if (!Object.prototype.hasOwnProperty.call(v.settings, 'touchControls'))
      p.settings.touchControls = 'swipe';
    // v1 saves from before contextual onboarding have no lesson acknowledgements.
    // Do not infer these from tutorialSeen: the old static guide did not teach these encounters.
    p.settings.tutorialHintsSeen = normalizeTutorialHints(v.settings.tutorialHintsSeen);
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
  p.ownedItems = migrateProductInventory(migrateHelmetInventory(p), catalog as Product[]).ownedItems;
  // Additive v1 migration: a setup library is optional in existing local/account saves.
  p.savedSetups = sanitizeSavedSetups(v.savedSetups, p);
  return refreshDaily(p);
}
export class LocalPlayerRepository implements PlayerRepository {
  warning = '';
  private writable = true;
  private access = trialAccess(0);
  private listeners = new Set<() => void>();
  constructor(private storage: StorageDriver) {}
  getAccess = (): PlayerAccess => this.access;
  subscribeSync = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private countRuns(player: Player) {
    const runs = Math.max(this.access.completedRuns, Math.floor(player.runsPlayed));
    if (runs === this.access.completedRuns) return;
    this.access = trialAccess(runs);
    for (const listener of this.listeners) listener();
  }
  async refreshAccess() {
    await this.load();
    return this.access;
  }
  async load() {
    try {
      const raw = this.storage.getItem(key);
      if (!raw) return newPlayer();
      try {
        const stored: unknown = JSON.parse(raw);
        // Additive v1 recovery: a misplaced account snapshot must never become
        // the logged-out inventory. Preserve it for recovery before resetting.
        if (isRecord(stored) && typeof stored.id === 'string' && stored.id.startsWith('shopify:')) {
          this.storage.setItem(`${key}:misplaced-account`, raw);
          return newPlayer();
        }
        const player = decodePlayer(raw);
        player.irlItems = [];
        this.countRuns(player);
        return player;
      } catch {
        this.storage.setItem(`${key}:recovery`, raw);
        this.warning =
          'Der bisherige Spielstand konnte nicht gelesen werden. Eine Sicherung wurde auf diesem Gerät behalten.';
        return newPlayer();
      }
    } catch {
      this.writable = false;
      this.warning =
        'Browserspeicher ist nicht verfügbar. Diese Sitzung funktioniert, der Fortschritt geht beim Schliessen verloren.';
      return newPlayer();
    }
  }
  save(p: Player) {
    const allowed = this.access.allowed && p.runsPlayed <= 5;
    this.countRuns(p);
    if (!allowed) return;
    if (!this.writable) return;
    try {
      this.storage.setItem(key, JSON.stringify(p));
    } catch {
      this.warning =
        'Speichern fehlgeschlagen. Exportiere den Spielstand in den Einstellungen, bevor du die Seite schliesst.';
    }
  }
  export(p: Player) {
    return JSON.stringify(p, null, 2);
  }
}
export class LocalProductProvider implements ProductProvider {
  async list() {
    // The appearance palette already bundles this same central snapshot.
    // Reuse it instead of delaying startup with a second copy over the network.
    if (!Array.isArray(catalog) || catalog.length === 0)
      throw new Error('Der Kleidungskatalog ist leer.');
    return shadeClothingCatalog(catalog as Product[]);
  }
}
export class MockRewardService implements RewardService {
  constructor(readonly real?: VerifiedRewardsService) {}
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
    if (r.kind === 'coins') next.coins += r.coins;
    if (r.kind === 'cosmetic')
      next.ownedItems = p.ownedItems.includes(r.itemId) ? p.ownedItems : [...p.ownedItems, r.itemId];
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
              : r.date >= monday.toISOString().slice(0, 10) && r.date <= today),
      )
      .map((r) => r.score);
    const top = period === 'All time' ? p.highScore : Math.max(0, ...scores);
    if (period === 'All time' ? !p.runsPlayed && top === 0 : scores.length === 0) return [];
    return [{ name: p.leaderboardName || 'DU', score: top, you: true }];
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
  invites?: InviteService;
  installHint?: InstallHintReminder;
}
export function createServices(): Services {
  const storage: StorageDriver = {
    getItem: (k) => window.localStorage.getItem(k),
    setItem: (k, v) => window.localStorage.setItem(k, v),
  };
  const local = new LocalPlayerRepository(storage);
  const oxygen = readOxygenRuntime(document);
  const parentOrigin = shopifyParentOrigin(window.parent !== window, document.referrer);
  const accountFetch = createAccountFetch(window.fetch.bind(window), window.location.origin, window.navigator.locks);
  const invites = oxygen ? new OxygenInvites(storage, accountFetch) : undefined;
  invites?.capture(window.location.search);
  const transport = oxygen && invites ? withInvitations(new OxygenTransport(accountFetch), invites) : parentOrigin ? new ShopifyParentTransport(window, parentOrigin) : null;
  const cloud = transport
    ? new ShopifyCloudRepository(transport, storage, local, decodePlayer)
    : null;
  const shopifyLogin = parentOrigin
    ? () => startOxygenLogin(window, parentOrigin, document.referrer)
    : undefined;
  return {
    auth: oxygen && cloud
      ? { getUser: () => cloud.getUser(), login: () => startOxygenLogin(window, parentOrigin, document.referrer) }
      : cloud
        ? { getUser: () => cloud.getUser(), ...(shopifyLogin ? { login: shopifyLogin } : {}) }
        : new GuestAuthService(),
    players: cloud ?? local,
    products: new GamePriceProductProvider(new LocalProductProvider(), storage, oxygen ? accountFetch : undefined),
    rewards: new MockRewardService(oxygen ? new OxygenVerifiedRewards(accountFetch, undefined, () => cloud?.invalidateSession()) : undefined),
    leaderboard: transport ? new ShopifyLeaderboardService(transport, new LocalLeaderboardService(), cloud ?? undefined) : new LocalLeaderboardService(),
    analytics: new LocalAnalyticsService(),
    invites,
    installHint: new InstallHintReminder(storage),
  };
}
