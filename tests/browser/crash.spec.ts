import { test, expect, type Page, type TestInfo } from '@playwright/test';
import type * as THREE from 'three';
import { newPlayer } from '../../app/domain/progression';
import type { Player } from '../../app/domain/types';

declare global {
  interface Window {
    crashProbe: {
      scenes: THREE.Scene[];
      renderCounts: Record<number, number>;
      currentScene?: THREE.Scene;
    };
  }
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function install(page: Page, reducedMotion = false, tutorialSeen = true) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-09-15T10:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-15T10:00:01Z'));
  const player = newPlayer();
  player.helmet = 'fullface';
  player.settings.tutorialSeen = tutorialSeen;
  player.settings.reducedMotion = reducedMotion;
  await page.addInitScript((saved: Player) => {
    Math.random = () => 5489 / 0xffffffff;
    if (!localStorage.getItem('pfusch:player:v1'))
      localStorage.setItem('pfusch:player:v1', JSON.stringify(saved));
    window.crashProbe = { scenes: [], renderCounts: {} };
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', (event) => {
      const item = (event as CustomEvent).detail;
      if (item.isScene) window.crashProbe.scenes.push(item);
      if (item.isWebGLRenderer) {
        const render = item.render.bind(item);
        item.render = (scene: THREE.Scene, camera: THREE.Camera) => {
          // Observe the production render and camera; do not change either.
          render(scene, camera);
          if (!scene.getObjectByName('road-headlight')) return;
          const probe = window.crashProbe;
          probe.currentScene = scene;
          // Object3D ids remain unique when the seeded Math.random fixture
          // deliberately makes UUID strings identical across scene rebuilds.
          probe.renderCounts[scene.id] =
            (probe.renderCounts[scene.id] ?? 0) + 1;
        };
      }
    });
  }, player);
  return errors;
}

async function waitForPlaying(page: Page) {
  // React's lazy scene reveal and the countdown both use the paused test clock.
  await expect
    .poll(
      async () => {
        await page.clock.runFor(100);
        return page.locator('canvas').count();
      },
      { timeout: 20000 },
    )
    .toBe(1);
  await page.clock.runFor(2200);
  await expect(page.getByTestId('ride-screen')).toHaveAttribute(
    'data-phase',
    'playing',
  );
}

async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'LET’S RIDE', exact: true }).click();
  const tutorial = page.getByRole('button', {
    name: 'GOT IT. LET’S RIDE',
    exact: true,
  });
  await expect(page.getByTestId('ride-screen').or(tutorial)).toBeVisible();
  if (await tutorial.isVisible()) await tutorial.click();
  await waitForPlaying(page);
}

async function naturalCrash(page: Page) {
  const ride = page.getByTestId('ride-screen');
  await page.keyboard.down('s');
  // Hold the real control until the deterministic simulation crashes. Small
  // steps preserve the beginning of the fall, including reduced motion's hold.
  for (let step = 0; step < 500; step++) {
    if ((await ride.getAttribute('data-phase')) === 'crashed') break;
    await page.clock.runFor(32);
  }
  await page.keyboard.up('s');
  await expect(ride).toHaveAttribute('data-phase', 'crashed');
  await expect(
    page.getByRole('button', { name: 'RIDE AGAIN', exact: true }),
  ).not.toBeVisible();
}

function readSave(page: Page) {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem('pfusch:player:v1')!) as Player,
  );
}

function pose(page: Page) {
  return page.evaluate(() => {
    const scene = window.crashProbe.currentScene!;
    const helmet = scene.getObjectByName('full-face-helmet')!;
    let root: THREE.Object3D = helmet;
    while (root.parent && root.parent !== scene) root = root.parent;
    const body = root.children.find((child) =>
      child.getObjectByName('full-face-helmet'),
    )!;
    const light = scene.getObjectByName('road-headlight') as THREE.SpotLight;
    // The default Töffli's visible front lens face in its raw chassis frame.
    // Comparing after the rendered crash pose catches a light copied too early.
    const source = body.localToWorld(
      body.position.clone().set(0, 0.967, -0.604),
    );
    const target = body.localToWorld(
      body.position.clone().set(0, 0.967 - (20 * 1.22) / 23, -20.604),
    );
    return {
      scene: scene.id,
      root: {
        position: root.position.toArray(),
        quaternion: root.quaternion.toArray(),
        roll: root.rotation.z,
      },
      body: body.matrixWorld.elements.slice(),
      helmet: helmet.getWorldPosition(helmet.position.clone()).toArray(),
      beam: {
        source: light.position.toArray(),
        target: light.target.position.toArray(),
        expectedSource: source.toArray(),
        expectedTarget: target.toArray(),
      },
      headlights: scene.children.filter(
        (item) => (item as THREE.SpotLight).isSpotLight,
      ).length,
    };
  });
}

function expectAttached(snapshot: Awaited<ReturnType<typeof pose>>) {
  snapshot.beam.source.forEach((value, index) =>
    expect(value).toBeCloseTo(snapshot.beam.expectedSource[index], 6),
  );
  snapshot.beam.target.forEach((value, index) =>
    expect(value).toBeCloseTo(snapshot.beam.expectedTarget[index], 6),
  );
  expect(snapshot.headlights).toBe(2);
}

async function capture(page: Page, testInfo: TestInfo, stage: string) {
  const path = testInfo.outputPath(`crash-${stage}-390x844.png`);
  await page.screenshot({ path });
  await testInfo.attach(`Crash ${stage}, production camera, 390×844`, {
    path,
    contentType: 'image/png',
  });
}

function renderCount(page: Page, scene: number) {
  return page.evaluate((id) => window.crashProbe.renderCounts[id] ?? 0, scene);
}

test('natural crash settles once, falls and slides, freezes while away, then restarts cleanly', async ({
  page,
}, testInfo) => {
  const errors = await install(page);
  await start(page);
  await naturalCrash(page);
  const ride = page.getByTestId('ride-screen');
  const settled = await readSave(page);
  expect(settled.runsPlayed).toBe(1);
  expect(settled.processedRuns).toHaveLength(1);
  expect(settled.history).toHaveLength(1);
  expect(settled.xp).toBeGreaterThan(0);
  const distance = await ride.getAttribute('data-distance');
  const early = await pose(page);
  expectAttached(early);
  await capture(page, testInfo, 'early');

  await page.clock.runFor(340);
  await expect(ride).toHaveAttribute('data-phase', 'crashed');
  const mid = await pose(page);
  expectAttached(mid);
  expect(mid.root.quaternion).not.toEqual(early.root.quaternion);
  await capture(page, testInfo, 'mid');

  await page.clock.runFor(520);
  await expect(ride).toHaveAttribute('data-phase', 'crashed');
  const fallen = await pose(page);
  expectAttached(fallen);
  expect(Math.abs(fallen.root.roll)).toBeGreaterThan(0.65);
  expect(fallen.helmet[1]).toBeLessThan(early.helmet[1] - 0.25);
  expect(
    Math.hypot(
      fallen.root.position[0] - early.root.position[0],
      fallen.root.position[2] - early.root.position[2],
    ),
  ).toBeGreaterThan(0.1);
  await expect(ride).toHaveAttribute('data-distance', distance!);
  expect(await readSave(page)).toEqual(settled);
  await capture(page, testInfo, 'fallen');

  // A visible but blurred window must freeze the remaining presentation time.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const blurred = await pose(page);
  await page.clock.runFor(1700);
  await expect(ride).toHaveAttribute('data-phase', 'crashed');
  expect(await pose(page)).toEqual(blurred);
  expect(await readSave(page)).toEqual(settled);

  // Focus alone is insufficient while the document remains hidden.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await page.clock.runFor(1700);
  await expect(ride).toHaveAttribute('data-phase', 'crashed');
  expect(await pose(page)).toEqual(blurred);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    Reflect.deleteProperty(document, 'visibilityState');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(600);
  await expect(
    page.getByRole('button', { name: 'RIDE AGAIN', exact: true }),
  ).toBeVisible();
  await expect(ride).toHaveCount(0);
  expect(await readSave(page)).toEqual(settled);
  const stoppedCount = await renderCount(page, early.scene);
  await page.clock.runFor(1400);
  expect(await renderCount(page, early.scene)).toBe(stoppedCount);
  expect(await readSave(page)).toEqual(settled);

  await page.getByRole('button', { name: 'RIDE AGAIN', exact: true }).click();
  await waitForPlaying(page);
  const restarted = await pose(page);
  expect(restarted.scene).not.toBe(early.scene);
  expect(Math.abs(restarted.root.roll)).toBeLessThan(0.01);
  expectAttached(restarted);
  expect(await readSave(page)).toEqual(settled);
  expect(await renderCount(page, early.scene)).toBe(stoppedCount);
  await page.keyboard.press('Escape');
  await expect(ride).toHaveAttribute('data-phase', 'paused');
  await page
    .getByRole('button', { name: 'END RIDE & COLLECT', exact: true })
    .click();
  await page.clock.runFor(32);
  await expect(
    page.getByRole('button', { name: 'RIDE AGAIN', exact: true }),
  ).toBeVisible();
  const second = await readSave(page);
  expect(second.runsPlayed).toBe(2);
  expect(new Set(second.processedRuns).size).toBe(2);
  expect(second.history).toHaveLength(2);
  await page.clock.runFor(1500);
  expect(await readSave(page)).toEqual(second);
  expect(errors).toEqual([]);
});

test('first tutorial ride collects immediately and focus never resumes a paused ride', async ({
  page,
}) => {
  // Starting through the tutorial must initialize the same settlement generation
  // as later rides, so this first run can be collected exactly once.
  const errors = await install(page, false, false);
  await start(page);
  expect((await readSave(page)).settings.tutorialSeen).toBe(true);
  const ride = page.getByTestId('ride-screen');
  await page.keyboard.press('Escape');
  await expect(ride).toHaveAttribute('data-phase', 'paused');
  const paused = await pose(page);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
  });
  await page.clock.runFor(1400);
  await expect(ride).toHaveAttribute('data-phase', 'paused');
  expect(await pose(page)).toEqual(paused);
  expect((await readSave(page)).runsPlayed).toBe(0);
  await page
    .getByRole('button', { name: 'END RIDE & COLLECT', exact: true })
    .click();
  await page.clock.runFor(32);
  await expect(
    page.getByRole('button', { name: 'RIDE AGAIN', exact: true }),
  ).toBeVisible();
  await expect(ride).toHaveCount(0);
  const saved = await readSave(page);
  expect(saved.runsPlayed).toBe(1);
  expect(saved.processedRuns).toHaveLength(1);
  const stoppedCount = await renderCount(page, paused.scene);
  await page.clock.runFor(1800);
  expect(await renderCount(page, paused.scene)).toBe(stoppedCount);
  expect(await readSave(page)).toEqual(saved);
  expect(errors).toEqual([]);
});

test('reduced motion shows a short static crash pose before results', async ({
  page,
}, testInfo) => {
  const errors = await install(page, true);
  await start(page);
  await naturalCrash(page);
  const ride = page.getByTestId('ride-screen');
  const first = await pose(page);
  expectAttached(first);
  const saved = await readSave(page);
  expect(saved.runsPlayed).toBe(1);
  await capture(page, testInfo, 'reduced-motion');
  await page.clock.runFor(64);
  await expect(ride).toHaveAttribute('data-phase', 'crashed');
  expect(await pose(page)).toEqual(first);
  expect(await readSave(page)).toEqual(saved);
  await page.clock.runFor(220);
  await expect(
    page.getByRole('button', { name: 'RIDE AGAIN', exact: true }),
  ).toBeVisible();
  await expect(ride).toHaveCount(0);
  await page.clock.runFor(1500);
  expect(await readSave(page)).toEqual(saved);
  expect(errors).toEqual([]);
});
