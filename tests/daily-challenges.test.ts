import { describe, expect, it } from 'vitest';
import { dailyChallengesForDate, normalizeDailyProgress } from '../app/domain/dailyChallenges';
import { dayKey, finishRun, levelForXp, newPlayer, refreshDaily } from '../app/domain/progression';
import type { RunStats } from '../app/domain/types';
import { decodePlayer } from '../app/services';
import { sanitizeDigitalPlayer } from '../server/shopify/playerValidation';

const run: RunStats = { id: 'daily-run', score: 3000, distance: 1000, seconds: 45,
  bestCombo: 3, nearMisses: 4, jumps: 3, wheelieMeters: 250, maxSpeed: 120, cause: 'Traffic collision' };

describe('rotating UTC daily tasks and coin balance', () => {
  it('rotates six metrics alongside a fixed sign task and fair daily budgets', () => {
    const seen = new Set<string>();
    let previous = '';
    for (let index = 1; index <= 16; index++) {
      const date = `2026-10-${String(index).padStart(2, '0')}`;
      const tasks = dailyChallengesForDate(date);
      expect(tasks).toEqual(dailyChallengesForDate(date));
      expect(tasks).toHaveLength(5);
      expect(new Set(tasks.map(task => task.id)).size).toBe(5);
      expect(new Set(tasks.map(task => task.stat)).size).toBe(5);
      expect(tasks.reduce((sum, task) => sum + task.coins, 0)).toBe(420);
      expect(tasks.reduce((sum, task) => sum + task.xp, 0)).toBe(540);
      expect(JSON.stringify(tasks)).not.toBe(previous);
      previous = JSON.stringify(tasks);
      for (const task of tasks) {
        seen.add(task.stat);
        const ranges = { runs: [4, 5], distance: [3000, 4000], wheelie: [400, 500],
          nearMisses: [8, 10], jumps: [6, 8], score: [7000, 9000], signs: [6] };
        expect(ranges[task.stat]).toContain(task.target);
      }
    }
    expect([...seen].sort()).toEqual(['distance', 'jumps', 'nearMisses', 'runs', 'score', 'signs', 'wheelie']);
    expect(() => dailyChallengesForDate('2026-02-30')).toThrow();
  });

  it('reduces run coin income by about a quarter while preserving cumulative XP and the level calculation', () => {
    const player = newPlayer();
    player.challenges.claimed = dailyChallengesForDate(player.challenges.date).map(task => task.id);
    const outcome = finishRun(player, run)!;
    const oldCoins = Math.floor(run.distance / 22 + run.nearMisses * 3 + run.jumps * 2);
    expect(outcome.reward.coins).toBe(47);
    expect(outcome.reward.coins / oldCoins).toBeGreaterThanOrEqual(0.7);
    expect(outcome.reward.coins / oldCoins).toBeLessThanOrEqual(0.8);
    expect(outcome.reward.xp).toBe(Math.floor(run.distance / 9 + run.nearMisses * 8 + run.jumps * 3));
    expect(outcome.player.xp).toBe(player.xp + outcome.reward.xp);
    expect(outcome.player.level).toBe(levelForXp(outcome.player.xp));
    expect(finishRun(outcome.player, run)).toBeNull();
    expect(finishRun(player, { ...run, distance: 0, nearMisses: 0, jumps: 0 })!.reward.coins).toBe(4);
  });

  it('preserves legacy same-day claims without paying for their replacement slots again', () => {
    const player = newPlayer();
    player.challenges = { date: '2026-10-09',
      values: { 'three-rides': 3, 'one-wheel': 250, 'close-call': 5, 'night-shift': 2000 },
      claimed: ['three-rides', 'one-wheel', 'close-call', 'night-shift'] };
    const migrated = refreshDaily(player, player.challenges.date);
    expect(migrated.version).toBe(1);
    expect(migrated.coins).toBe(player.coins);
    expect(migrated.xp).toBe(player.xp);
    expect(migrated.challenges.claimed).toEqual(expect.arrayContaining(player.challenges.claimed));
    for (const task of dailyChallengesForDate(player.challenges.date).slice(0, 4)) {
      expect(migrated.challenges.claimed).toContain(task.id);
      expect(migrated.challenges.values[task.id]).toBe(task.target);
    }
    expect(migrated.challenges.claimed).not.toContain('daily-signs');
    expect(migrated.challenges.values['daily-signs']).toBeUndefined();
    expect(refreshDaily(migrated, player.challenges.date)).toBe(migrated);
    const outcome = finishRun(migrated, { ...run, score: 100000, distance: 10000, wheelieMeters: 1000, nearMisses: 30, jumps: 20 }, player.challenges.date)!;
    expect(outcome.reward.challengeIds).toEqual([]);
    expect(finishRun(outcome.player, { ...run, id: outcome.player.processedRuns[0] }, '2026-10-10')).toBeNull();
  });

  it('carries matching legacy progress without treating old wheelie metres as new jumps', () => {
    const progress = { date: '2026-10-09',
      values: { 'three-rides': 2, 'one-wheel': 200, 'close-call': 4, 'night-shift': 1100 }, claimed: [] };
    const migrated = normalizeDailyProgress(progress, progress.date);
    expect(dailyChallengesForDate(progress.date).map(task => task.stat)).toEqual(['runs', 'jumps', 'score', 'distance', 'signs']);
    expect(migrated.values).toMatchObject({ ...progress.values,
      'daily-rides': 2, 'daily-skill': 0, 'daily-focus': 0, 'daily-distance': 1100 });
    expect(migrated.claimed).toEqual([]);
    expect(normalizeDailyProgress(migrated, progress.date)).toBe(migrated);
  });

  it('rolls over at UTC midnight and does not carry yesterday’s progress or claims', () => {
    const before = dayKey(new Date('2026-10-08T01:59:59+02:00'));
    const after = dayKey(new Date('2026-10-08T02:00:00+02:00'));
    expect([before, after]).toEqual(['2026-10-07', '2026-10-08']);
    const player = newPlayer();
    player.challenges = { date: before, values: { 'daily-rides': 5 }, claimed: ['daily-rides'] };
    const reset = refreshDaily(player, after);
    expect(reset.challenges).toEqual({ date: after, values: {}, claimed: [] });
    const settled = finishRun(reset, run, after)!;
    expect(settled.player.challenges.values['daily-rides']).toBe(1);
    expect(settled.reward.challengeIds).toEqual([]);
  });

  it('keeps migrated daily slots and claims through local and account save round trips', () => {
    const player = newPlayer();
    player.challenges.values['three-rides'] = 3;
    player.challenges.claimed = ['three-rides'];
    const migrated = refreshDaily(player);
    expect(decodePlayer(JSON.stringify(migrated)).challenges).toEqual(migrated.challenges);
    expect(sanitizeDigitalPlayer(migrated, '123').challenges).toEqual(migrated.challenges);
  });
});
