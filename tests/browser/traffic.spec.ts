import { test, expect, type Page } from '@playwright/test';
import type * as THREE from 'three';
import { newPlayer } from '../../app/domain/progression';
import type { Engine } from '../../app/game/engine';

declare global {
  interface Window {
    trafficProbe: {
      scene?: THREE.Scene;
      engine?: Engine;
      camera?: THREE.PerspectiveCamera;
    };
  }
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function start(page: Page, low: boolean) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.clock.install({ time: new Date('2026-09-15T10:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-15T10:00:01Z'));
  const player = newPlayer();
  player.settings.tutorialSeen = true;
  player.settings.quality = low ? 'low' : 'auto';
  player.bike = '450';
  await page.addInitScript((saved) => {
    localStorage.setItem('pfusch:player:v1', JSON.stringify(saved));
    window.trafficProbe = {};
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', (event) => {
      const item = (event as CustomEvent).detail;
      if (!item.isWebGLRenderer) return;
      const render = item.render.bind(item);
      item.render = (scene: THREE.Scene, camera: THREE.Camera) => {
        render(scene, camera);
        if (scene.getObjectByName('streamed-world')) {
          window.trafficProbe.scene = scene;
          window.trafficProbe.camera = camera as THREE.PerspectiveCamera;
        }
      };
    });
  }, player);
  await page.goto('/');
  await page.getByRole('button', { name: 'LET’S RIDE', exact: true }).click();
  // A cold React lazy reveal needs the paused clock to advance. Keep this
  // bootstrap separate from short assertion predicates that can expire while
  // the first frame is compiling, even after the canvas has already mounted.
  const startupDeadline = Date.now() + 60000;
  while (
    (await page.locator('canvas').count()) === 0 &&
    Date.now() < startupDeadline
  )
    await page.clock.runFor(50);
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.clock.runFor(100);
  await page.clock.runFor(2200);
  await expect(page.getByTestId('ride-screen')).toHaveAttribute(
    'data-phase',
    'playing',
  );
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
        if (candidate?.world && typeof candidate.spawn === 'function') {
          window.trafficProbe.engine = candidate;
          return;
        }
      }
      fiber = fiber.return;
    }
    throw new Error('The mounted traffic engine was not found');
  });
  return errors;
}

for (const low of [false, true]) {
  test(`rendered moving tow ramp accepts a side transfer and resets after landing (${low ? 'low' : 'normal'})`, async ({
    page,
  }, testInfo) => {
    const errors = await start(page, low);
    await page.evaluate(() => {
      const engine = window.trafficProbe.engine!;
      engine.clearInput();
      engine.phase = 'ready';
      for (const obstacle of engine.obstacles) obstacle.active = false;
      engine.spawn('towtruck', 1, 15, 0, 6);
      engine.spawn('car', -1, 22);
      engine.spawn('van', 0, 35, 0, 6);
      engine.spawn('construction', -1, 45);
    });
    await page.clock.runFor(100);
    const models = await page.evaluate(() => {
      const scene = window.trafficProbe.scene!;
      return ['car', 'van', 'towtruck', 'construction'].map((kind) => {
        const model = scene.getObjectByName(`traffic-${kind}`)!;
        let meshes = 0;
        model.traverse((object) => {
          if ((object as THREE.Mesh).isMesh) meshes++;
        });
        return {
          kind,
          meshes,
          wheels: model.children.filter(
            (child) => child.name === 'traffic-wheel',
          ).length,
          shadow: !!model.getObjectByName('traffic-contact-shadow'),
        };
      });
    });
    expect(models.every((model) => model.shadow && model.meshes < 25)).toBe(
      true,
    );
    expect(models.map((model) => model.wheels)).toEqual([4, 4, 4, 0]);
    await page.screenshot({
      path: testInfo.outputPath('traffic-scale-and-ramp.png'),
    });

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      await page.clock.runFor(100);
      const edges = await page.evaluate(() => {
        const camera = window.trafficProbe.camera!;
        const Vector = camera.position.constructor as typeof THREE.Vector3;
        return [-4.5, 4.5].flatMap((x) =>
          [0, 1.5].map((z) => {
            const point = new Vector(x, 0, z).project(camera);
            return { x: point.x, y: point.y };
          }),
        );
      });
      expect(
        edges.every((point) => Math.abs(point.x) < 1 && Math.abs(point.y) < 1),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`all-lanes-${viewport.width}.png`),
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });

    await page.evaluate(() => {
      const engine = window.trafficProbe.engine!;
      for (const obstacle of engine.obstacles) obstacle.active = false;
      engine.elapsed = 25;
      engine.spawn('towtruck', 1, 10, 0, 6);
      engine.phase = 'playing';
    });
    const touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ id: 1, x: 160, y: 440 }],
    });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ id: 1, x: 218, y: 440 }],
    });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    // Drive bounded simulated time explicitly. expect.poll's wall-time backoff
    // otherwise permits only a handful of 17ms frames before its 5s deadline,
    // shorter than the deliberate grounded steering lead on a busy GPU host.
    const approach = [];
    for (let frame = 0; frame < 24; frame++) {
      await page.clock.runFor(17);
      const state = await page.evaluate(() => {
        const engine = window.trafficProbe.engine!;
        return {
          elapsed: engine.elapsed,
          x: engine.x,
          lane: engine.lane,
          phase: engine.phase,
          laneChangeAge: engine.laneChangeAge,
          launchSerial: engine.launchSerial,
          z: engine.obstacles.find((o) => o.active && o.kind === 'towtruck')?.z,
        };
      });
      approach.push(state);
      if (state.launchSerial > 0 || state.phase !== 'playing') break;
    }
    await testInfo.attach('tow-approach-steps', {
      body: JSON.stringify(approach, null, 2),
      contentType: 'application/json',
    });
    expect(approach.at(-1)?.launchSerial).toBe(1);
    const launch = await page.evaluate(() => {
      const engine = window.trafficProbe.engine!;
      const tow = engine.obstacles.find(
        (obstacle) => obstacle.active && obstacle.kind === 'towtruck',
      )!;
      const model =
        window.trafficProbe.scene!.getObjectByName('traffic-towtruck')!;
      const wheel = model.children.find(
        (child) => child.name === 'traffic-wheel',
      )!;
      return {
        phase: engine.phase,
        height: engine.height,
        rampUsed: tow.rampUsed,
        velocity: tow.velocity,
        wheelAngle: wheel.rotation.x,
        airUsed: engine.airLaneChangeUsed,
      };
    });
    expect(launch.phase).toBe('playing');
    expect(launch.height).toBeGreaterThan(0);
    expect(launch.rampUsed).toBe(true);
    expect(launch.airUsed).toBe(false);
    expect(launch.velocity).toBe(6);
    expect(Math.abs(launch.wheelAngle)).toBeGreaterThan(0.01);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect(
      await page.evaluate(() => [
        window.trafficProbe.engine!.lane,
        window.trafficProbe.engine!.airLaneChangeUsed,
      ]),
    ).toEqual([0, true]);
    await page.clock.runFor(200);
    await page.screenshot({
      path: testInfo.outputPath('tow-transfer-airborne.png'),
    });
    await page.clock.runFor(1500);
    const landing = await page.evaluate(() => {
      const engine = window.trafficProbe.engine!;
      return {
        phase: engine.phase,
        height: engine.height,
        jumps: engine.jumps,
        airUsed: engine.airLaneChangeUsed,
        event: engine.event.text,
        score: engine.score,
      };
    });
    expect(landing.phase).toBe('playing');
    expect(landing.height).toBe(0);
    expect(landing.jumps).toBe(1);
    expect(landing.airUsed).toBe(false);
    expect(landing.event).toBe('TOW TRUCK TRANSFER');
    expect(landing.score).toBeGreaterThan(500);
    await page.keyboard.press('ArrowLeft');
    expect(await page.evaluate(() => window.trafficProbe.engine!.lane)).toBe(
      -1,
    );
    await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => window.trafficProbe.engine!.lane)).toBe(0);
    expect(errors).toEqual([]);
  });
}
