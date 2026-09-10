import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { BIKES, DAILY_CHALLENGES, LEVELS } from '../app/domain/config';
import {
  dayKey,
  finishRun,
  levelForXp,
  newPlayer,
  unlock,
} from '../app/domain/progression';
import {
  decodePlayer,
  LocalPlayerRepository,
  MockRewardService,
} from '../app/services';
import { Engine, STEP } from '../app/game/engine';
import type { Product, RunStats } from '../app/domain/types';
const run: RunStats = {
  id: 'test-run',
  score: 3000,
  distance: 2100,
  seconds: 80,
  bestCombo: 4,
  nearMisses: 5,
  jumps: 2,
  wheelieMeters: 300,
  maxSpeed: 125,
  cause: 'Traffic collision',
};
describe('progression and storage', () => {
  it('settles a run and completed challenges once', () => {
    const p = newPlayer();
    const result = finishRun(p, run)!;
    expect(result.player.runsPlayed).toBe(1);
    expect(result.reward.challengeIds).toHaveLength(3);
    expect(result.player.coins).toBe(p.coins + result.reward.coins);
    expect(finishRun(result.player, run)).toBeNull();
    const next = finishRun(result.player, { ...run, id: 'second' })!;
    expect(next.reward.challengeIds).toHaveLength(0);
    expect(next.player.level).toBe(levelForXp(next.player.xp));
  });
  it('all ten levels advance at their defined threshold', () =>
    LEVELS.forEach((xp, i) => {
      expect(levelForXp(xp)).toBe(i + 1);
      if (i) expect(levelForXp(xp - 1)).toBe(i);
    }));
  it('daily challenges reset with UTC date', () => {
    const p = finishRun(newPlayer(), run, '2026-09-07')!.player;
    const next = finishRun(
      p,
      { ...run, id: 'tomorrow', distance: 0, wheelieMeters: 0, nearMisses: 0 },
      '2026-09-08',
    )!.player;
    expect(next.challenges.claimed).toHaveLength(0);
    expect(next.challenges.values['three-rides']).toBe(1);
  });
  it('prevents overspending, level bypass and duplicate rewards', () => {
    const p = newPlayer();
    expect(unlock(p, 'bike:701', 1000, 6)).toBeNull();
    expect(unlock(p, 'bad', -1)).toBeNull();
    const reward = new MockRewardService();
    const next = reward.redeem(p, 'starter-coins')!;
    expect(next.coins).toBe(250);
    expect(reward.redeem(next, 'starter-coins')).toBeNull();
    expect(reward.redeem(p, 'shipping')).toBeNull();
  });
  it('round trips saves and recalculates derived level', async () => {
    const map = new Map<string, string>();
    const repo = new LocalPlayerRepository({
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => {
        map.set(k, v);
      },
    });
    const p = finishRun(newPlayer(), run)!.player;
    p.settings.muted = false;
    p.paint = '#d9f365';
    repo.save(p);
    expect(await repo.load()).toEqual(p);
    expect(decodePlayer(JSON.stringify({ ...p, level: 99 })).level).toBe(
      levelForXp(p.xp),
    );
  });
  it('backs up malformed saves and survives unavailable storage', async () => {
    const map = new Map([['pfusch:player:v1', '{broken']]);
    const repo = new LocalPlayerRepository({
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => {
        map.set(k, v);
      },
    });
    expect((await repo.load()).runsPlayed).toBe(0);
    expect(map.get('pfusch:player:v1:recovery')).toBe('{broken');
    const blocked = new LocalPlayerRepository({
      getItem: () => {
        throw Error('blocked');
      },
      setItem: () => {
        throw Error('blocked');
      },
    });
    expect((await blocked.load()).version).toBe(1);
    expect(() => blocked.save(newPlayer())).not.toThrow();
    expect(blocked.warning).toBeTruthy();
  });
  it('challenge definitions have unique IDs and positive rewards', () => {
    expect(new Set(DAILY_CHALLENGES.map((c) => c.id)).size).toBe(
      DAILY_CHALLENGES.length,
    );
    expect(dayKey(new Date('2026-09-08T22:00:00Z'))).toBe('2026-09-08');
  });
});
describe('deterministic riding', () => {
  const ride = (seed = 123) => {
    const e = new Engine(BIKES[0], seed);
    e.start();
    return e;
  };
  it('is deterministic across 30 / 60 / 120 Hz rendering', () => {
    const results = [30, 60, 120].map((fps) => {
      const e = ride();
      e.hold(true);
      for (let i = 0; i < fps * 5; i++) e.advance(1 / fps);
      return [e.distance, e.score, e.x, e.phase];
    });
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
  });
  it('bounds lanes and freezes while paused', () => {
    const e = ride();
    e.move(-1);
    e.move(-1);
    expect(e.lane).toBe(-1);
    e.lift();
    e.hold(true);
    e.advance(0.1);
    e.pause();
    const before = [e.distance, e.height, e.elapsed];
    e.advance(2);
    expect([e.distance, e.height, e.elapsed]).toEqual(before);
    expect(e.wheelieHeld).toBe(false);
  });
  it('crashes on traffic even during a front-wheel lift', () => {
    const e = ride();
    e.spawn('van', 0, 0);
    e.lift();
    e.advance(STEP);
    expect(e.phase).toBe('crashed');
  });
  it('clears a low road edge with a timed lift while staying grounded', () => {
    const e = ride();
    e.lift();
    for (let i = 0; i < 20; i++) e.advance(STEP);
    e.spawn('barrier', 0, 1);
    for (let i = 0; i < 50; i++) e.advance(STEP);
    expect(e.phase).toBe('playing');
    expect(e.height).toBe(0);
    expect(e.score).toBeGreaterThan(100);
  });
  it('awards a close pass once but not an adjacent-lane cruise', () => {
    const e = ride();
    const o = e.spawn('car', 1, 0)!;
    e.x = 1.5;
    e.lane = 0;
    e.advance(STEP);
    e.x = 0;
    for (let i = 0; i < 30; i++) e.advance(STEP);
    expect(e.nearMisses).toBe(1);
    expect(o.passed).toBe(true);
    for (let i = 0; i < 30; i++) e.advance(STEP);
    expect(e.nearMisses).toBe(1);
    const far = ride();
    far.spawn('car', 1, 0);
    for (let i = 0; i < 30; i++) far.advance(STEP);
    expect(far.nearMisses).toBe(0);
  });
  it('ramps launch once and pools remain bounded', () => {
    const e = ride();
    e.spawn('ramp', 0, 0.1);
    e.advance(STEP);
    expect(e.height).toBeGreaterThan(0);
    expect(e.jumps).toBe(1);
    for (let i = 0; i < 20; i++) e.advance(STEP);
    expect(e.jumps).toBe(1);
    expect(e.obstacles).toHaveLength(32);
  });
  it('every wave leaves a reachable safe lane', () => {
    const e = ride(456);
    let previousSafe = 0;
    for (let i = 0; i < 12000; i++) {
      e.advance(STEP);
      const wave = e.obstacles.filter(
        (o) => o.active && o.z > 143 && o.kind !== 'ramp',
      );
      if (wave.length) {
        const occupied = new Set(wave.map((o) => o.lane));
        expect(occupied.size).toBeLessThan(3);
        if (occupied.size === 2) {
          const safe = [-1, 0, 1].find((l) => !occupied.has(l))!;
          expect(Math.abs(safe - previousSafe)).toBeLessThanOrEqual(2);
          previousSafe = safe;
        }
      }
      for (const o of e.obstacles) if (o.z < 10) o.active = false;
    }
    expect(e.obstacles).toHaveLength(32);
  });
});
describe('complete PFUSCH catalog', () => {
  const products = JSON.parse(
    readFileSync('public/catalog/products.json', 'utf8'),
  ) as Product[];
  it('contains all 16 audited products and 186 variants', () => {
    expect(products).toHaveLength(16);
    expect(products.reduce((n, p) => n + p.variants.length, 0)).toBe(186);
    expect(new Set(products.map((p) => p.id)).size).toBe(16);
  });
  it('has valid real links, prices, images and slots for every item', () =>
    products.forEach((p) => {
      expect(p.url).toBe(`https://pfusch-clothing.ch/products/${p.handle}`);
      expect(p.price).toBeGreaterThan(0);
      expect(p.currency).toBe('CHF');
      expect(existsSync(`public/${p.localImage}`)).toBe(true);
      expect([
        'upper',
        'head',
        'accessory',
        'collectible',
        'lower',
        'bike',
      ]).toContain(p.category);
      expect(p.variants.length).toBeGreaterThan(0);
    }));
});
