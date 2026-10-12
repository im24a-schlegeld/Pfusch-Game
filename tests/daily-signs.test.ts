import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAILY_SIGN_CHALLENGE, DAILY_SIGN_EVENT_PREFIX, dailyChallengesForDate, dailySignLetterKey, normalizeDailyProgress } from '../app/domain/dailyChallenges';
import { dailySignMask, recordDailySign } from '../app/domain/dailySigns';
import { SIGN_IDS } from '../app/game/signCollectibles';
import { dayKey, finishRun, newPlayer, refreshDaily } from '../app/domain/progression';
import type { Player, RunStats } from '../app/domain/types';
import { decodePlayer } from '../app/services';
import { sanitizeDigitalPlayer } from '../server/shopify/playerValidation';

const date = '2026-10-10';
const fresh = () => refreshDaily(newPlayer(), date);
const events = (player: Player) => Object.keys(player.challenges.values).filter(key => key.startsWith(DAILY_SIGN_EVENT_PREFIX));
const run: RunStats = { id: 'sign-ride', score: 270, distance: 0, seconds: 10,
  bestCombo: 1, nearMisses: 0, jumps: 0, wheelieMeters: 0, maxSpeed: 40, cause: 'Traffic collision' };

describe('immediately saved UTC sign collection', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('adds the same six-sign task daily without changing the rotating four slots', () => {
    const before = dailyChallengesForDate('2026-10-09');
    const after = dailyChallengesForDate(date);
    expect(before[4]).toEqual(DAILY_SIGN_CHALLENGE);
    expect(after[4]).toEqual(DAILY_SIGN_CHALLENGE);
    expect(after.slice(0, 4).map(task => task.id)).toEqual(['daily-rides', 'daily-skill', 'daily-focus', 'daily-distance']);
    expect(after[4]).toMatchObject({ target: 6, coins: 120, xp: 0, stat: 'signs' });
  });

  it('counts each PFUSCH letter across rides and pays 120 coins at the sixth distinct letter, before settlement', () => {
    const initial = fresh();
    let player = initial;
    for (let index = 1; index <= 6; index++) {
      player = recordDailySign(player, `${index <= 3 ? 'first-ride' : 'second-ride'}:${index}`, SIGN_IDS[index - 1], date);
      expect(player.challenges.values['daily-signs']).toBe(index);
      expect(dailySignMask(player.challenges, date)).toBe((1 << index) - 1);
      expect(events(player)).toHaveLength(index);
      expect(player.coins).toBe(initial.coins + (index === 6 ? 120 : 0));
      expect(player.xp).toBe(initial.xp);
      expect(player.runsPlayed).toBe(initial.runsPlayed);
    }
    expect(player.challenges.claimed).toEqual(['daily-signs']);
    for (let serial = 1; serial <= 50; serial++)
      expect(recordDailySign(player, `later-ride:${serial}`, SIGN_IDS[serial % 6], date)).toBe(player);
    expect(events(player)).toHaveLength(6);
  });

  it('ignores repeated pickup delivery and safely distinguishes equal serials in different rides', () => {
    let player = recordDailySign(fresh(), 'first-ride:1', 'P', date);
    expect(recordDailySign(player, 'first-ride:1', 'P', date)).toBe(player);
    expect(recordDailySign(player, 'first-ride:1', 'F', date)).toBe(player);
    expect(recordDailySign(player, 'another-p:1', 'P', date)).toBe(player);
    player = recordDailySign(player, 'second-ride:1', 'F', date);
    expect(player.challenges.values['daily-signs']).toBe(2);
    for (const invalid of ['', 'missing-serial', 'run:-1', 'run:1.5', 'run:\n1', 'run:1\n', 'run:1\u2028', `${'a'.repeat(129)}:1`])
      expect(recordDailySign(player, invalid, 'U', date)).toBe(player);
    expect(events(player)).toHaveLength(2);
  });

  it('keeps marker keys, immediate coins and claims through local and Shopify backup round trips', () => {
    // Decoding intentionally discards an earlier UTC day's task progress.
    // Keep this persistence case on its fixture day regardless of execution date.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${date}T12:00:00Z`));
    let player = fresh();
    for (let serial = 1; serial <= 6; serial++) {
      const event = `930a2188-157c-4ce6-a337-7ac46ccf1503:${serial}`;
      player = recordDailySign(player, event, SIGN_IDS[serial - 1], date);
      const local = decodePlayer(JSON.stringify(player));
      const account = sanitizeDigitalPlayer(local, '123');
      expect(local.challenges).toEqual(player.challenges);
      expect(account.challenges).toEqual(player.challenges);
      expect(account.coins).toBe(player.coins);
      expect(account.version).toBe(1);
      expect(recordDailySign(account, event, SIGN_IDS[serial - 1], date)).toBe(account);
      player = account;
    }
    expect(player.coins).toBe(newPlayer().coins + 120);
    expect(player.challenges.claimed).toEqual(['daily-signs']);
  });

  it('starts a fresh collection at UTC midnight while keeping yesterday’s coin payout', () => {
    const before = dayKey(new Date('2026-10-11T01:59:59+02:00'));
    const after = dayKey(new Date('2026-10-11T02:00:00+02:00'));
    expect([before, after]).toEqual([date, '2026-10-11']);
    let player = fresh();
    for (let serial = 1; serial <= 6; serial++) player = recordDailySign(player, `ride:${serial}`, SIGN_IDS[serial - 1], before);
    const earned = player.coins;
    player = recordDailySign(player, 'new-day-ride:1', 'P', after);
    expect(player.challenges.values['daily-signs']).toBe(1);
    expect(player.challenges.claimed).toEqual([]);
    expect(events(player)).toEqual([`${DAILY_SIGN_EVENT_PREFIX}new-day-ride:1`]);
    expect(player.coins).toBe(earned);
    for (let serial = 2; serial <= 6; serial++) player = recordDailySign(player, `new-day-ride:${serial}`, SIGN_IDS[serial - 1], after);
    expect(player.coins).toBe(earned + 120);
  });

  it('never recounts live signs or repays their coins during run settlement and duplicate settlement', () => {
    let player = fresh();
    for (let serial = 1; serial <= 6; serial++) player = recordDailySign(player, `sign-ride:${serial}`, SIGN_IDS[serial - 1], date);
    const settled = finishRun(player, run, date)!;
    expect(settled.player.challenges.values['daily-signs']).toBe(6);
    expect(settled.player.challenges.claimed.filter(id => id === 'daily-signs')).toHaveLength(1);
    expect(settled.reward.challengeIds).not.toContain('daily-signs');
    expect(settled.reward.coins).toBe(4);
    expect(settled.reward.xp).toBe(10);
    expect(settled.player.coins).toBe(player.coins + 4);
    expect(finishRun(settled.player, run, date)).toBeNull();
    const partial = recordDailySign(fresh(), 'partial-ride:1', 'P', date);
    expect(finishRun(partial, { ...run, id: 'partial-ride' }, date)!.player.challenges.values['daily-signs']).toBe(1);
  });

  it('bounds additive v1 sign progress and preserves all four legacy claims without aliasing the fifth', () => {
    const values: Record<string, number> = { 'daily-signs': 2.5, undefined: 5 };
    for (const id of ['P', 'U', 'C'] as const) values[dailySignLetterKey(id)] = 1;
    for (let serial = 1; serial <= 9; serial++) values[`${DAILY_SIGN_EVENT_PREFIX}ride:${serial}`] = 1;
    values[`${DAILY_SIGN_EVENT_PREFIX}bad`] = 1;
    values[`${DAILY_SIGN_EVENT_PREFIX}fraction:1`] = 0.5;
    const progress = { date, values, claimed: ['three-rides', 'one-wheel', 'close-call', 'night-shift'] };
    const normalized = normalizeDailyProgress(progress, date);
    expect(normalized.values['daily-signs']).toBe(3);
    expect(dailySignMask(normalized, date)).toBe(21);
    expect(Object.keys(normalized.values).filter(key => key.startsWith(DAILY_SIGN_EVENT_PREFIX))).toHaveLength(6);
    expect(normalized.claimed).not.toContain('daily-signs');
    expect(normalized.values.undefined).toBe(5);
    expect(normalizeDailyProgress(normalized, date)).toBe(normalized);
    const legacy = normalizeDailyProgress({ date, values: { undefined: 6 }, claimed: ['three-rides', 'one-wheel', 'close-call', 'night-shift'] }, date);
    expect(legacy.values['daily-signs']).toBeUndefined();
    expect(legacy.claimed).not.toContain('daily-signs');
    const claimed = normalizeDailyProgress({ date, values: { 'daily-signs': NaN }, claimed: ['daily-signs'] }, date);
    expect(claimed.values['daily-signs']).toBe(6);
    expect(dailySignMask(claimed, date)).toBe(63);
    expect(normalizeDailyProgress({ date, values: { 'daily-signs': -1.5 }, claimed: [] }, date).values['daily-signs']).toBe(0);
  });

  it('explicitly migrates the old unlabelled counter without inventing letters or repaying claimed coins', () => {
    const partial = fresh();
    partial.challenges.values = { 'daily-signs': 4, 'daily-signs:event:old-run:1': 1 };
    const migrated = refreshDaily(partial, date);
    expect(migrated.challenges.values['daily-signs']).toBe(0);
    expect(dailySignMask(migrated.challenges, date)).toBe(0);
    expect(migrated.challenges.values['daily-signs:event:old-run:1']).toBeUndefined();
    expect(migrated.coins).toBe(partial.coins);
    const paid = { ...partial, coins: partial.coins + 120,
      challenges: { ...partial.challenges, claimed: ['daily-signs'] } };
    const complete = refreshDaily(paid, date);
    expect(dailySignMask(complete.challenges, date)).toBe(63);
    expect(recordDailySign(complete, 'later:1', 'P', date)).toBe(complete);
    expect(complete.coins).toBe(paid.coins);
  });

  it('reconstructs disjoint letter progress from canonical saved keys, rather than comparing numeric masks', () => {
    const progress = normalizeDailyProgress({ date,
      values: { [dailySignLetterKey('P')]: 1, [dailySignLetterKey('H')]: 1 }, claimed: [] }, date);
    expect(progress.values['daily-signs']).toBe(2);
    expect(dailySignMask(progress, date)).toBe(33);
    expect(dailySignMask(progress, '2026-10-11')).toBe(0);
    expect(normalizeDailyProgress(progress, date)).toBe(progress);
  });

  it('settles a recovered full letter set once even when neither partial snapshot had a claim', () => {
    let first = fresh(), second = fresh();
    for (const [index, id] of SIGN_IDS.entries()) {
      if (index < 3) first = recordDailySign(first, `device-one:${index + 1}`, id, date);
      else second = recordDailySign(second, `device-two:${index + 1}`, id, date);
    }
    const recovered = { ...first, challenges: { date,
      values: { ...first.challenges.values, ...second.challenges.values }, claimed: [] } };
    const completed = refreshDaily(recovered, date);
    expect(dailySignMask(completed.challenges, date)).toBe(63);
    expect(completed.challenges.claimed).toEqual(['daily-signs']);
    expect(completed.coins).toBe(first.coins + 120);
    expect(refreshDaily(completed, date)).toBe(completed);
    expect(recordDailySign(completed, 'later:1', 'P', date)).toBe(completed);
    const fromServer = sanitizeDigitalPlayer(recovered, '123');
    expect(fromServer.challenges).toEqual(completed.challenges);
    expect(fromServer.coins).toBe(completed.coins);
    expect(sanitizeDigitalPlayer(fromServer, '123').coins).toBe(completed.coins);
  });
});
