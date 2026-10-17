import { describe, expect, it, vi } from 'vitest';
import { BIKES } from '../app/domain/config';
import { finishRun, newPlayer } from '../app/domain/progression';
import { Engine, STEP } from '../app/game/engine';
import { VerifiedRunRecorder, replayVerifiedRun } from '../app/game/verifiedRun';
import { RideCompletion, reserveBellRevive } from '../app/ui/rideCompletion';
import { ShareReviveGate } from '../app/services/shareRevive';

function naturalCrash(engine: Engine) {
  engine.hold(true);
  for (let frame = 0; frame < 3000 && engine.phase === 'playing'; frame++) engine.advance(STEP);
  expect(engine.phase).toBe('crashed');
}

describe('one continuation of the same run', () => {
  it('preserves accumulated progress, run ID and clocks; its shield only advances during play', () => {
    const engine = new Engine(BIKES[3], 42);
    engine.start();
    naturalCrash(engine);
    const before = engine.stats(), elapsed = engine.elapsed, ticks = engine.fixedTicks;
    const score = engine.score, distance = engine.distance;
    const near = engine.spawn('car', 0, 15, 0, -14)!;
    const far = engine.spawn('car', 1, 145)!;
    engine.collectedSigns = 3;
    expect(engine.revive()).toBe(true);
    expect(engine.stats().id).toBe(before.id);
    expect([engine.elapsed, engine.fixedTicks, engine.score, engine.distance]).toEqual([elapsed, ticks, score, distance]);
    expect(engine.collectedSigns).toBe(3);
    expect(near.active).toBe(false);
    expect(far.active).toBe(true);
    expect([engine.x, engine.height, engine.wheelieAngle]).toEqual([0, 0, 0]);
    expect(engine.reviveCount).toBe(1);
    expect(engine.revive()).toBe(false);
    engine.pause(); engine.advance(100);
    expect(engine.reviveProtection).toBe(1.5);
    expect(engine.fixedTicks).toBe(ticks);
    engine.resumeTutorial();
    engine.crash();
    expect(engine.phase).toBe('playing');
    for (let frame = 0; frame < 91; frame++) engine.advance(STEP);
    expect(engine.reviveProtection).toBe(0);
    expect(engine.elapsed).toBeCloseTo(elapsed + 91 * STEP, 8);
    expect(engine.score).toBeGreaterThan(score);
    engine.crash();
    expect(engine.phase).toBe('crashed');
    expect(engine.revive()).toBe(false);
    expect(engine.stats().id).toBe(before.id);
  });

  it.each(BIKES)('replays $name exactly across crash, revive, pause and final settlement', bike => {
    const engine = new Engine(bike, 42);
    const recorder = new VerifiedRunRecorder(engine);
    engine.start();
    naturalCrash(engine);
    const firstScore = engine.score;
    expect(engine.revive()).toBe(true);
    engine.pause(); engine.advance(30); engine.resumeTutorial();
    for (let frame = 0; frame < 100; frame++) engine.advance(frame % 2 ? STEP * 1.5 : STEP / 2);
    engine.endRide();
    expect(engine.score).toBeGreaterThan(firstScore);
    expect(engine.canRevive).toBe(false);
    const proof = recorder.proof()!;
    expect(proof.events.filter(event => event.input.type === 'revive')).toHaveLength(1);
    expect(replayVerifiedRun(bike.id, 42, proof)).toEqual({ score: engine.stats().score, ticks: engine.fixedTicks, crashed: true });
    const index = proof.events.findIndex(event => event.input.type === 'revive');
    const extra = [...proof.events];
    extra.splice(index + 1, 0, extra[index]);
    expect(replayVerifiedRun(bike.id, 42, { ...proof, events: extra })).toBeNull();
  });

  it('rejects continuations before a crash, after a voluntary end and malformed commands', () => {
    const replay = (events: unknown[]) => replayVerifiedRun('125', 42, { ticks: 0, events });
    expect(replay([{ tick: 0, input: { type: 'revive' } }])).toBeNull();
    expect(replay([{ tick: 0, input: { type: 'end' } }, { tick: 0, input: { type: 'revive' } }])).toBeNull();
    expect(replay([{ tick: 0, input: { type: 'revive', value: 1 } }])).toBeNull();
    const engine = new Engine(BIKES[0]);
    engine.start(); engine.endRide();
    expect(engine.revive()).toBe(false);
  });

  it('does not pay the first crash; settles exactly once after the final crash', () => {
    const engine = new Engine(BIKES[0], 42);
    const completion = new RideCompletion(engine, true);
    let player = newPlayer();
    const initial = player;
    const finish = vi.fn((run: ReturnType<Engine['stats']>) => { player = finishRun(player, run)!.player; });
    const reveal = vi.fn();
    engine.start(); naturalCrash(engine);
    const firstScore = engine.score, runId = engine.stats().id;
    expect(completion.offersRevive).toBe(true);
    completion.settle(finish); completion.reveal(reveal);
    expect(finish).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
    expect(player).toBe(initial);
    expect(completion.revive()).toBe(true);
    naturalCrash(engine);
    expect(completion.offersRevive).toBe(false);
    completion.settle(finish); completion.settle(finish);
    completion.reveal(reveal); completion.reveal(reveal);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenCalledWith(runId);
    expect(player.runsPlayed).toBe(1);
    expect(player.processedRuns).toEqual([runId]);
    expect(completion.run!.score).toBeGreaterThan(firstScore);
    expect(finishRun(player, completion.run!)).toBeNull();
  });

  it('offers a Bell-only continuation without native sharing and keeps a reserved Bell valid through its animation', () => {
    const engine = new Engine(BIKES[0], 42);
    let balance = 0, reserved = false;
    const completion = new RideCompletion(engine, () => balance > 0 || reserved);
    const finish = vi.fn();
    engine.start(); naturalCrash(engine);
    const runId = engine.stats().id;
    expect(completion.offersRevive).toBe(false);
    balance = 1;
    expect(completion.offersRevive).toBe(true);
    reserved = true; balance = 0;
    completion.settle(finish);
    expect(finish).not.toHaveBeenCalled();
    expect(completion.revive()).toBe(true);
    reserved = false;
    expect(engine.stats().id).toBe(runId);
    naturalCrash(engine);
    expect(completion.offersRevive).toBe(false);
    completion.settle(finish); completion.settle(finish);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(engine.reviveCount).toBe(1);
  });

  it('charges a visual Bell reservation only when its original owner and crash are still current', () => {
    const engine = new Engine(BIKES[0], 42), completion = new RideCompletion(engine, true);
    engine.start(); naturalCrash(engine);
    const runId = engine.stats().id, pay = vi.fn(() => true);
    const changedOwner = reserveBellRevive(completion, 'shopify:123', runId);
    expect(changedOwner.redeem(completion, 'shopify:456', pay)).toBe(false);
    expect(pay).not.toHaveBeenCalled();
    const abandoned = reserveBellRevive(completion, 'shopify:123', runId);
    abandoned.cancel();
    expect(abandoned.redeem(completion, 'shopify:123', pay)).toBe(false);
    const changedRound = reserveBellRevive(completion, 'shopify:123', runId);
    expect(changedRound.redeem(new RideCompletion(new Engine(BIKES[1], 43), true), 'shopify:123', pay)).toBe(false);
    expect(pay).not.toHaveBeenCalled();
    const active = reserveBellRevive(completion, 'shopify:123', runId);
    expect(active.redeem(completion, 'shopify:123', pay)).toBe(true);
    expect(pay).toHaveBeenCalledExactlyOnceWith(runId);
    expect(engine.reviveCount).toBe(1);
    expect(engine.stats().id).toBe(runId);
    expect(active.redeem(completion, 'shopify:123', pay)).toBe(false);
    expect(pay).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed payment retryable but never charges an already settled crash', () => {
    const engine = new Engine(BIKES[0], 42), completion = new RideCompletion(engine, true);
    engine.start(); naturalCrash(engine);
    const runId = engine.stats().id;
    expect(reserveBellRevive(completion, 'owner', runId).redeem(completion, 'owner', () => false)).toBe(false);
    expect(completion.offersRevive).toBe(true);
    const throwing = reserveBellRevive(completion, 'owner', runId);
    expect(() => throwing.redeem(completion, 'owner', () => { throw new Error('save failed'); })).toThrow('save failed');
    expect(completion.offersRevive).toBe(true);
    const settled = reserveBellRevive(completion, 'owner', runId), pay = vi.fn(() => true);
    completion.settle(vi.fn(), true);
    expect(settled.redeem(completion, 'owner', pay)).toBe(false);
    expect(pay).not.toHaveBeenCalled();
  });

  it.each([false, true])('settles a declined/unavailable continuation without granting an extra run: native=%s', native => {
    const engine = new Engine(BIKES[0], 42), completion = new RideCompletion(engine, native);
    engine.start(); naturalCrash(engine);
    const finish = vi.fn();
    completion.settle(finish, true);
    completion.settle(finish, true);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(completion.revive()).toBe(false);
  });
});

describe('native invitation continuation gate', () => {
  const content = { kind: 'invite' as const, name: '' };
  it('accepts one completed native share and blocks parallel or repeated claims', async () => {
    const gate = new ShareReviveGate();
    let resolveShare!: () => void;
    const platform = { share: () => new Promise<void>(resolve => { resolveShare = resolve; }) };
    const pending = gate.request(content, platform);
    expect(await gate.request(content, platform)).toBe('unavailable');
    resolveShare();
    expect(await pending).toBe('ready');
    expect(await gate.request(content, platform)).toBe('unavailable');
  });
  it('keeps a cancelled share retryable without reviving or opening a fallback', async () => {
    const engine = new Engine(BIKES[0], 42), completion = new RideCompletion(engine, true);
    engine.start(); naturalCrash(engine);
    const gate = new ShareReviveGate(), open = vi.fn(() => true);
    const result = await gate.request(content, { share: async () => { throw new DOMException('Dismissed', 'AbortError'); }, open });
    if (result === 'ready') completion.revive();
    expect(result).toBe('cancelled');
    expect(engine.phase).toBe('crashed');
    expect(engine.reviveCount).toBe(0);
    expect(completion.offersRevive).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(await gate.request(content, { share: async () => {} })).toBe('ready');
  });
  it('opens unsupported-browser WhatsApp drafts without granting a continuation', async () => {
    const engine = new Engine(BIKES[0], 42), completion = new RideCompletion(engine, true);
    engine.start(); naturalCrash(engine);
    const gate = new ShareReviveGate();
    let draft = '';
    const result = await gate.request(content, { open: url => { draft = url; return true; } });
    if (result === 'ready') completion.revive();
    expect(new URL(draft).origin).toBe('https://wa.me');
    expect(result).toBe('unconfirmed');
    expect(engine.phase).toBe('crashed');
    expect(engine.reviveCount).toBe(0);
    expect(await gate.request(content, { share: async () => {} })).toBe('ready');
  });
  it('rejects failed shares, blocked drafts and copy-only platforms without consuming the attempt', async () => {
    const gate = new ShareReviveGate();
    expect(await gate.request(content, { share: async () => { throw new Error('blocked'); } })).toBe('failed');
    expect(await gate.request(content, { open: () => false })).toBe('failed');
    const writeText = vi.fn();
    const copyOnly = { clipboard: { writeText }, open: undefined };
    expect(await gate.request(content, copyOnly)).toBe('unavailable');
    expect(writeText).not.toHaveBeenCalled();
    expect(await gate.request(content, { share: async () => {} })).toBe('ready');
  });
  it('cannot resume after the player finishes before native sharing settles', async () => {
    const gate = new ShareReviveGate();
    let resolveShare!: () => void;
    const pending = gate.request(content, { share: () => new Promise<void>(resolve => { resolveShare = resolve; }) });
    gate.close(); resolveShare();
    expect(await pending).toBe('cancelled');
    expect(await gate.request(content, { share: async () => {} })).toBe('unavailable');
  });
});
