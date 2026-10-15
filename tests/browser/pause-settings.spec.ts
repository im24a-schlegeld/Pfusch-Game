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
  // The later mobile .standard-page.narrow stylesheet used to turn the inner
  // page into a non-scrolling overflow:auto container. Its overscroll boundary
  // trapped touch and wheel input even though keyboard scrolling still worked.
  expect(await settings.locator('.standard-page').evaluate(node => getComputedStyle(node).overflowY)).toBe('visible');
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 650 }] });
  for (let step = 1; step <= 8; step++) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: 650 - step * 30 }] });
    await page.waitForTimeout(35);
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => settings.evaluate(node => node.scrollTop)).toBeGreaterThan(20);
  await expect(ride).toHaveAttribute('data-phase', 'paused');
  await expect(ride).toHaveAttribute('data-distance', distance!);
  await settings.evaluate(node => { node.scrollTop = 0; });
  await touch.detach();
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
  // Explicit save now synchronizes pending settings and returns to pause.
  await settings.getByRole('button', { name: 'Einstellungen speichern', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'PAUSE.' })).toBeVisible();
  await page.getByRole('button', { name: 'EINSTELLUNGEN', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'PAUSE.' })).toBeVisible();
  await expect(ride).toHaveAttribute('data-phase', 'paused');
  await page.getByRole('button', { name: 'WEITERFAHREN', exact: true }).click();
  // The countdown continues through rendered frames; shader compilation after
  // changing quality can make those frames slower on software-rendered CI.
  await expect(ride).toHaveAttribute('data-phase', 'playing', { timeout: 15000 });
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
    // Take the function from its descriptor so it remains explicitly bound via .apply(canvas, args).
    const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
    if (!descriptor || typeof descriptor.value !== 'function') throw new Error('Canvas context unavailable');
    const original = descriptor.value as HTMLCanvasElement['getContext'];
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
