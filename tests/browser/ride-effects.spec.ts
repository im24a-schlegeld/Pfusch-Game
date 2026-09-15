import { test, expect } from '@playwright/test';
import type * as THREE from 'three';
import type { Engine } from '../../app/game/engine';
import { newPlayer } from '../../app/domain/progression';
import { TAIL_CONTACT } from '../../app/game/tailContact';

declare global {
  interface Window {
    effectsProbe: { scene?: THREE.Scene; engine?: Engine };
  }
}
for (const model of ['125', '450'] as const) {
  test(`${model}: exhaust, real tail contact and continuing unblocked fall`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.clock.install({ time: new Date('2026-09-15T12:00:00Z') });
    await page.clock.pauseAt(new Date('2026-09-15T12:00:01Z'));
    const player = newPlayer();
    player.bike = model;
    player.settings.tutorialSeen = true;
    await page.addInitScript((saved) => {
      localStorage.setItem('pfusch:player:v1', JSON.stringify(saved));
      window.effectsProbe = {};
      window.__THREE_DEVTOOLS__ = new EventTarget();
      window.__THREE_DEVTOOLS__.addEventListener('observe', (event) => {
        const item = (event as CustomEvent).detail;
        if (!item.isWebGLRenderer) return;
        const render = item.render.bind(item);
        item.render = (scene: THREE.Scene, camera: THREE.Camera) => {
          render(scene, camera);
          if (scene.getObjectByName('streamed-world'))
            window.effectsProbe.scene = scene;
        };
      });
    }, player);
    await page.goto('/');
    await page.getByRole('button', { name: 'LET’S RIDE', exact: true }).click();
    // Wait for DOM mount separately from the potentially costly first GPU frame.
    await expect(page.locator('canvas')).toHaveCount(1, { timeout: 60000 });
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
        Object.keys(element).find((k) => k.startsWith('__reactFiber$'))!
      ] as Fiber | null;
      while (fiber) {
        for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const value = Array.isArray(hook.memoizedState)
            ? (hook.memoizedState[0] as Engine)
            : undefined;
          if (value?.world && typeof value.spawn === 'function') {
            window.effectsProbe.engine = value;
            value.obstacles.forEach((o) => {
              o.active = false;
            });
            return;
          }
        }
        fiber = fiber.return;
      }
      throw new Error('No mounted game engine');
    });
    await page.clock.runFor(350);
    const inspect = () =>
      page.evaluate(() => {
        const p = window.effectsProbe,
          scene = p.scene!;
        const particles = scene.getObjectByName(
          'ride-exhaust-and-scrape-particles',
        ) as THREE.Points;
        const opacity = particles.geometry.getAttribute('particleOpacity');
        const kind = particles.geometry.getAttribute('particleKind');
        const positions = particles.geometry.getAttribute('position');
        let smoke = 0,
          newestSmoke = -1,
          sparks = 0,
          plastic = 0,
          contactHeight = Infinity;
        for (let i = 0; i < opacity.count; i++) {
          if (opacity.getX(i) < 0.005) continue;
          if (kind.getX(i) === 0) {
            smoke++;
            if (newestSmoke < 0 || opacity.getX(i) > opacity.getX(newestSmoke))
              newestSmoke = i;
          } else {
            if (kind.getX(i) === 1) sparks++;
            else plastic++;
            contactHeight = Math.min(contactHeight, positions.getY(i));
          }
        }
        return {
          smoke,
          newestSmoke,
          particleOpacity: [...opacity.array],
          particlePositions: [...positions.array],
          sparks,
          plastic,
          contactHeight,
          count: positions.count,
          buffer: particles.geometry.uuid,
          distance: p.engine!.distance,
          score: p.engine!.score,
          worldZ: scene.getObjectByName('streamed-world')!.position.z,
          bodyPitch:
            scene.getObjectByName('player-bike')!.children[0].rotation.x,
        };
      });
    const before = await inspect();
    expect(before.smoke).toBeGreaterThan(0);
    await page.evaluate((angle) => {
      const e = window.effectsProbe.engine!;
      e.clearInput();
      e.height = 0;
      e.velocityY = 0;
      e.wheelieAngle = angle + 0.045;
      e.wheelieAngularVelocity = 0;
      e.liftPull = 0;
      e.wheelie = true;
    }, TAIL_CONTACT[model].angle);
    await page.clock.runFor(100);
    const scrape = await inspect();
    expect(scrape.bodyPitch).toBeCloseTo(TAIL_CONTACT[model].angle, 2);
    expect(model === '125' ? scrape.sparks : scrape.plastic).toBeGreaterThan(0);
    expect(scrape.contactHeight).toBeLessThan(0.2);
    expect(scrape.count).toBe(before.count);
    await page.screenshot({ path: info.outputPath('tail-contact.png') });
    await page.evaluate(() =>
      window.effectsProbe.engine!.crash('Overrotated the wheelie'),
    );
    await page.clock.runFor(50);
    const startFall = await inspect();
    await page.clock.runFor(120);
    const falling = await inspect();
    expect(falling.distance).toBe(startFall.distance);
    expect(falling.score).toBe(startFall.score);
    // Smoke emitted before the crash must keep drifting and fading after the
    // deterministic run settles; it must not hang motionless around the fall.
    const smokeIndex = startFall.newestSmoke;
    expect(smokeIndex).toBeGreaterThanOrEqual(0);
    expect(falling.particleOpacity[smokeIndex]).toBeLessThan(
      startFall.particleOpacity[smokeIndex],
    );
    expect(falling.particlePositions[smokeIndex * 3 + 2]).toBeGreaterThan(
      startFall.particlePositions[smokeIndex * 3 + 2],
    );
    // The scenery keeps moving immediately although the run has settled.
    const moved = (falling.worldZ - startFall.worldZ + 12) % 12;
    expect(moved).toBeGreaterThan(0.8);
    await page.screenshot({ path: info.outputPath('fall-in-motion.png') });
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    const inactive = await inspect();
    await page.clock.runFor(200);
    const stillInactive = await inspect();
    expect(stillInactive.particlePositions).toEqual(inactive.particlePositions);
    expect(stillInactive.particleOpacity).toEqual(inactive.particleOpacity);
    expect(stillInactive.worldZ).toBe(inactive.worldZ);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    expect(errors).toEqual([]);
  });
}
