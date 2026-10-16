import { describe, it, expect } from 'vitest';
import { finishRun, newPlayer } from '../app/domain/progression';
import type { RunStats } from '../app/domain/types';
import { assertPlausibleDigitalSave } from '../server/shopify/progressAntiCheat';

describe('conservative server-side digital progression sanity checks', () => {
  const run = (id: string, distance: number): RunStats => ({ id, distance, score: distance * 5,
    seconds: Math.ceil(distance / 35), bestCombo: 1, nearMisses: 0, jumps: 0,
    wheelieMeters: distance, maxSpeed: 140, cause: 'Ride ended' });

  it('accepts a long endless ride through the real settlement formula', () => {
    const previous = newPlayer();
    const next = finishRun(previous, run('legitimate-50km', 50_000))!.player;
    expect(() => assertPlausibleDigitalSave(previous, next)).not.toThrow();
    expect(() => assertPlausibleDigitalSave(null, next)).not.toThrow();
    const continued = finishRun(next, run('another-long-ride', 50_000))!.player;
    expect(() => assertPlausibleDigitalSave(next, continued)).not.toThrow();
  });

  it('accepts accumulated long offline rides on ordinary and first account sync', () => {
    const previous = newPlayer();
    const first = finishRun(previous, run('offline-one', 40_000))!.player;
    const next = finishRun(first, run('offline-two', 40_000))!.player;
    expect(() => assertPlausibleDigitalSave(previous, next)).not.toThrow();
    expect(() => assertPlausibleDigitalSave(null, next)).not.toThrow();
  });
  it('blocks enormous wallet or XP gains without additional recorded runs', () => {
    const previous = newPlayer();
    expect(() => assertPlausibleDigitalSave(previous, { ...previous, coins: 100_000_000 })).toThrow('implausible_game_progress');
    expect(() => assertPlausibleDigitalSave(previous, { ...previous, xp: 100_000_000 })).toThrow('implausible_game_progress');
  });
  it('blocks fabricated huge distances and high scores in an ordinary save', () => {
    const previous = newPlayer();
    expect(() => assertPlausibleDigitalSave(previous, { ...previous, totalDistance: 900_000_000 })).toThrow('implausible_game_progress');
    expect(() => assertPlausibleDigitalSave(previous, { ...previous, highScore: 900_000_000 })).toThrow('implausible_game_progress');
  });
  it('permits a normal ride and purchases, and safe first-time offline syncs', () => {
    const previous = newPlayer();
    const next = { ...previous, coins: 350, xp: 600, runsPlayed: 1, totalDistance: 3000, highScore: 15000 };
    expect(() => assertPlausibleDigitalSave(previous, next)).not.toThrow();
    expect(() => assertPlausibleDigitalSave(null, { ...next, coins: 1_000 })).not.toThrow();
    expect(() => assertPlausibleDigitalSave(null, { ...previous, coins: 100_000_000 })).toThrow('implausible_game_progress');
    expect(() => assertPlausibleDigitalSave(previous, { ...previous, coins: 0 })).not.toThrow();
  });
  it('permits legitimate server-admin modifications separately from the player API', () => {
    const previous = { ...newPlayer(), coins: 999_999 };
    expect(() => assertPlausibleDigitalSave(previous, { ...previous, coins: 999_000 })).not.toThrow();
  });
});
