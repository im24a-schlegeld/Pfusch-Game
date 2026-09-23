import { expect, test, type Page } from '@playwright/test';
import type * as THREE from 'three';
import type { Player } from '../../app/domain/types';
import type { Engine, Obstacle } from '../../app/game/engine';

interface RideFrame {
  time: number;
  phase: Engine['phase'];
  x: number;
  height: number;
  velocityY: number;
  lane: number;
  onTow: boolean;
  launches: number;
  landings: number;
  jumps: number;
  root: number[];
  helmet: number[];
  hip: number[];
  forkScale: number;
  rearAngle: number;
  carZ?: number;
  carCleared?: boolean;
  carPassed?: boolean;
  gains: { serial: number; text: string; points: number }[];
}
declare global {
  interface Window {
    refinementProbe: {
      scene?: THREE.Scene;
      camera?: THREE.Camera;
      engine?: Engine;
      car?: Obstacle;
      frames: RideFrame[];
    };
  }
}

test.use({ viewport: { width: 1280, height: 800 } });

async function start(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-09-23T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-23T12:00:01Z'));
  await page.addInitScript(() => {
    window.refinementProbe = { frames: [] };
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', (event) => {
      const renderer = (event as CustomEvent).detail as THREE.WebGLRenderer & {
        isWebGLRenderer?: boolean;
      };
      if (!renderer.isWebGLRenderer) return;
      const render = renderer.render.bind(renderer);
      renderer.render = (scene, camera) => {
        render(scene, camera);
        if (!scene.getObjectByName('streamed-world')) return;
        const probe = window.refinementProbe;
        probe.scene = scene as THREE.Scene;
        probe.camera = camera;
        const engine = probe.engine;
        const helmet = scene.getObjectByName('full-face-helmet');
        const torso = scene.getObjectByName('tailored-garment')?.parent;
        if (!engine || !helmet || !torso || probe.frames.length >= 600) return;
        let root: THREE.Object3D = helmet;
        while (root.parent && root.parent !== scene) root = root.parent;
        const vector = helmet.position.clone();
        probe.frames.push({
          time: engine.elapsed,
          phase: engine.phase,
          x: engine.x,
          height: engine.height,
          velocityY: engine.velocityY,
          lane: engine.lane,
          onTow: engine.onTowTruck,
          launches: engine.launchSerial,
          landings: engine.landingSerial,
          jumps: engine.jumps,
          root: root.getWorldPosition(vector).toArray(),
          helmet: helmet.getWorldPosition(vector).toArray(),
          hip: torso.getWorldPosition(vector).toArray(),
          forkScale: scene.getObjectByName('telescopic-fork-slider')!.scale.y,
          rearAngle: scene.getObjectByName('rear-suspension-axle')!.rotation.x,
          carZ: probe.car?.z,
          carCleared: probe.car?.cleared,
          carPassed: probe.car?.passed,
          gains: engine.scoreGains.map(({ serial, text, points }) => ({
            serial,
            text,
            points,
          })),
        });
      };
    });
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const modulePath = '/app/domain/progression.ts';
    const { newPlayer } = (await import(/* @vite-ignore */ modulePath)) as {
      newPlayer: () => Player;
    };
    const player = newPlayer();
    player.bike = '450';
    player.helmet = 'fullface';
    player.settings.tutorialSeen = true;
    player.settings.muted = true;
    localStorage.setItem('pfusch:player:v1', JSON.stringify(player));
  });
  await page.reload();
  await page.getByRole('button', { name: 'LOSFAHREN', exact: true }).click();
  await expect
    .poll(
      async () => {
        await page.clock.runFor(100);
        return page.locator('.scene-ride canvas').count();
      },
      { timeout: 60000 },
    )
    .toBe(1);
  await expect
    .poll(
      async () => {
        await page.clock.fastForward(700);
        await page.clock.runFor(16);
        return page.getByTestId('ride-screen').getAttribute('data-phase');
      },
      { timeout: 60000 },
    )
    .toBe('playing');
  await page.evaluate(() => {
    type Hook = { memoizedState: unknown; next: Hook | null };
    type Fiber = { memoizedState: Hook | null; return: Fiber | null };
    const element = document.querySelector(
      '[data-testid="ride-screen"]',
    )! as unknown as Record<string, unknown>;
    let fiber = element[
      Object.keys(element).find((key) => key.startsWith('__reactFiber$'))!
    ] as Fiber | null;
    while (fiber) {
      for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const candidate = Array.isArray(hook.memoizedState)
          ? (hook.memoizedState[0] as Engine)
          : undefined;
        if (candidate?.world && typeof candidate.advance === 'function') {
          window.refinementProbe.engine = candidate;
          candidate.clearInput();
          candidate.obstacles.forEach((obstacle) => {
            obstacle.active = false;
          });
          candidate.signs.forEach((sign) => {
            sign.active = false;
          });
          return;
        }
      }
      fiber = fiber.return;
    }
    throw new Error('Mounted production ride engine not found');
  });
  return errors;
}

const state = (page: Page) =>
  page.evaluate(() => {
    const engine = window.refinementProbe.engine!;
    return {
      phase: engine.phase,
      onTow: engine.onTowTruck,
      launches: engine.launchSerial,
      landings: engine.landingSerial,
      height: engine.height,
      lane: engine.lane,
      x: engine.x,
      jumps: engine.jumps,
      elapsed: engine.elapsed,
    };
  });
const save = (page: Page) =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem('pfusch:player:v1')!) as Player,
  );

test('an early side input queues a clean jump over the adjacent moving car and pays once', async ({
  page,
}, info) => {
  const errors = await start(page);
  await page.evaluate(async () => {
    const modulePath = '/app/game/world.ts';
    const { speedAtTime } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import('../../app/game/world');
    const probe = window.refinementProbe;
    const engine = probe.engine!;
    engine.elapsed = 25;
    engine.speed = speedAtTime(25, engine.bike);
    const velocity = engine.speed - 12;
    engine.spawn('towtruck', 0, 14, 0, velocity);
    probe.car = engine.spawn('car', 1, 14, 0, velocity)!;
    probe.frames.length = 0;
  });
  for (let step = 0; step < 90; step++) {
    if ((await state(page)).onTow) break;
    await page.clock.runFor(17);
  }
  const boarded = await state(page);
  expect(boarded.phase).toBe('playing');
  expect(boarded.onTow).toBe(true);
  expect(boarded.height).toBeLessThan(1.02);
  expect(boarded.launches).toBe(0);
  await page.screenshot({
    path: info.outputPath('paired-car-ramp-before-jump.png'),
  });
  // Real keyboard input reaches the same move(1) path as an outward swipe.
  await page.keyboard.press('ArrowRight');
  const queued = await state(page);
  expect(queued.onTow).toBe(true);
  expect(queued.lane).toBe(0);
  expect(queued.launches).toBe(0);
  for (let step = 0; step < 60; step++) {
    if ((await state(page)).launches === 1) break;
    await page.clock.runFor(33);
  }
  const launched = await state(page);
  expect(launched.phase).toBe('playing');
  expect(launched.launches).toBe(1);
  expect(launched.lane).toBe(1);
  expect(launched.onTow).toBe(false);
  await page.clock.runFor(350);
  const apex = await state(page);
  expect(apex.height).toBeGreaterThan(2);
  expect(apex.height).toBeLessThan(2.32);
  await page.screenshot({ path: info.outputPath('paired-car-jump-apex.png') });
  await page.clock.runFor(700);
  const landed = await state(page);
  expect(landed.phase).toBe('playing');
  expect(landed.height).toBe(0);
  expect(landed.lane).toBe(1);
  expect(landed.x).toBeCloseTo(2.8, 5);
  expect(landed.jumps).toBe(1);
  expect(landed.landings).toBe(1);
  await page.screenshot({
    path: info.outputPath('paired-car-jump-landed.png'),
  });
  const trace = await page.evaluate(() => window.refinementProbe.frames);
  const airborne = trace.filter(
    (frame) => frame.launches === 1 && frame.height > 0,
  );
  expect(airborne.length).toBeGreaterThan(10);
  expect(Math.max(...airborne.map((frame) => frame.height))).toBeLessThan(2.32);
  for (let i = 1; i < airborne.length; i++) {
    expect(airborne[i].x).toBeGreaterThanOrEqual(airborne[i - 1].x - 1e-8);
    expect(airborne[i].x).toBeLessThanOrEqual(2.8);
    expect(airborne[i].root[0]).toBeCloseTo(airborne[i].x, 6);
    expect(airborne[i].root[2]).toBeCloseTo(0, 6);
  }
  const overCar = airborne.filter(
    (frame) =>
      frame.carZ !== undefined &&
      frame.carZ < 3.9 &&
      frame.carZ > -3.9 &&
      Math.abs(frame.x - 2.8) < 1.475,
  );
  expect(overCar.length).toBeGreaterThan(0);
  for (const frame of overCar)
    expect(frame.height).toBeGreaterThanOrEqual(1.98);
  const rewards = new Map(
    trace
      .flatMap((frame) => frame.gains)
      .filter((gain) => gain.text === 'AUTO ÜBERSPRUNGEN')
      .map((gain) => [gain.serial, gain.points]),
  );
  expect([...rewards.values()]).toEqual([700]);
  expect(trace.some((frame) => frame.carCleared && frame.carPassed)).toBe(true);
  const suspensionLanding = trace.filter((frame) => frame.landings === 1);
  expect(Math.max(...airborne.map((frame) => frame.forkScale))).toBeGreaterThan(1.01);
  expect(Math.min(...suspensionLanding.map((frame) => frame.forkScale))).toBeLessThan(0.96);
  expect(Math.min(...suspensionLanding.map((frame) => frame.rearAngle))).toBeLessThan(-0.05);
  expect(suspensionLanding.at(-1)!.forkScale).toBeGreaterThan(Math.min(...suspensionLanding.map((frame) => frame.forkScale)) + 0.01);
  await info.attach('rendered jump trajectory', {
    body: JSON.stringify(trace, null, 2),
    contentType: 'application/json',
  });
  await page.clock.runFor(250);
  expect((await state(page)).jumps).toBe(1);
  expect((await state(page)).landings).toBe(1);
  await page.getByRole('button', { name: 'Fahrt pausieren' }).click();
  await page
    .getByRole('button', { name: 'FAHRT BEENDEN', exact: true })
    .click();
  await page.clock.runFor(100);
  await expect(
    page.getByRole('button', { name: 'NOCHMAL FAHREN', exact: true }),
  ).toBeVisible();
  const settled = await save(page);
  expect(settled.runsPlayed).toBe(1);
  expect(settled.processedRuns).toHaveLength(1);
  expect(settled.history).toHaveLength(1);
  expect(settled.history[0].score).toBeGreaterThanOrEqual(1050);
  await page.clock.runFor(500);
  expect(await save(page)).toEqual(settled);
  expect(errors).toEqual([]);
});

test('a construction collision falls into contact without launching the rider skyward', async ({
  page,
}, info) => {
  const errors = await start(page);
  await page.evaluate(() => {
    const probe = window.refinementProbe;
    probe.engine!.elapsed = 25;
    probe.engine!.spawn('construction', 0, 6);
    probe.frames.length = 0;
  });
  await page.clock.runFor(17);
  const before = await page.evaluate(() => window.refinementProbe.frames[0]);
  expect(before).toBeTruthy();
  for (let step = 0; step < 60; step++) {
    if ((await state(page)).phase === 'crashed') break;
    await page.clock.runFor(17);
  }
  expect((await state(page)).phase).toBe('crashed');
  expect(
    await page.evaluate(
      () => window.refinementProbe.engine!.crashObstacle?.kind,
    ),
  ).toBe('construction');
  await page.clock.runFor(350);
  await page.screenshot({
    path: info.outputPath('construction-contact-mid-fall.png'),
  });
  const settled = await save(page);
  expect(settled.runsPlayed).toBe(1);
  await page.clock.runFor(500);
  await page.screenshot({
    path: info.outputPath('construction-contact-near-ground.png'),
  });
  const trace = await page.evaluate(() => window.refinementProbe.frames);
  const fall = trace.filter((frame) => frame.phase === 'crashed');
  expect(fall.length).toBeGreaterThan(20);
  for (const frame of fall) {
    expect(frame.helmet.every(Number.isFinite)).toBe(true);
    expect(frame.hip.every(Number.isFinite)).toBe(true);
    expect(frame.helmet[1]).toBeLessThan(before.helmet[1] + 0.6);
    expect(frame.hip[1]).toBeLessThan(before.hip[1] + 0.6);
  }
  expect(fall.at(-1)!.helmet[1]).toBeLessThan(before.helmet[1]);
  await info.attach('rendered construction contact trajectory', {
    body: JSON.stringify(trace, null, 2),
    contentType: 'application/json',
  });
  await page.clock.runFor(500);
  await expect(
    page.getByRole('button', { name: 'NOCHMAL FAHREN', exact: true }),
  ).toBeVisible();
  expect(await save(page)).toEqual(settled);
  expect(errors).toEqual([]);
});
