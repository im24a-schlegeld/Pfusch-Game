import { DAILY_CHALLENGES, LEVELS } from './config';
import { DEFAULT_HELMET, DEFAULT_HELMET_COLOR } from './helmet';
import { equipmentSlot } from './preview';
import type { Player, Product, RunReward, RunStats, Ownership } from './types';
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
    ownedItems: ['bike:125', 'paint:#e7e7df', 'rims:#a6acb0'],
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
    stickers: {},
    challenges: { date: dayKey(), values: {}, claimed: [] },
    redeemedRewards: [],
    processedRuns: [],
    settings: {
      muted: true,
      reducedMotion: false,
      quality: 'auto',
      tutorialSeen: false,
    },
    history: [],
  };
}
export function refreshDaily(p: Player, date = dayKey()): Player {
  return p.challenges.date === date
    ? p
    : { ...p, challenges: { date, values: {}, claimed: [] } };
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
    5,
    Math.floor(run.distance / 22 + run.nearMisses * 3 + run.jumps * 2),
  );
  const values = { ...p.challenges.values };
  const metrics = {
    runs: 1,
    distance: run.distance,
    wheelie: run.wheelieMeters,
    nearMisses: run.nearMisses,
    score: run.score,
    jumps: run.jumps,
  };
  for (const c of DAILY_CHALLENGES)
    values[c.id] = Math.min(c.target, (values[c.id] ?? 0) + metrics[c.stat]);
  const completed = DAILY_CHALLENGES.filter(
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
export function ownership(p: Player, product: Product): Ownership {
  if (p.equipped[equipmentSlot(product)] === product.id) return 'EQUIPPED';
  if (p.irlItems.includes(product.id)) return 'OWNED_IRL';
  return p.ownedItems.includes(product.id) ? 'UNLOCKED_DIGITAL' : 'LOCKED';
}
export const digitalPrice = (p: Product) =>
  p.category === 'upper' ? 150 : p.category === 'head' ? 90 : 75;
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
