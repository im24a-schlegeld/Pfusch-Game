import { expect, test } from '@playwright/test';
import type * as THREE from 'three';
import { newPlayer } from '../../app/domain/progression';
import type { Product } from '../../app/domain/types';
import { chooseProduct, primaryAction } from './garage-helpers';

declare global { interface Window {
  capInspection: { scene?: THREE.Scene; camera?: THREE.Camera };
} }

test('selecting a cap centres and enlarges the hip cap without saving the free preview', async ({ page, request }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const products = await (await request.get('/catalog/products.json')).json() as Product[];
  const cap = products.find(product => product.handle === 'p-zero-cap')!;
  const initial = newPlayer();
  initial.settings.quality = 'low'; initial.settings.reducedMotion = true;
  await page.addInitScript(player => {
    localStorage.setItem('pfusch:player:v1', JSON.stringify(player));
    window.capInspection = {};
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', event => {
      const renderer = (event as CustomEvent).detail;
      if (!renderer.isWebGLRenderer) return;
      const render = renderer.render.bind(renderer);
      renderer.render = (scene: THREE.Scene, camera: THREE.Camera) => {
        render(scene, camera);
        window.capInspection = { scene, camera };
      };
    });
  }, initial);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(primaryAction(page)).toBeEnabled({ timeout: 90000 });
  await expect(page.getByRole('button', { name: 'Vorschau vergrößern', exact: true })).toBeVisible({ timeout: 90000 });
  const saved = await page.evaluate(() => localStorage.getItem('pfusch:player:v1'));
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await chooseProduct(page, cap);
    await expect(page.locator('[data-inspection-focus="cap"]')).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!window.capInspection.scene?.getObjectByName('imported-cap-shell'))).toBe(true);
    await expect.poll(() => page.evaluate(() => {
      const { scene, camera } = window.capInspection;
      const shell = scene!.getObjectByName('imported-cap-shell') as THREE.Mesh;
      const position = shell.geometry.getAttribute('position');
      const point = shell.position.clone();
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i).applyMatrix4(shell.matrixWorld).project(camera!);
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
      }
      return Math.max(Math.abs((minX + maxX) / 2), Math.abs((minY + maxY) / 2));
    })).toBeLessThan(0.15);
    const framing = await page.evaluate(() => {
      const { scene, camera } = window.capInspection;
      const cap = scene!.getObjectByName('carried-cap')!;
      return {
        distance: cap.getWorldPosition(cap.position.clone()).distanceTo(camera!.position),
        helmet: !!scene!.getObjectByName('full-face-helmet'),
        hook: !!scene!.getObjectByName('cap-belt-clip'),
      };
    });
    expect(framing.distance).toBeLessThan(2);
    expect(framing.helmet).toBe(true);
    expect(framing.hook).toBe(false);
    await expect(page.getByTestId('product-card').filter({ has: page.getByText(cap.title, { exact: true }) }).getByRole('img')).toBeVisible();
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.garage-page')?.scrollTo(0, 0); });
    for (const name of ['Vorschau vergrößern', 'Vorschau verkleinern']) {
      const button = page.getByRole('button', { name, exact: true });
      const bounds = await button.boundingBox(), icon = await button.locator('svg').boundingBox();
      expect(Math.abs(bounds!.x + bounds!.width / 2 - icon!.x - icon!.width / 2)).toBeLessThan(1);
      expect(Math.abs(bounds!.y + bounds!.height / 2 - icon!.y - icon!.height / 2)).toBeLessThan(1);
    }
    expect(await page.evaluate(() => localStorage.getItem('pfusch:player:v1'))).toEqual(saved);
    await page.screenshot({ path: `outputs/cap-focus-${viewport.width}.png` });
    await page.getByRole('button', { name: 'Helm', exact: true }).click();
    await expect(page.locator('[data-inspection-focus="head"]')).toBeVisible();
  }
  expect(errors).toEqual([]);
});
