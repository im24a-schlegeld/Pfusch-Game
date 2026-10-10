import { test, expect, type Page, type CDPSession, type Locator } from '@playwright/test';
import { newPlayer } from '../../app/domain/progression';
import type { Engine } from '../../app/game/engine';
import type { Player } from '../../app/domain/types';
import { primaryAction } from './garage-helpers';

declare global { interface Window { touchButtonsTestEngine?: Engine } }
type Point = { id: number; x: number; y: number };
const viewports = [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 667, height: 375 }];
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pfusch:player:v1')!) as Player);
const touch = (cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', touchPoints: Point[]) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
const inputs = (page: Page) => page.evaluate(() => {
  const engine = window.touchButtonsTestEngine!;
  return [engine.throttleInput, engine.forwardInput];
});
async function center(locator: Locator, id: number): Promise<Point> {
  const rect = (await locator.boundingBox())!;
  return { id, x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
}
async function fits(locator: Locator, page: Page) {
  const rect = (await locator.boundingBox())!, viewport = page.viewportSize()!;
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height + 1);
}
async function seed(page: Page, mode: 'swipe' | 'buttons') {
  const initial = newPlayer();
  initial.settings.quality = 'low';
  initial.settings.reducedMotion = true;
  initial.settings.touchControls = mode;
  await page.addInitScript(player => {
    if (!localStorage.getItem('pfusch:player:v1')) localStorage.setItem('pfusch:player:v1', JSON.stringify(player));
    Math.random = () => 5489 / 0xffffffff;
  }, initial);
  await page.goto('/');
}

test.describe('touch button mode', () => {
  test.use({ hasTouch: true, viewport: viewports[0] });
  test('persists mode, resumes from a held tutorial button and releases each touch safely', async ({ page }) => {
    test.setTimeout(240000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await seed(page, 'swipe');
    await expect(primaryAction(page)).toBeEnabled({ timeout: 60000 });
    await page.locator('button[aria-label="Einstellungen"]:visible').first().click();
    const swipe = page.getByRole('radio', { name: /Wischen/ });
    const buttons = page.getByRole('radio', { name: /Tasten/ });
    await expect(swipe).toBeChecked();
    await buttons.check();
    expect((await saved(page)).settings.touchControls).toBe('buttons');
    await page.reload();
    await expect(primaryAction(page)).toBeEnabled({ timeout: 60000 });
    await page.locator('button[aria-label="Einstellungen"]:visible').first().click();
    await expect(buttons).toBeChecked();
    await page.screenshot({ path: 'outputs/touch-buttons-settings.png' });
    await page.reload();
    await expect(primaryAction(page)).toBeEnabled({ timeout: 60000 });
    await page.evaluate(async () => {
      const modulePath = '/app/game/engine.ts';
      const { Engine: RideEngine } = await import(/* @vite-ignore */ modulePath) as { Engine: typeof Engine };
      const start = RideEngine.prototype.start;
      RideEngine.prototype.start = function (this: Engine) { window.touchButtonsTestEngine = this; start.call(this); };
    });
    await primaryAction(page).click();
    const ride = page.getByTestId('ride-screen'), coach = page.getByTestId('ride-tutorial-overlay');
    await expect(coach).toHaveAttribute('data-tutorial', 'controls', { timeout: 60000 });
    // Freeze only simulation time while checking pointer ownership and layouts;
    // these checks must not race a traffic encounter or a sustained-wheelie fall.
    await page.clock.install({ time: new Date('2026-10-07T12:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-07T12:00:01Z'));
    await expect(ride.locator(':scope > .ride-touch-buttons')).toHaveCount(0);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.clock.runFor(80);
      await fits(page.locator('.ride-coach-card'), page);
      await fits(coach.getByRole('button', { name: 'Wheelie halten' }), page);
      await fits(coach.getByRole('button', { name: 'Bremse halten' }), page);
      await page.screenshot({ path: `outputs/touch-buttons-tutorial-${viewport.width}.png` });
    }
    await page.setViewportSize(viewports[0]);
    const cdp = await page.context().newCDPSession(page);
    // A vertical gesture cannot dismiss a tutorial for the button mode.
    await touch(cdp, 'touchStart', [{ id: 9, x: 150, y: 210 }]);
    await touch(cdp, 'touchMove', [{ id: 9, x: 150, y: 270 }]);
    await expect(coach).toBeVisible();
    await touch(cdp, 'touchEnd', []);
    const firstHold = await center(coach.getByRole('button', { name: 'Wheelie halten' }), 1);
    await touch(cdp, 'touchStart', [firstHold]);
    await expect(coach).toHaveCount(0);
    expect(await inputs(page)).toEqual([1, 0]);
    await touch(cdp, 'touchEnd', []);
    expect(await inputs(page)).toEqual([0, 0]);
    expect((await saved(page)).settings.tutorialHintsSeen).toContain('controls');

    const wheelie = await center(page.getByRole('button', { name: 'Wheelie halten' }), 2);
    const brake = await center(page.getByRole('button', { name: 'Bremse halten' }), 3);
    const steer = { id: 4, x: 160, y: 390 };
    await touch(cdp, 'touchStart', [wheelie]);
    await touch(cdp, 'touchStart', [wheelie, brake]);
    expect(await inputs(page)).toEqual([1, 1]);
    await touch(cdp, 'touchStart', [wheelie, brake, steer]);
    await touch(cdp, 'touchMove', [wheelie, brake, { ...steer, x: 230 }]);
    expect(await page.evaluate(() => window.touchButtonsTestEngine!.lane)).toBe(1);
    // CDP touchEnd lists the contact being lifted; [] releases all contacts.
    await touch(cdp, 'touchEnd', [wheelie]);
    expect(await inputs(page)).toEqual([0, 1]);
    await touch(cdp, 'touchCancel', []);
    expect(await inputs(page)).toEqual([0, 0]);

    await touch(cdp, 'touchStart', [{ id: 5, x: 160, y: 380 }]);
    await touch(cdp, 'touchMove', [{ id: 5, x: 160, y: 470 }]);
    expect(await inputs(page)).toEqual([0, 0]);
    await touch(cdp, 'touchEnd', []);
    await touch(cdp, 'touchStart', [wheelie]);
    await page.keyboard.down('w');
    await expect(page.getByTestId('ride-touch-buttons')).toHaveCount(0);
    expect(await inputs(page)).toEqual([0, 1]);
    await page.keyboard.up('w');
    await touch(cdp, 'touchEnd', []);
    expect(await inputs(page)).toEqual([0, 0]);
    await touch(cdp, 'touchStart', [{ id: 6, x: 150, y: 350 }]);
    await touch(cdp, 'touchEnd', []);
    await expect(page.getByTestId('ride-touch-buttons')).toBeVisible();
    expect(await page.locator('.v42-score').evaluate(node => getComputedStyle(node).clipPath)).toBe('none');
    expect(await page.locator('.v42-metrics').evaluate(node => getComputedStyle(node).borderLeftWidth)).toBe('0px');
    const signs = page.locator('.v42-daily-signs');
    await expect(signs).toContainText('0 / 6');
    await page.evaluate(() => { window.touchButtonsTestEngine!.signPickupSerial += 6; });
    await page.clock.runFor(100);
    await expect(signs).toContainText('6 / 6');
    expect((await saved(page)).challenges.claimed).toContain('daily-signs');
    await page.screenshot({ path: 'outputs/touch-buttons-hud-complete.png' });
    await page.clock.runFor(100);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.clock.runFor(80);
      for (const name of ['Wheelie halten', 'Bremse halten']) {
        const control = page.getByRole('button', { name });
        await fits(control, page);
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: `outputs/touch-buttons-ride-${viewport.width}.png` });
    }
    const heldBrake = await center(page.getByRole('button', { name: 'Bremse halten' }), 7);
    await touch(cdp, 'touchStart', [heldBrake]);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(ride).toHaveAttribute('data-phase', 'paused');
    expect(await inputs(page)).toEqual([0, 0]);
    await expect(page.getByTestId('ride-touch-buttons')).toHaveCount(0);
    await touch(cdp, 'touchEnd', []);
    await expect(page.getByRole('dialog').getByText('Bremse halten', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('keyboard-only device', () => {
  test.use({ hasTouch: false, viewport: { width: 1280, height: 800 } });
  test('does not offer the touch setting on a keyboard-only device', async ({ page }) => {
    // Windows Edge may retain a physical coarse pointer even with hasTouch:false.
    // Model the complete keyboard-only capability, including the media query.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'maxTouchPoints', { value: 0 });
      const matchMedia = window.matchMedia.bind(window);
      window.matchMedia = query => {
        const result = matchMedia(query);
        if (query === '(any-pointer: coarse)') Object.defineProperty(result, 'matches', { value: false });
        return result;
      };
      // This case checks settings capability, so avoid compiling a garage scene.
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
        if (String(args[0]).includes('webgl')) return null;
        return getContext.apply(this, args);
      } as typeof getContext;
    });
    await seed(page, 'buttons');
    await expect(primaryAction(page)).toBeEnabled({ timeout: 60000 });
    await page.locator('button[aria-label="Einstellungen"]:visible').first().click();
    await expect(page.getByRole('radio', { name: /Tasten/ })).toHaveCount(0);
  });
});
