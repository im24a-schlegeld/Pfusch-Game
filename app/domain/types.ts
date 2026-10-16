export type Slot =
  | 'upper'
  | 'lower'
  | 'head'
  | 'accessory'
  | 'keychain'
  | 'cape'
  | 'collectible'
  | 'bike';
export type Ownership =
  | 'LOCKED'
  | 'UNLOCKED_DIGITAL'
  | 'OWNED_IRL'
  | 'EQUIPPED';
export interface ProductVariant {
  id: string;
  title: string;
  available: boolean;
  price: number;
  options: string[];
  baseColor?: string;
  image?: string;
}
export interface Product {
  id: string;
  title: string;
  handle: string;
  url: string;
  price: number;
  currency: string;
  image: string;
  localImage?: string;
  images: string[];
  category: Slot;
  type: string;
  baseColor: string;
  description: string;
  available: boolean;
  options: { name: string; values: string[] }[];
  variants: ProductVariant[];
  preview?: {
    /** Original shop image plus an interior UV rectangle; the bitmap is never repainted. */
    artwork?: ProductImage & {
      width: number;
      height: number;
      crop: { x: number; y: number; width: number; height: number };
    };
    colors: {
      id: string;
      label: string;
      optionValue: string | null;
      variantIds: string[];
      baseColor: string;
      front: ProductImage | null;
      back: ProductImage | null;
    }[];
    numberCustomization: boolean;
    numberConstraints?: { minDigits?: number; maxDigits?: number };
  };
}
export interface ProductImage {
  source: string;
  localImage: string;
  evidence?: string;
}
export interface ProductConfiguration {
  productId: string;
  variantId: string;
  customNumber?: string;
  hoodEnabled?: boolean;
}
export interface Bike {
  id: string;
  name: string;
  tag: string;
  price: number;
  level: number;
  acceleration: number;
  handling: number;
  stability: number;
  maxSpeed: number;
  color: string;
}
export type TutorialHint = 'controls' | 'ramp' | 'police' | 'radar' | 'traffic' | 'signs';
export interface Settings {
  /** Additive v1 metadata: last authenticated save device; absent historical saves stay unknown. */
  deviceType?: 'mobile' | 'tablet' | 'desktop' | 'unknown';
  muted: boolean;
  reducedMotion: boolean;
  quality: 'auto' | 'low';
  /** Additive schema-1 preference; older saves retain swipe controls. */
  touchControls: 'swipe' | 'buttons';
  tutorialSeen: boolean;
  /** Additive schema-1 progress for first encounters; independent of the legacy intro flag. */
  tutorialHintsSeen: TutorialHint[];
}
export interface RunStats {
  id: string;
  score: number;
  distance: number;
  seconds: number;
  bestCombo: number;
  nearMisses: number;
  jumps: number;
  wheelieMeters: number;
  maxSpeed: number;
  cause: string;
}
export interface ChallengeProgress {
  date: string;
  values: Record<string, number>;
  claimed: string[];
}
export type Helmet = 'fullface' | 'motocross';
export interface StickerPlacement {
  id: string;
  productId: string;
  /** Deterministic mesh path within the bike body or selected helmet shell. */
  surface: string;
  point: [number, number, number];
  normal: [number, number, number];
  size: number;
  rotation: number;
}
/** A cosmetic snapshot only; never contains inventory, balances or progress. */
export interface PlayerAppearance {
  equipped: Partial<Record<Slot, string>>;
  variants: Record<string, string>;
  customizations: Record<string, { customNumber?: string; hoodEnabled?: boolean }>;
  bike: string;
  paint: string;
  rims: string;
  helmet: Helmet;
  helmetColor: string;
  helmetVisor: string;
  pantsColor?: string;
  shoesColor?: string;
  stickers: Record<string, StickerPlacement[]>;
}
export interface SavedSetup {
  id: string;
  name: string;
  appearance: PlayerAppearance;
}
export interface Player {
  version: 1;
  id: string;
  xp: number;
  level: number;
  coins: number;
  tickets: number;
  /** Additive v1 digital referral ledger; absent saves migrate explicitly to zero. */
  guardianBells: GuardianBells;
  highScore: number;
  totalDistance: number;
  runsPlayed: number;
  totalNearMisses: number;
  totalWheelieMeters: number;
  ownedItems: string[];
  irlItems: string[];
  equipped: Partial<Record<Slot, string>>;
  variants: Record<string, string>;
  customizations: Record<
    string,
    { customNumber?: string; hoodEnabled?: boolean }
  >;
  bike: string;
  paint: string;
  rims: string;
  helmet: Helmet;
  helmetColor: string;
  helmetVisor: string;
  /** Additive schema-1 wardrobe palettes; absent values use the authored defaults. */
  pantsColor?: string;
  shoesColor?: string;
  /** Bike IDs plus additive v1 keys helmet:fullface and helmet:motocross. */
  stickers: Record<string, StickerPlacement[]>;
  /** Additive v1 field; older saves migrate to an empty setup library. */
  savedSetups: SavedSetup[];
  challenges: ChallengeProgress;
  redeemedRewards: string[];
  processedRuns: string[];
  /** Optional public leaderboard label; empty uses the neutral rider label. */
  leaderboardName: string;
  settings: Settings;
  history: { score: number; date: string }[];
}
export interface GuardianBells {
  /** Server-only referral credit. */
  earned: number;
  spent: number;
  /** Bounded recent debit receipts; cumulative counters never roll back. */
  spentRunIds: string[];
}
export interface RunReward {
  xp: number;
  coins: number;
  challengeIds: string[];
  newRecord: boolean;
  previousLevel: number;
  level: number;
}
export interface ChallengeDefinition {
  id: string;
  title: string;
  description: string;
  stat:
    | 'runs'
    | 'distance'
    | 'wheelie'
    | 'nearMisses'
    | 'score'
    | 'jumps'
    | 'signs';
  target: number;
  xp: number;
  coins: number;
  cadence: 'daily' | 'weekly';
}
export type AnalyticsEvent =
  | 'game_started'
  | 'run_started'
  | 'run_finished'
  | 'highscore_set'
  | 'level_up'
  | 'garage_opened'
  | 'product_viewed'
  | 'product_equipped'
  | 'product_link_clicked'
  | 'challenge_completed'
  | 'reward_viewed';
