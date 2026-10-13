import { LEVELS } from './config.js';
import { DAILY_SIGN_CHALLENGE, dailyChallengesForDate, normalizeDailyProgress } from './dailyChallenges.js';
import { DEFAULT_HELMET, DEFAULT_HELMET_COLOR, HELMET_INVENTORY_MIGRATION } from './helmet.js';
import { ownsProductColor } from './productOwnership.js';
import { equipmentSlot } from './preview.js';
import { DEFAULT_PANTS_COLOR, DEFAULT_SHOES_COLOR } from './riderColors.js';
import type { Player, Product, RunReward, RunStats, Ownership } from './types';
export const LEADERBOARD_NAME_MAX_LENGTH = 24;
export function normalizeLeaderboardName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > LEADERBOARD_NAME_MAX_LENGTH || [...name].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  })) return '';
  return name;
}
export const dayKey = (date = new Date()) => date.toISOString().slice(0, 10);
export const levelForXp = (xp: number) =>
  Math.max(1, LEVELS.filter((n) => xp >= n).length);
export function levelProgress(xp: number) {
  const level = levelForXp(xp);
  const floor = LEVELS[level - 1];
  const ceiling = LEVELS[level] ?? floor;
  return {
    level,
    current: xp - floor,
    needed: ceiling - floor,
    percent:
      level === 10
        ? 100
        : Math.min(100, ((xp - floor) / (ceiling - floor)) * 100),
  };
}
export function newPlayer(): Player {
  return {
    version: 1,
    id: 'guest-local',
    xp: 0,
    level: 1,
    coins: 150,
    tickets: 0,
    highScore: 0,
    totalDistance: 0,
    runsPlayed: 0,
    totalNearMisses: 0,
    totalWheelieMeters: 0,
    ownedItems: ['bike:125', 'paint:#e7e7df', 'rims:#a6acb0', HELMET_INVENTORY_MIGRATION],
    irlItems: [],
    equipped: {},
    variants: {},
    customizations: {},
    bike: '125',
    paint: '#e7e7df',
    rims: '#a6acb0',
    helmet: DEFAULT_HELMET,
    helmetColor: DEFAULT_HELMET_COLOR,
    helmetVisor: '#34454d',
    pantsColor: DEFAULT_PANTS_COLOR,
    shoesColor: DEFAULT_SHOES_COLOR,
    stickers: {},
    savedSetups: [],
    challenges: { date: dayKey(), values: {}, claimed: [] },
    redeemedRewards: [],
    processedRuns: [],
    leaderboardName: '',
    settings: {
      muted: true,
      reducedMotion: false,
      quality: 'auto',
      // Touch devices start with the explicit on-screen controls. Swiping
      // remains available in Settings and still controls lateral lanes.
      touchControls: 'buttons',
      tutorialSeen: false,
      tutorialHintsSeen: [],
    },
    history: [],
  };
}
export function refreshDaily(p: Player, date = dayKey()): Player {
  const challenges = normalizeDailyProgress(p.challenges, date);
  // Canonical saved letter keys can already form a complete set after recovery.
  // Set its digital payout and claim together so decode/refresh cannot repay it.
  if (challenges.values[DAILY_SIGN_CHALLENGE.id] === DAILY_SIGN_CHALLENGE.target &&
      !challenges.claimed.includes(DAILY_SIGN_CHALLENGE.id)) {
    return { ...p, coins: p.coins + DAILY_SIGN_CHALLENGE.coins,
      challenges: { ...challenges, claimed: [...challenges.claimed, DAILY_SIGN_CHALLENGE.id] } };
  }
  return challenges === p.challenges ? p : { ...p, challenges };
}
export function finishRun(
  player: Player,
  run: RunStats,
  date = dayKey(),
): { player: Player; reward: RunReward } | null {
  if (
    player.processedRuns.includes(run.id) ||
    !Number.isFinite(run.score) ||
    run.score < 0 ||
    !Number.isFinite(run.distance) ||
    run.distance < 0
  )
    return null;
  const p = refreshDaily(player, date);
  const xp = Math.max(
    10,
    Math.floor(run.distance / 9 + run.nearMisses * 8 + run.jumps * 3),
  );
  const coins = Math.max(
    4,
    Math.floor((run.distance / 22 + run.nearMisses * 3 + run.jumps * 2) * 0.75),
  );
  const values = { ...p.challenges.values };
  const metrics = {
    runs: 1,
    distance: run.distance,
    wheelie: run.wheelieMeters,
    nearMisses: run.nearMisses,
    score: run.score,
    jumps: run.jumps,
    // Sign progress and its one-time coin payout are saved at each pickup.
    signs: 0,
  };
  const challenges = dailyChallengesForDate(date);
  for (const c of challenges)
    values[c.id] = Math.min(c.target, (values[c.id] ?? 0) + metrics[c.stat]);
  const completed = challenges.filter(
    (c) => values[c.id] >= c.target && !p.challenges.claimed.includes(c.id),
  );
  const reward = {
    xp: xp + completed.reduce((a, c) => a + c.xp, 0),
    coins: coins + completed.reduce((a, c) => a + c.coins, 0),
    challengeIds: completed.map((c) => c.id),
    newRecord: run.score > p.highScore,
    previousLevel: p.level,
    level: p.level,
  };
  reward.level = levelForXp(p.xp + reward.xp);
  return {
    reward,
    player: {
      ...p,
      xp: p.xp + reward.xp,
      level: reward.level,
      coins: p.coins + reward.coins,
      highScore: Math.max(p.highScore, run.score),
      totalDistance: p.totalDistance + run.distance,
      runsPlayed: p.runsPlayed + 1,
      totalNearMisses: p.totalNearMisses + run.nearMisses,
      totalWheelieMeters: p.totalWheelieMeters + run.wheelieMeters,
      challenges: {
        date,
        values,
        claimed: [...p.challenges.claimed, ...reward.challengeIds],
      },
      processedRuns: [...p.processedRuns.slice(-99), run.id],
      history: [...p.history.slice(-199), { score: run.score, date }],
    },
  };
}
export function ownership(p: Player, product: Product, variantId = p.variants[product.id] ?? product.variants[0]?.id ?? ''): Ownership {
  if (!ownsProductColor(p, product, variantId)) return 'LOCKED';
  if (p.equipped[equipmentSlot(product)] === product.id &&
      (p.variants[product.id] ?? product.variants[0]?.id) === variantId) return 'EQUIPPED';
  if (ownsProductColor(p, product, variantId, p.irlItems)) return 'OWNED_IRL';
  return 'UNLOCKED_DIGITAL';
}
export const digitalPrice = (p: Product) =>
  p.category === 'cape' ? 5000 : p.category === 'upper' ? 150 : p.category === 'head' ? 90 : 75;
export const digitalLevel = (p: Product) => p.category === 'cape' ? 8 : 1;
export function unlock(
  p: Player,
  id: string,
  cost: number,
  level = 1,
): Player | null {
  if (p.ownedItems.includes(id) || p.irlItems.includes(id)) return p;
  if (!Number.isFinite(cost) || cost < 0 || p.coins < cost || p.level < level)
    return null;
  return { ...p, coins: p.coins - cost, ownedItems: [...p.ownedItems, id] };
}
