import { test, expect } from '@playwright/test';
import { newPlayer } from '../../app/domain/progression';
import { TUTORIAL_HINTS } from '../../app/domain/tutorial';
import { primaryAction } from './garage-helpers';

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

test('settings retain the paused ride, accept controls and return to pause', async ({ page }) => {
  const player = newPlayer();
  player.settings.quality = 'low';
  player.settings.tutorialHintsSeen = [...TUTORIAL_HINTS];
  await page.addInitScript(p => localStorage.setItem('pfusch:player:v1', JSON.stringify(p)), player);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await primaryAction(page).click();
  const ride = page.getByTestId('ride-screen');
  await expect(ride).toHaveAttribute('data-phase', 'playing', { timeout: 90000 });
  await page.getByRole('button', { name: 'Fahrt pausieren', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'PAUSE.' })).toBeVisible();
  const distance = await ride.getAttribute('data-distance');
  await page.getByRole('button', { name: 'EINSTELLUNGEN', exact: true }).click();
  const settings = page.getByRole('dialog');
  await expect(settings.getByRole('heading', { name: 'EINSTELLUNGEN.', exact: true })).toBeVisible();
  await settings.getByRole('radio', { name: 'Wischen', exact: true }).check();
  await page.keyboard.press('p');
  await settings.getByRole('switch', { name: /Performance-Modus/ }).uncheck();
  // Previously changing controls restarted the three-step start timer.
  await page.waitForTimeout(2400);
  await expect(ride).toHaveAttribute('data-phase', 'paused');
  await expect(ride).toHaveAttribute('data-distance', distance!);
  await expect(ride).toHaveAttribute('data-touch-controls', 'swipe');
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 667, height: 375 }]) {
    await page.setViewportSize(viewport);
    const box = await settings.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({ path: `outputs/pause-settings-${viewport.width}.png` });
  }
  await settings.getByRole('button', { name: 'Zurück zur Pause' }).click();
  await expect(page.getByRole('heading', { name: 'PAUSE.' })).toBeVisible();
  await page.getByRole('button', { name: 'EINSTELLUNGEN', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'PAUSE.' })).toBeVisible();
  await expect(ride).toHaveAttribute('data-phase', 'paused');
  await page.getByRole('button', { name: 'WEITERFAHREN', exact: true }).click();
  await expect(ride).toHaveAttribute('data-phase', 'playing');
  await page.getByRole('button', { name: 'Fahrt pausieren', exact: true }).click();
  await page.getByRole('button', { name: 'FAHRT BEENDEN', exact: true }).click();
  await expect(page.getByRole('button', { name: 'NOCHMAL FAHREN', exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pfusch:player:v1')!));
  expect(saved.runsPlayed).toBe(1);
  expect(saved.settings.touchControls).toBe('swipe');
  expect(errors).toEqual([]);
});

test('fallback preview has no overlapping footer or cropped mobile content', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (String(args[0]).includes('webgl')) return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto('/');
  await expect(page.locator('.scene-fallback')).toBeVisible({ timeout: 90000 });
  // A default rider must never show a random catalog article such as the flag.
  await expect(page.locator('.scene-fallback img')).toHaveCount(0);
  await expect(page.locator('.gc-preview-footer')).toHaveCount(0);
  await expect(page.locator('.gc-angles')).toHaveCount(0);
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => {
      const container = document.querySelector('.gc-preview')!.getBoundingClientRect();
      const children = [...document.querySelectorAll('.scene-fallback > *')].map(el => el.getBoundingClientRect());
      return children.every((box, i) => box.bottom <= container.bottom + 1 &&
        (!i || box.top >= children[i - 1].bottom - 1));
    })).toBe(true);
    await page.screenshot({ path: `outputs/fallback-${viewport.width}.png` });
  }
});
