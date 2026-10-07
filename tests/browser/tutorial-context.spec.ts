import { test, expect, type Page } from '@playwright/test';
import { newPlayer } from '../../app/domain/progression';
import { TUTORIAL_HINTS } from '../../app/domain/tutorial';
import type { Player } from '../../app/domain/types';
import type { Engine } from '../../app/game/engine';
import { primaryAction } from './garage-helpers';

declare global { interface Window { tutorialTestEngine?: Engine } }

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pfusch:player:v1')!) as Player);

async function startFresh(page: Page) {
  const initial = newPlayer();
  initial.settings.quality = 'low';
  initial.settings.reducedMotion = true;
  await page.addInitScript(player => {
    if (!localStorage.getItem('pfusch:player:v1')) localStorage.setItem('pfusch:player:v1', JSON.stringify(player));
    Math.random = () => 5489 / 0xffffffff;
  }, initial);
  await page.goto('/');
  // Observe the production engine; only encounter setup below changes its pools.
  await page.evaluate(async () => {
    const modulePath = '/app/game/engine.ts';
    const { Engine: RideEngine } = await import(/* @vite-ignore */ modulePath) as { Engine: typeof Engine };
    const start = RideEngine.prototype.start;
    RideEngine.prototype.start = function (this: Engine) {
      window.tutorialTestEngine = this;
      start.call(this);
    };
  });
  await expect(primaryAction(page)).toBeEnabled({ timeout: 60000 });
  await primaryAction(page).click();
  await expect(page.getByTestId('ride-tutorial-overlay')).toHaveAttribute('data-tutorial', 'controls', { timeout: 60000 });
}

async function expectTargetClear(page: Page) {
  const ring = page.getByTestId('tutorial-target');
  await expect(ring).toBeVisible();
  const target = (await ring.boundingBox())!;
  const card = (await page.locator('.ride-coach-card').boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(target.x).toBeGreaterThanOrEqual(0);
  expect(target.y).toBeGreaterThanOrEqual(0);
  expect(target.x + target.width).toBeLessThanOrEqual(viewport.width);
  expect(target.y + target.height).toBeLessThanOrEqual(viewport.height);
  expect(target.x + target.width <= card.x || target.x >= card.x + card.width ||
    target.y + target.height <= card.y || target.y >= card.y + card.height).toBe(true);
}

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test.describe(`contextual tutorial ${viewport.width}`, () => {
    test.use({ viewport, hasTouch: true });
    test('swipe intent, anchored encounters, blur, skip and persistence', async ({ page }) => {
      test.setTimeout(180000);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await startFresh(page);
      const ride = page.getByTestId('ride-screen');
      const coach = page.getByTestId('ride-tutorial-overlay');
      await expect(ride).toHaveAttribute('data-phase', 'paused');
      expect((await saved(page)).settings.tutorialHintsSeen).toEqual([]);
      const distance = await ride.getAttribute('data-distance');
      await page.evaluate(() => {
        window.dispatchEvent(new Event('blur'));
        window.dispatchEvent(new Event('focus'));
      });
      await page.waitForTimeout(250);
      await expect(ride).toHaveAttribute('data-phase', 'paused');
      await expect(ride).toHaveAttribute('data-distance', distance!);
      expect((await saved(page)).settings.tutorialHintsSeen).toEqual([]);
      await expect(page.locator('.ride-coach-stage-gesture')).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(page.getByTestId('tutorial-continue')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Hinweise überspringen' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByTestId('tutorial-continue')).toBeFocused();
      await page.screenshot({ path: `outputs/tutorial-controls-${viewport.width}.png` });

      const touch = await page.context().newCDPSession(page);
      const x = Math.round(viewport.width * .4), y = Math.round(viewport.height * .26);
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      const down = viewport.width === 320;
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (down ? 0 : 72), y: y + (down ? 65 : 0) }] });
      await expect(coach).toHaveCount(0);
      await expect(ride).toHaveAttribute('data-phase', 'playing');
      if (down) await expect.poll(() => page.evaluate(() => window.tutorialTestEngine!.throttleInput)).toBeGreaterThan(.4);
      else await expect(ride).toHaveAttribute('data-lane', '1');
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(() => page.evaluate(() => window.tutorialTestEngine!.throttleInput)).toBe(0);
      expect((await saved(page)).settings.tutorialHintsSeen).toEqual(['controls']);

      // A real pooled vehicle, far enough ahead, becomes the first contextual hint.
      await page.evaluate(() => {
        const engine = window.tutorialTestEngine!;
        engine.obstacles.forEach(obstacle => { obstacle.active = false; });
        engine.signs.forEach(sign => { sign.active = false; });
        engine.elapsed = 12;
        engine.height = 0; engine.velocityY = 0; engine.wheelieAngle = 0;
        engine.clearInput();
        engine.spawn('car', -1, engine.speed * 2.6);
      });
      await expect(coach).toHaveAttribute('data-tutorial', 'traffic', { timeout: 15000 });
      await expect(ride).toHaveAttribute('data-phase', 'paused');
      await expectTargetClear(page);
      await page.screenshot({ path: `outputs/tutorial-traffic-${viewport.width}.png` });
      await page.getByTestId('tutorial-continue').click();
      await expect(ride).toHaveAttribute('data-phase', 'playing');
      expect((await saved(page)).settings.tutorialHintsSeen).toEqual(['controls', 'traffic']);
      await page.evaluate(() => {
        const engine = window.tutorialTestEngine!;
        engine.obstacles.forEach(obstacle => { obstacle.active = false; });
        engine.elapsed += 10;
        engine.spawn('car', -1, engine.speed * 2.6);
      });
      await page.waitForTimeout(350);
      await expect(coach).toHaveCount(0);

      // The ring is projected from the actual roadside camera, not a fixed screen point.
      await page.evaluate(() => {
        const engine = window.tutorialTestEngine!;
        engine.obstacles.forEach(obstacle => { obstacle.active = false; });
        engine.signs.forEach(sign => { sign.active = false; });
        engine.elapsed += 10;
        Object.assign(engine.speedCamera, { id: 1, active: true, distance: engine.distance + engine.speed * 2.6, side: -1, triggered: false });
      });
      await expect(coach).toHaveAttribute('data-tutorial', 'radar', { timeout: 15000 });
      await expectTargetClear(page);
      await page.screenshot({ path: `outputs/tutorial-radar-${viewport.width}.png` });
      await page.getByRole('button', { name: 'Hinweise überspringen' }).click();
      await expect(ride).toHaveAttribute('data-phase', 'playing');
      expect((await saved(page)).settings.tutorialHintsSeen).toEqual([...TUTORIAL_HINTS]);
      await page.reload();
      await expect(primaryAction(page)).toBeEnabled({ timeout: 60000 });
      await primaryAction(page).click();
      await expect(ride).toHaveAttribute('data-phase', 'playing', { timeout: 60000 });
      await expect(coach).toHaveCount(0);
      expect((await saved(page)).settings.tutorialHintsSeen).toEqual([...TUTORIAL_HINTS]);
      expect(errors).toEqual([]);
    });
  });
}
