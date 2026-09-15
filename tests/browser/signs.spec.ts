import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import type * as THREE from 'three';
import { newPlayer } from '../../app/domain/progression';
import type { Engine } from '../../app/game/engine';
import { SIGN_COLLECTIBLES, SIGN_IDS } from '../../app/game/signCollectibles';

declare global {
  interface Window {
    signProbe: {
      scene?: THREE.Scene;
      renderer?: THREE.WebGLRenderer;
      engine?: Engine;
      root?: THREE.Object3D;
      slots?: THREE.Object3D[];
      geometry?: Set<THREE.BufferGeometry>;
      materials?: Set<THREE.Material | THREE.Material[]>;
      particleGeometry?: THREE.BufferGeometry;
    };
  }
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function start(page: Page, low: boolean) {
  const errors: string[] = [],
    assets = new Set<string>();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/assets/signs/') && path.endsWith('.png'))
      assets.add(path);
  });
  page.on('requestfailed', (request) => {
    if (request.url().includes('/assets/signs/'))
      errors.push(`${request.url()}: ${request.failure()?.errorText}`);
  });
  await page.clock.install({ time: new Date('2026-09-15T10:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-15T10:00:01Z'));
  const player = newPlayer();
  player.settings.tutorialSeen = true;
  player.settings.quality = low ? 'low' : 'auto';
  await page.addInitScript((saved) => {
    Math.random = () => 5489 / 0xffffffff;
    localStorage.setItem('pfusch:player:v1', JSON.stringify(saved));
    window.signProbe = {};
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', (event) => {
      const item = (event as CustomEvent).detail;
      if (!item.isWebGLRenderer) return;
      const render = item.render.bind(item);
      item.render = (scene: THREE.Scene, camera: THREE.Camera) => {
        render(scene, camera);
        if (!scene.getObjectByName('streamed-world')) return;
        window.signProbe.scene = scene;
        window.signProbe.renderer = item;
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
  // Test fixtures use the mounted deterministic engine, without a production
  // debug API, a replacement renderer or edits to the chase camera.
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
        if (candidate?.world && typeof candidate.spawnSign === 'function') {
          window.signProbe.engine = candidate;
          return;
        }
      }
      fiber = fiber.return;
    }
    throw new Error('The mounted sign engine was not found');
  });
  return { errors, assets };
}

for (const low of [false, true]) {
  test(`original PFUSCH signs render, pause, collect and recycle (${low ? 'low' : 'normal'})`, async ({
    page,
    request,
  }, testInfo) => {
    const { errors, assets } = await start(page, low);
    const ride = page.getByTestId('ride-screen');
    await page.evaluate(
      (ids) => {
        const engine = window.signProbe.engine!;
        engine.clearInput();
        engine.phase = 'ready';
        for (const obstacle of engine.obstacles) obstacle.active = false;
        for (const sign of engine.signs) sign.active = false;
        ids.forEach((id, i) =>
          engine.spawnSign(id, (i % 3) - 1, i < 3 ? 18 : 29),
        );
      },
      [...SIGN_IDS],
    );
    await expect
      .poll(
        async () => {
          await page.clock.runFor(100);
          return page.evaluate(
            () =>
              window.signProbe.scene
                ?.getObjectByName('sign-collectibles')
                ?.children.filter((slot) => slot.visible).length,
          );
        },
        { timeout: 20000 },
      )
      .toBe(6);
    expect([...assets].sort()).toEqual(
      SIGN_COLLECTIBLES.map((sign) => sign.asset).sort(),
    );

    // These hashes identify precisely images 1, 2, 3, 6, 7 and 8. The two
    // rejected warning images cannot silently replace the transparent S.
    if (!low) {
      const hashes = [
        '44fc2b65b4f60b8866d8eaf9b7588b0e275deb2dd1c13a5527a8b42e24165e03',
        'd3bc4330f8b0a9fd7ddcaa263d760d5ccd6443a809f8b86ed5875a93d0fffa14',
        '4fcca6a99bf781d1e3f53b8bc53ac24747776ca58a5bbad3090c33fd3a2d910c',
        '3311fb94e57083cf8b858d1e38389b38ae23b053ce9fa619fd37a17796b75159',
        '37ec8fe2f39e06941c8012d3e3a1f490c181d54c52a2786e1dcf687e64797ec1',
        '1aab988915509c9962f9297a1ad35ce2019f158e602938c09fc931b2e05ee699',
      ];
      for (const [i, definition] of SIGN_COLLECTIBLES.entries()) {
        const response = await request.get(definition.asset);
        expect(response.ok()).toBe(true);
        expect(
          createHash('sha256')
            .update(await response.body())
            .digest('hex'),
        ).toBe(hashes[i]);
      }
    }

    const rendered = await page.evaluate(() => {
      const probe = window.signProbe;
      const root = probe.scene!.getObjectByName('sign-collectibles')!;
      probe.root = root;
      probe.slots = [...root.children];
      probe.geometry = new Set();
      probe.materials = new Set();
      const cards = root.children
        .filter((slot) => slot.visible)
        .map((slot) => {
          const face = slot.getObjectByName(
            'sign-original-artwork',
          ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
          probe.geometry!.add(face.geometry);
          probe.materials!.add(face.material);
          const image = face.material.map!.image as ImageBitmap;
          return {
            id: slot.userData.signId,
            angle: slot.rotation.z,
            width: image.width,
            height: image.height,
          };
        });
      const particles = probe.scene!.getObjectByName(
        'ride-exhaust-and-scrape-particles',
      ) as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
      probe.particleGeometry = particles.geometry;
      return {
        cards,
        slots: root.children.length,
        shader: particles.material.isShaderMaterial,
        particleCapacity: particles.geometry.getAttribute('position').count,
        programs: probe.renderer!.info.programs!.length,
      };
    });
    expect(rendered.slots).toBe(8);
    expect(rendered.cards.map((card) => card.id)).toEqual([...SIGN_IDS]);
    expect(rendered.cards.map((card) => card.angle)).toEqual(
      SIGN_COLLECTIBLES.map((sign) => sign.rotation),
    );
    for (const card of rendered.cards) {
      expect(card.width).toBeLessThanOrEqual(low ? 256 : 512);
      expect(card.height).toBeLessThanOrEqual(low ? 256 : 512);
    }
    expect(rendered.shader).toBe(true);
    expect(rendered.particleCapacity).toBe(low ? 64 : 128);
    expect(rendered.programs).toBeGreaterThan(0);
    await page.screenshot({
      path: testInfo.outputPath('six-original-signs.png'),
    });

    await page.evaluate(() => {
      window.signProbe.engine!.phase = 'playing';
    });
    await page.clock.runFor(100);
    await page.keyboard.press('p');
    await page.clock.runFor(100);
    await expect(ride).toHaveAttribute('data-phase', 'paused');
    const frozen = () =>
      page.evaluate(() => {
        const probe = window.signProbe;
        const particles = probe.scene!.getObjectByName(
          'ride-exhaust-and-scrape-particles',
        ) as THREE.Points;
        return {
          elapsed: probe.engine!.elapsed,
          score: probe.engine!.score,
          signs: probe.root!.children.map((slot) => [
            slot.visible,
            ...slot.position.toArray(),
            ...slot.rotation.toArray(),
          ]),
          smoke: [...particles.geometry.getAttribute('position').array],
        };
      });
    const beforePause = await frozen();
    await page.clock.runFor(750);
    expect(await frozen()).toEqual(beforePause);
    await page.keyboard.press('p');
    await page.evaluate(() => {
      const engine = window.signProbe.engine!;
      for (const sign of engine.signs) sign.active = false;
      engine.clearInput();
      engine.lane = engine.x = 0;
    });
    let lastScore = await page.evaluate(() => window.signProbe.engine!.score);
    const serial = await page.evaluate(
      () => window.signProbe.engine!.signPickupSerial,
    );
    for (const [i, id] of SIGN_IDS.entries()) {
      await page.evaluate((id) => {
        window.signProbe.engine!.spawnSign(id, 0, 1.5);
      }, id);
      await page.clock.runFor(120);
      const last = i === SIGN_IDS.length - 1;
      await expect(ride).toHaveAttribute(
        'data-sign-mask',
        String(last ? 0 : (1 << (i + 1)) - 1),
      );
      const score = await page.evaluate(() => window.signProbe.engine!.score);
      expect(score - lastScore).toBeGreaterThanOrEqual(last ? 750 : 45);
      lastScore = score;
      if (!last)
        await expect(page.locator('.sign-progress b.collected')).toHaveCount(
          i + 1,
        );
    }
    await expect(ride).toHaveAttribute('data-sign-sets', '1');
    await expect(
      page.getByText('PFUSCH SET COMPLETE', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('SETS 1', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => window.signProbe.engine!.signPickupSerial),
    ).toBe(serial + 6);
    await page.screenshot({
      path: testInfo.outputPath('pfusch-set-bonus.png'),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);

    for (let turn = 0; turn < 6; turn++) {
      await page.evaluate(
        ({ ids, turn }) => {
          const engine = window.signProbe.engine!;
          engine.phase = 'ready';
          for (const sign of engine.signs) sign.active = false;
          ids.forEach((_, i) =>
            engine.spawnSign(
              ids[(i + turn) % ids.length],
              (i % 3) - 1,
              12 + i * 2,
            ),
          );
        },
        { ids: [...SIGN_IDS], turn },
      );
      await page.clock.runFor(34);
    }
    expect(
      await page.evaluate(() => {
        const probe = window.signProbe;
        const root = probe.scene!.getObjectByName('sign-collectibles')!;
        const particles = probe.scene!.getObjectByName(
          'ride-exhaust-and-scrape-particles',
        ) as THREE.Points;
        return (
          root === probe.root &&
          root.children.length === 8 &&
          root.children.every((slot, i) => {
            const face = slot.getObjectByName(
              'sign-original-artwork',
            ) as THREE.Mesh;
            return (
              slot === probe.slots![i] &&
              probe.geometry!.has(face.geometry) &&
              probe.materials!.has(face.material)
            );
          }) &&
          particles.geometry === probe.particleGeometry
        );
      }),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}
