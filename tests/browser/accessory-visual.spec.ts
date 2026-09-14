import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { Product } from '../../app/domain/types';
import { newPlayer } from '../../app/domain/progression';
import type * as THREE from 'three';

declare global {
  interface Window {
    capMotionProbe: { scenes: THREE.Scene[]; close: boolean; capture?: string };
  }
}

test('carried caps and bag retain the riding helmet, real artwork and free preview', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const products: Product[] = await (
    await request.get('/catalog/products.json')
  ).json();
  await page.addInitScript(
    (player) =>
      localStorage.setItem('pfusch:player:v1', JSON.stringify(player)),
    newPlayer(),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'OPEN GARAGE' }).click();
  const initial = await page.evaluate(() =>
    localStorage.getItem('pfusch:player:v1'),
  );
  expect(initial).not.toBeNull();
  for (const product of products.filter(
    (p) => p.category === 'head' || p.handle === 'logo-crossbody-tasche',
  )) {
    await page
      .getByRole('button', { name: `Preview ${product.title}`, exact: true })
      .click();
    for (const view of ['SIDE', 'FRONT ¾', 'REAR ¾']) {
      await page
        .getByRole('button', { name: `Inspect ${view}`, exact: true })
        .click();
      await page.waitForTimeout(650);
      await page.getByTestId('garage-model').screenshot({
        path: `outputs/accessory-${product.handle}-${view.replace(' ¾', '-quarter')}.png`,
      });
    }
    await expect(page.getByTestId('preview-product-image')).toBeVisible();
    await page
      .getByRole('button', { name: 'LEAVE PREVIEW', exact: true })
      .click();
  }
  expect(
    await page.evaluate(() => localStorage.getItem('pfusch:player:v1')),
  ).toEqual(initial);
  expect(errors).toEqual([]);
});

test('hip cap remains clipped, responds to a real wheelie and freezes on pause', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const products = (await (
    await request.get('/catalog/products.json')
  ).json()) as Product[];
  const cap = products.find((p) => p.handle === 'p-zero-cap')!;
  const player = newPlayer();
  player.settings.tutorialSeen = true;
  player.equipped.head = cap.id;
  player.ownedItems.push(cap.id);
  await page.clock.install({ time: new Date('2026-09-15T10:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-15T10:00:01Z'));
  await page.addInitScript((saved) => {
    localStorage.setItem('pfusch:player:v1', JSON.stringify(saved));
    window.capMotionProbe = { scenes: [], close: false };
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', (event) => {
      const item = (event as CustomEvent).detail;
      if (item.isScene) window.capMotionProbe.scenes.push(item);
      if (item.isWebGLRenderer) {
        const render = item.render.bind(item);
        item.render = (scene: THREE.Scene, camera: THREE.PerspectiveCamera) => {
          const pivot = scene.getObjectByName('carried-cap-pivot');
          if (window.capMotionProbe.close && pivot) {
            const point = pivot.getWorldPosition(pivot.position.clone());
            camera.position.set(point.x - 1.3, point.y + 0.22, point.z + 0.6);
            camera.lookAt(point.x, point.y - 0.13, point.z);
          }
          render(scene, camera);
          if (window.capMotionProbe.close)
            window.capMotionProbe.capture = item.domElement.toDataURL();
        };
      }
    });
  }, player);
  await page.goto('/');
  await page.getByRole('button', { name: 'LET’S RIDE', exact: true }).click();
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
  const ride = page.getByTestId('ride-screen');
  await expect(ride).toHaveAttribute('data-phase', 'playing');
  const state = () =>
    page.evaluate(() => {
      const scene = window.capMotionProbe.scenes
        .filter((s) => s.getObjectByName('road-headlight'))
        .at(-1)!;
      const pivot = scene.getObjectByName('carried-cap-pivot')!;
      const clip = scene.getObjectByName('cap-belt-clip')!;
      const cap = scene.getObjectByName('carried-cap')!;
      return {
        rotation: pivot.quaternion.toArray(),
        attachmentGap: pivot
          .getWorldPosition(pivot.position.clone())
          .distanceTo(clip.getWorldPosition(clip.position.clone())),
        down: pivot.position
          .clone()
          .set(0, -1, 0)
          .transformDirection(pivot.matrixWorld)
          .toArray(),
        rest: cap.position.toArray(),
        helmet: !!scene.getObjectByName('full-face-helmet'),
      };
    });
  const before = await state();
  await page.keyboard.down('s');
  await expect
    .poll(async () => {
      await page.clock.runFor(100);
      return ride.getAttribute('data-wheelie');
    })
    .toBe('true');
  const wheelie = await state();
  expect(wheelie.rotation).not.toEqual(before.rotation);
  expect(wheelie.attachmentGap).toBeLessThan(1e-8);
  expect(wheelie.down[1]).toBeLessThan(-0.9);
  expect(wheelie.rest).toEqual(before.rest);
  expect(wheelie.helmet).toBe(true);
  await page.keyboard.press('Escape');
  await expect(ride).toHaveAttribute('data-phase', 'paused');
  const paused = await state();
  await page.clock.runFor(500);
  expect(await state()).toEqual(paused);
  await page.evaluate(() => {
    window.capMotionProbe.close = true;
  });
  await page.clock.runFor(20);
  // Read immediately after rendering, before WebGL clears its drawing buffer.
  // The paused close-up inspects the real clip without the dialog obscuring it.
  const capture = await page.evaluate(() => window.capMotionProbe.capture!);
  await writeFile(
    'outputs/cap-wheelie-attachment.png',
    Buffer.from(capture.split(',')[1], 'base64'),
  );
  await page.keyboard.up('s');
  expect(errors).toEqual([]);
});
