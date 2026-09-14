import { test, expect } from '@playwright/test';
import type * as THREE from 'three';
import type { Engine } from '../../app/game/engine';

declare global {
  interface Window {
    worldProbe: { scenes: THREE.Scene[]; engine?: Engine };
  }
}

test('real segment geometry, tunnel transitions, bridges and night lighting stay aligned', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  await page.clock.install({ time: new Date('2026-09-13T10:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-13T10:00:01Z'));
  await page.addInitScript(() => {
    Math.random = () => 5489 / 0xffffffff;
    window.worldProbe = { scenes: [] };
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', (event) => {
      const item = (event as CustomEvent).detail;
      if (item.isScene) window.worldProbe.scenes.push(item);
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'LET’S RIDE', exact: true }).click();
  await page.getByRole('button', { name: 'GOT IT. LET’S RIDE' }).click();
  // A paused browser clock must also advance React's lazy-scene reveal timer.
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
  // Inspect the actual mounted Ride hook. No production cheat/debug API is added.
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
      let hook = fiber.memoizedState;
      while (hook) {
        const candidate = Array.isArray(hook.memoizedState)
          ? (hook.memoizedState[0] as Engine)
          : undefined;
        if (candidate?.world && typeof candidate.advance === 'function') {
          window.worldProbe.engine = candidate;
          return;
        }
        hook = hook.next;
      }
      fiber = fiber.return;
    }
    throw new Error('Mounted game engine was not found');
  });
  for (const target of [
    'city',
    'industrial',
    'construction',
    'open',
    'waterfront',
    'tunnel',
    'bridge',
    'night',
  ]) {
    const result = await page.evaluate((target) => {
      const engine = window.worldProbe.engine!;
      // Geometry QA positions the real seeded world at an existing authored
      // segment. Normal progression/fairness is separately tested in the domain.
      let found = engine.world.segments.find(
        (s) =>
          s.end > engine.distance + 80 &&
          (target === 'night'
            ? s.lighting === 'night' && s.kind === 'open'
            : s.kind === target),
      );
      for (let i = 0; !found && i < 1200; i++) {
        engine.distance = Math.max(
          engine.distance + 80,
          engine.world.segments.at(-1)!.end - 1,
        );
        engine.world.advance(engine.distance);
        found = engine.world.segments.find(
          (s) =>
            s.end > engine.distance + 80 &&
            (target === 'night'
              ? s.lighting === 'night' && s.kind === 'open'
              : s.kind === target),
        );
      }
      if (!found) throw new Error(`Missing ${target} from seeded world`);
      engine.distance = Math.max(
        engine.distance,
        found.start + Math.min(60, (found.end - found.start) / 2),
      );
      engine.world.advance(engine.distance);
      engine.clearInput();
      engine.phase = 'ready';
      for (const obstacle of engine.obstacles) obstacle.active = false;
      return {
        kind: engine.environment.kind,
        tunnel: engine.world.tunnelExposure(engine.distance),
        duration: found.endTime - found.startTime,
      };
    }, target);
    await page.clock.runFor(150);
    const scene = await page.evaluate(() => {
      const scene = window.worldProbe.scenes
        .filter((s) => s.getObjectByName('road-headlight'))
        .at(-1)!;
      let meshes = 0,
        instances = 0;
      scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes++;
        if ((o as THREE.InstancedMesh).isInstancedMesh)
          instances += (o as THREE.InstancedMesh).count;
      });
      return {
        meshes,
        instances,
        headlight: (scene.getObjectByName('road-headlight') as THREE.SpotLight)
          .intensity,
        fog: (scene.fog as THREE.Fog).color.getHexString(),
      };
    });
    expect(scene.meshes).toBeLessThan(1800);
    expect(scene.instances).toBeLessThan(16000);
    if (target === 'tunnel') {
      expect(result.tunnel).toBe(1);
      expect(result.duration).toBeGreaterThanOrEqual(5);
      expect(result.duration).toBeLessThanOrEqual(60);
      expect(scene.headlight).toBeGreaterThan(50);
    }
    if (target === 'night') expect(scene.headlight).toBeGreaterThan(50);
    if (target !== 'night') expect(result.kind).toBe(target);
    await page.screenshot({ path: `outputs/world-${target}.png` });
  }
  expect(errors).toEqual([]);
});
