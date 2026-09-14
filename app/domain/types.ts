export type Slot =
  | 'upper'
  | 'lower'
  | 'head'
  | 'accessory'
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
export interface Settings {
  muted: boolean;
  reducedMotion: boolean;
  quality: 'auto' | 'low';
  tutorialSeen: boolean;
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
export interface Player {
  version: 1;
  id: string;
  xp: number;
  level: number;
  coins: number;
  tickets: number;
  highScore: number;
  totalDistance: number;
  runsPlayed: number;
  totalNearMisses: number;
  totalWheelieMeters: number;
  ownedItems: string[];
  irlItems: string[];
  equipped: Partial<Record<Slot, string>>;
  variants: Record<string, string>;
  customizations: Record<string, { customNumber?: string }>;
  bike: string;
  paint: string;
  rims: string;
  helmet: Helmet;
  helmetColor: string;
  challenges: ChallengeProgress;
  redeemedRewards: string[];
  processedRuns: string[];
  settings: Settings;
  history: { score: number; date: string }[];
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
    | 'combo'
    | 'score'
    | 'jumps';
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
