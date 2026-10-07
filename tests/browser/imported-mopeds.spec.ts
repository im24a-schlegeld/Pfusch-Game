import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type * as THREE from 'three';
import type { Engine } from '../../app/game/engine';
import type { Player, Product } from '../../app/domain/types';
import { newPlayer } from '../../app/domain/progression';
import { chooseBike, chooseProduct, primaryAction } from './garage-helpers';

declare global { interface Window {
  mopedInspection: { scene?: THREE.Scene; camera?: THREE.Camera; engine?: Engine };
} }
const catalog: Product[] = JSON.parse(readFileSync(new URL('../../public/catalog/products.json', import.meta.url), 'utf8'));
const cape = catalog.find(product => product.category === 'cape')!;
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pfusch:player:v1')!) as Player);
async function seed(page: Page, initial: Player) {
  await page.addInitScript(player => {
    if (!localStorage.getItem('pfusch:player:v1')) localStorage.setItem('pfusch:player:v1', JSON.stringify(player));
    window.mopedInspection = {};
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', event => {
      const renderer = (event as CustomEvent).detail;
      if (!renderer.isWebGLRenderer) return;
      const render = renderer.render.bind(renderer);
      renderer.render = (scene: THREE.Scene, camera: THREE.Camera) => {
        render(scene, camera);
        if (scene.getObjectByName('imported-motorcycle')) {
          window.mopedInspection.scene = scene; window.mopedInspection.camera = camera;
        }
      };
    });
  }, initial);
  await page.goto('/');
  await expect(primaryAction(page)).toBeEnabled({ timeout: 90000 });
  await expect(page.getByRole('button', { name: 'Vorschau vergrößern', exact: true })).toBeVisible({ timeout: 90000 });
}

test('all five bikes centre the complete rider and vehicle in the full preview', async ({ page }) => {
  test.setTimeout(240000);
  const initial = newPlayer(); initial.level = 10; initial.xp = 10000;
  initial.settings.quality = 'low'; initial.settings.reducedMotion = true;
  initial.settings.tutorialSeen = true;
  initial.settings.tutorialHintsSeen = ['controls', 'ramp', 'police', 'radar', 'traffic', 'signs'];
  initial.coins = 5000;
  initial.ownedItems.push('bike:scooter', 'bike:moped', 'bike:450', 'bike:701');
  await seed(page, initial);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const [id, name] of [['125', 'Töffli'], ['scooter', 'Roller'], ['moped', 'Moped'], ['450', 'Supermoto'], ['701', 'Sport']]) {
      await chooseBike(page, name);
      await expect.poll(() => page.evaluate(() => window.mopedInspection.scene?.getObjectByName('imported-motorcycle')?.userData.importedBike), { timeout: 90000 }).toBe(id);
      await page.getByRole('button', { name: 'Vorne ¾', exact: true }).click();
      await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.garage-page')?.scrollTo(0, 0); });
      const projected = await page.evaluate(() => {
        const { scene, camera } = window.mopedInspection;
        const root = scene!.getObjectByName('player-bike')!;
        root.updateMatrixWorld(true); camera!.updateMatrixWorld(true);
        const point = root.position.clone();
        let min = Infinity, max = -Infinity;
        const visit = (object: THREE.Object3D) => {
          if (!object.visible) return;
          const mesh = object as THREE.Mesh;
          if (mesh.isMesh) {
            const positions = mesh.geometry.getAttribute('position');
            for (let i = 0; i < positions.count; i++) {
              mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld).project(camera!);
              min = Math.min(min, point.y); max = Math.max(max, point.y);
            }
          }
          object.children.forEach(visit);
        };
        visit(root);
        return { min, max, center: (min + max) / 2 };
      });
      console.log(JSON.stringify({ id, width: viewport.width, projected }));
      expect(projected.min).toBeGreaterThan(-1);
      expect(projected.max).toBeLessThan(1);
      expect(Math.abs(projected.center)).toBeLessThan(.2);
      await page.screenshot({ path: `outputs/centered-${id}-${viewport.width}.png` });
    }
  }
  await chooseBike(page, 'Moped'); await primaryAction(page).click();
  await chooseProduct(page, cape);
  await expect.poll(() => page.evaluate(() => !!window.mopedInspection.scene?.getObjectByName('pfusch-flag-cape')), { timeout: 90000 }).toBe(true);
  for (const size of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size); await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.garage-page')?.scrollTo(0, 0); });
    await page.screenshot({ path: `outputs/new-cape-preview-${size.width}.png` });
  }
  await primaryAction(page).click();
  await expect.poll(async () => (await saved(page)).equipped.cape).toBe(cape.id);
  expect((await saved(page)).coins).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    const modulePath = '/app/game/engine.ts';
    const { Engine: RideEngine } = await import(/* @vite-ignore */ modulePath) as { Engine: typeof Engine };
    const start = RideEngine.prototype.start;
    RideEngine.prototype.start = function (this: Engine) { window.mopedInspection.engine = this; start.call(this); };
  });
  await primaryAction(page).click();
  await expect(page.getByTestId('ride-screen')).toHaveAttribute('data-phase', 'playing', { timeout: 90000 });

  await page.evaluate(() => {
    const engine = window.mopedInspection.engine!;
    engine.obstacles.forEach(obstacle => { obstacle.active = false; });
    engine.wheelieAngle = .6; engine.wheelieAngularVelocity = 0;
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'outputs/new-cape-wheelie-390.png' });
});

for (const [id, name] of [['125', 'Töffli'], ['moped', 'Moped']] as const) {
  test(`${name}: actual imported garage and ride retain source contacts and adult anatomy`, async ({ page }) => {
    test.setTimeout(240000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const initial = newPlayer();
    initial.bike = id; initial.level = 10; initial.xp = 10000;
    initial.ownedItems.push('bike:moped'); initial.settings.quality = 'low';
    initial.settings.reducedMotion = true; initial.settings.tutorialSeen = true;
    initial.settings.tutorialHintsSeen = ['controls', 'ramp', 'police', 'radar', 'traffic', 'signs'];
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page, initial);
    await expect.poll(() => page.evaluate(() => window.mopedInspection.scene?.getObjectByName('imported-motorcycle')?.userData.importedBike), { timeout: 90000 }).toBe(id);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.garage-page')?.scrollTo(0, 0); });
      await page.getByRole('button', { name: 'Vorne ¾', exact: true }).click();
      await page.screenshot({ path: `outputs/new-${id}-garage-front-${viewport.width}.png` });
      await page.getByRole('button', { name: 'Seite', exact: true }).click();
      await page.screenshot({ path: `outputs/new-${id}-garage-side-${viewport.width}.png` });
      const contact = await page.evaluate(() => {
        const body = window.mopedInspection.scene!.getObjectByName('imported-motorcycle')!;
        const lamp = body.userData.headlightAnchors[0] as THREE.Object3D;
        const seat = body.userData.riderSeatContact;
        return { model: body.userData.importedBike, front: body.getObjectByName('front-wheel')!.position.toArray(),
          rear: body.getObjectByName('rear-wheel')!.position.toArray(), lampParent: lamp.parent!.name,
          pelvisGap: seat.pelvisY - seat.surfaceY,
          canvas: document.querySelector('.gc-model canvas')!.getBoundingClientRect().toJSON(),
          pane: document.querySelector('.gc-preview')!.getBoundingClientRect().toJSON(),
          overflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(contact.model).toBe(id);
      expect(contact.lampParent).toBe('imported-steering');
      expect(contact.rear[2] - contact.front[2]).toBeCloseTo(id === '125' ? 1.04 : 1.1, 6);
      expect(contact.pelvisGap).toBeCloseTo(.095, 6);
      expect(Math.abs(contact.canvas.height - contact.pane.height)).toBeLessThanOrEqual(2);
      expect(contact.overflow).toBe(false);
    }
    await page.evaluate(async () => {
      const modulePath = '/app/game/engine.ts';
      const { Engine: RideEngine } = await import(/* @vite-ignore */ modulePath) as { Engine: typeof Engine };
      const start = RideEngine.prototype.start;
      RideEngine.prototype.start = function (this: Engine) { window.mopedInspection.engine = this; start.call(this); };
    });
    await primaryAction(page).click();
    await expect(page.getByTestId('ride-screen')).toHaveAttribute('data-phase', 'playing', { timeout: 90000 });
    await page.evaluate(() => {
      const engine = window.mopedInspection.engine!;
      engine.obstacles.forEach(obstacle => { obstacle.active = false; });
      engine.wheelieAngle = .55; engine.wheelieAngularVelocity = 0;
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `outputs/new-${id}-ride-wheelie-390.png` });
    expect(errors).toEqual([]);
  });
}

test('Moped and cape support locked free preview and explicit saved purchases', async ({ page }) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const initial = newPlayer(); initial.settings.quality = 'low'; initial.settings.reducedMotion = true;
  initial.settings.tutorialSeen = true;
  initial.settings.tutorialHintsSeen = ['controls', 'ramp', 'police', 'radar', 'traffic', 'signs'];
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, initial);
  const before = await saved(page);
  await chooseBike(page, 'Moped');
  await expect(primaryAction(page)).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.mopedInspection.scene?.getObjectByName('imported-motorcycle')?.userData.importedBike), { timeout: 90000 }).toBe('moped');
  expect(await saved(page)).toEqual(before);
  await chooseProduct(page, cape);
  await expect(primaryAction(page)).toBeDisabled();
  await expect(page.locator('[data-inspection-focus="cape"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!window.mopedInspection.scene?.getObjectByName('pfusch-flag-cape')), { timeout: 90000 }).toBe(true);
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.garage-page')?.scrollTo(0, 0); });
  await page.screenshot({ path: 'outputs/new-cape-locked-preview-390.png' });
  expect(await saved(page)).toEqual(before);
  // Seed a separate eligible local test account; the real user save is outside this context.
  await page.evaluate(() => {
    const player = JSON.parse(localStorage.getItem('pfusch:player:v1')!) as Player;
    player.xp = 5100; player.level = 8; player.coins = 5350;
    player.settings.reducedMotion = false;
    localStorage.setItem('pfusch:player:v1', JSON.stringify(player));
  });
  await page.reload();
  await expect(primaryAction(page)).toBeEnabled({ timeout: 90000 });
  await chooseBike(page, 'Moped'); await primaryAction(page).click();
  await expect.poll(async () => (await saved(page)).bike).toBe('moped');
  expect((await saved(page)).coins).toBe(5000);
  await chooseProduct(page, cape); await primaryAction(page).click();
  await expect.poll(async () => (await saved(page)).equipped.cape).toBe(cape.id);
  expect((await saved(page)).coins).toBe(0);
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.garage-page')?.scrollTo(0, 0); });
  await page.screenshot({ path: 'outputs/new-cape-equipped-390.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: 'outputs/new-cape-equipped-1440.png' });
  await page.reload(); await expect(primaryAction(page)).toBeEnabled({ timeout: 90000 });
  expect((await saved(page)).equipped.cape).toBe(cape.id);
  expect((await saved(page)).bike).toBe('moped');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    const modulePath = '/app/game/engine.ts';
    const { Engine: RideEngine } = await import(/* @vite-ignore */ modulePath) as { Engine: typeof Engine };
    const start = RideEngine.prototype.start;
    RideEngine.prototype.start = function (this: Engine) { window.mopedInspection.engine = this; start.call(this); };
  });
  await primaryAction(page).click();
  const coach = page.getByTestId('ride-tutorial-overlay');
  if (await coach.isVisible()) await page.keyboard.press('Space');
  await expect(page.getByTestId('ride-screen')).toHaveAttribute('data-phase', 'playing', { timeout: 90000 });

  await page.evaluate(() => {
    const engine = window.mopedInspection.engine!;
    engine.obstacles.forEach(obstacle => { obstacle.active = false; });
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'outputs/new-cape-ride-390.png' });
  await page.evaluate(() => {
    const engine = window.mopedInspection.engine!;
    engine.wheelieAngle = .6; engine.wheelieAngularVelocity = 0;
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'outputs/new-cape-wheelie-390.png' });
  expect(await page.evaluate(() => {
    const cloth = window.mopedInspection.scene!.getObjectByName('pfusch-flag-cape') as THREE.Mesh;
    return [...cloth.geometry.getAttribute('position').array].every(Number.isFinite);
  })).toBe(true);
  expect(errors).toEqual([]);
});
