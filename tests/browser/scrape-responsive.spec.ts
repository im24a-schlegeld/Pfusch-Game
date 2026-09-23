import { test, expect } from '@playwright/test';
import type * as THREE from 'three';
import type { Engine } from '../../app/game/engine';
import type { Player } from '../../app/domain/types';
import { TAIL_CONTACT } from '../../app/game/tailContact';

declare global {
  interface Window {
    scrapeProbe: {
      scene?: THREE.Scene;
      camera?: THREE.PerspectiveCamera;
      renderer?: THREE.WebGLRenderer;
      engine?: Engine;
    };
  }
}

// Desktop HiDPI reaches the production 1.6 DPR cap; the same renderer is then
// resized to phone dimensions and back, exercising the real resize observer.
test.use({ deviceScaleFactor: 2 });
for (const model of ['701', 'scooter'] as const) {
  test(`${model}: scrape remains visible at fullscreen and phone sizes`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.clock.install({ time: new Date('2026-09-23T12:00:00Z') });
    await page.clock.pauseAt(new Date('2026-09-23T12:00:01Z'));
    await page.addInitScript(() => {
      window.scrapeProbe = {};
      window.__THREE_DEVTOOLS__ = new EventTarget();
      window.__THREE_DEVTOOLS__.addEventListener('observe', (event) => {
        const renderer = (event as CustomEvent)
          .detail as THREE.WebGLRenderer & { isWebGLRenderer?: boolean };
        if (!renderer.isWebGLRenderer) return;
        const render = renderer.render.bind(renderer);
        renderer.render = (scene, camera) => {
          render(scene, camera);
          if (scene.getObjectByName('streamed-world')) {
            window.scrapeProbe.scene = scene as THREE.Scene;
            window.scrapeProbe.camera = camera as THREE.PerspectiveCamera;
            window.scrapeProbe.renderer = renderer;
          }
        };
      });
    });
    await page.goto('/');
    await page.evaluate(async (bike) => {
      // Let Vite handle the catalog's JSON import just as it does in production.
      const modulePath = '/app/domain/progression.ts';
      const { newPlayer } = (await import(/* @vite-ignore */ modulePath)) as {
        newPlayer: () => Player;
      };
      const player = newPlayer();
      player.bike = bike;
      player.paint = '#ff3300';
      player.settings.tutorialSeen = true;
      localStorage.setItem('pfusch:player:v1', JSON.stringify(player));
    }, model);
    await page.reload();
    await page.getByRole('button', { name: 'LOSFAHREN', exact: true }).click();
    await expect
      .poll(
        async () => {
          await page.clock.runFor(100);
          return page.locator('.scene-ride canvas').count();
        },
        { timeout: 30000 },
      )
      .toBe(1);
    await expect
      .poll(
        async () => {
          await page.clock.fastForward(700);
          await page.clock.runFor(16);
          expect(errors, 'Initial renderer errors').toEqual([]);
          return page.getByTestId('ride-screen').getAttribute('data-phase');
        },
        { timeout: 30000 },
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
            window.scrapeProbe.engine = candidate;
            return;
          }
        }
        fiber = fiber.return;
      }
      throw new Error('Mounted ride engine not found');
    });
    let bufferId = '';
    for (const [width, height] of [
      [1920, 1080],
      [2560, 1440],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.evaluate((angle) => {
        const engine = window.scrapeProbe.engine!;
        engine.obstacles.forEach((obstacle) => {
          obstacle.active = false;
        });
        engine.clearInput();
        engine.height = 0;
        engine.velocityY = 0;
        engine.wheelieAngle = angle + 0.045;
        engine.wheelieAngularVelocity = 0;
        engine.liftPull = 0;
        engine.wheelie = true;
      }, TAIL_CONTACT[model].angle);
      await page.clock.runFor(100);
      const frame = await page.evaluate(() => {
        const { scene, camera, renderer } = window.scrapeProbe;
        const points = scene!.getObjectByName(
          'ride-exhaust-and-scrape-particles',
        ) as THREE.Points;
        const material = points.material as THREE.ShaderMaterial;
        const opacity = points.geometry.getAttribute('particleOpacity');
        const kinds = points.geometry.getAttribute('particleKind');
        const colors = points.geometry.getAttribute('color');
        const originalOpacity = [...opacity.array];
        const chips: number[][] = [];
        for (let i = 0; i < opacity.count; i++) {
          if (kinds.getX(i) === 0) opacity.setX(i, 0);
          else if (opacity.getX(i) > 0)
            chips.push([
              kinds.getX(i),
              colors.getX(i),
              colors.getY(i),
              colors.getZ(i),
            ]);
        }
        opacity.needsUpdate = true;
        const gl = renderer!.getContext();
        const width = gl.drawingBufferWidth,
          height = gl.drawingBufferHeight;
        const without = new Uint8Array(width * height * 4);
        const withScrape = new Uint8Array(without.length);
        points.visible = false;
        renderer!.render(scene!, camera!);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, without);
        points.visible = true;
        renderer!.render(scene!, camera!);
        gl.readPixels(
          0,
          0,
          width,
          height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          withScrape,
        );
        let changedPixels = 0;
        for (let i = 0; i < without.length; i += 4)
          if (
            Math.max(
              Math.abs(without[i] - withScrape[i]),
              Math.abs(without[i + 1] - withScrape[i + 1]),
              Math.abs(without[i + 2] - withScrape[i + 2]),
            ) > 12
          )
            changedPixels++;
        opacity.array.set(originalOpacity);
        opacity.needsUpdate = true;
        renderer!.render(scene!, camera!);
        return {
          cssPixelArea: changedPixels / renderer!.getPixelRatio() ** 2,
          viewportHeight: material.uniforms.viewportHeight.value as number,
          pixelRatio: material.uniforms.pixelRatio.value as number,
          physicalHeight: height,
          actualDpr: renderer!.getPixelRatio(),
          chips,
          bufferId: points.geometry.uuid,
          count: opacity.count,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(frame.viewportHeight).toBeCloseTo(frame.physicalHeight, -1);
      expect(frame.pixelRatio).toBe(frame.actualDpr);
      expect(frame.cssPixelArea).toBeGreaterThan(width > 1000 ? 45 : 8);
      expect(frame.count).toBe(128);
      expect(frame.overflow).toBe(false);
      expect(frame.chips.length).toBeGreaterThan(0);
      for (const [kind, red, green, blue] of frame.chips) {
        expect(kind).toBe(model === '701' ? 1 : 2);
        if (model === 'scooter')
          expect(Math.max(red, green, blue)).toBeLessThan(0.01);
      }
      if (bufferId) expect(frame.bufferId).toBe(bufferId);
      bufferId = frame.bufferId;
      await page.screenshot({
        path: info.outputPath(`scrape-${width}x${height}.png`),
      });
    }
    expect(errors).toEqual([]);
  });
}
