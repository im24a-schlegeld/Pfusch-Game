import { test, expect, type Page } from '@playwright/test';
import type * as THREE from 'three';
import { digitalPrice, newPlayer } from '../../app/domain/progression';
import type { Player, Product } from '../../app/domain/types';
import { chooseArea, choosePart, primaryAction } from './garage-helpers';

test.use({ hasTouch: true });

declare global {
  interface Window { stickerScenes: THREE.Scene[] }
}
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pfusch:player:v1')!) as Player);
const footerAction = (page: Page) => page.locator('.sticker-footer').getByRole('button');
const placedButtons = (page: Page) => page.locator('.sticker-items').getByRole('button', { name: /^STICKER \d+$/ });

async function checkWorkshopScroll(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  const workshop = page.getByRole('main', { name: 'Sticker-Werkstatt' });
  // The garage wrapper clips overflow; the workshop must own its scrolling.
  await expect(workshop).toHaveCSS('overflow-y', 'auto');
  await expect(workshop).toHaveCSS('touch-action', 'pan-y');
  const metrics = await workshop.evaluate(element => ({
    client: element.clientHeight, content: element.scrollHeight,
    top: element.getBoundingClientRect().top,
  }));
  expect(metrics.client).toBeGreaterThan(200);
  expect(metrics.client + metrics.top).toBeLessThanOrEqual(viewport.height);
  expect(metrics.content).toBeGreaterThan(metrics.client + 20);
  await workshop.evaluate(element => { element.scrollTop = 0; });
  const box = (await workshop.boundingBox())!;
  // Real touch panning must work outside the canvas whose gestures rotate/zoom.
  const touch = await page.context().newCDPSession(page);
  const x = box.x + 4, y = box.y + box.height * 0.8;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 8; step++) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 24 }] });
    await page.waitForTimeout(35);
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => workshop.evaluate(element => element.scrollTop)).toBeGreaterThan(20);
  await touch.detach();
  // Wheel input also scrolls the workshop instead of its clipped parent.
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.wheel(0, 1600);
  await expect.poll(() => workshop.evaluate(element => element.scrollTop)).toBeGreaterThan(20);
  const reset = page.getByRole('button', { name: 'Stickergröße zurücksetzen', exact: true });
  await reset.scrollIntoViewIfNeeded();
  await expect(reset).toBeInViewport();
  await expect(reset).toBeEnabled();
  const original = page.locator('.sticker-original');
  await original.scrollIntoViewIfNeeded();
  await expect(original).toBeInViewport();
  await expect(original.locator('img')).toBeVisible();
  await footerAction(page).scrollIntoViewIfNeeded();
  await expect(footerAction(page)).toBeInViewport();
  const actionBox = (await footerAction(page).boundingBox())!;
  expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(viewport.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: test.info().outputPath(`sticker-tools-${viewport.width}x${viewport.height}.png`) });
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.wheel(0, -1600);
  await expect.poll(() => workshop.evaluate(element => element.scrollTop)).toBe(0);
}

async function openSticker(page: Page, target: 'Helm' | 'Motorrad', product: Product) {
  await expect(primaryAction(page)).toBeEnabled({ timeout: 90000 });
  await chooseArea(page, 'Motorrad');
  await choosePart(page, 'Extras');
  await page.getByTestId('product-card').filter({ has: page.getByText(product.title, { exact: true }) }).click();
  await page.locator('.gc-toggle[aria-label="Sticker-Ziel"]').getByRole('button', { name: target, exact: true }).click();
  await expect(primaryAction(page)).toHaveText('Platzieren');
  await primaryAction(page).click();
  await expect(page.locator('.sticker-views').getByRole('button', { name: 'RECHTS', exact: true })).toBeEnabled({ timeout: 90000 });
  await expect(page.getByTestId('sticker-stage').locator('canvas')).toBeVisible();
}

/** Use real pointer hit-testing. A small bounded grid handles the two very different target shapes. */
async function placeOnSurface(page: Page) {
  const stage = page.getByTestId('sticker-stage');
  const before = await placedButtons(page).count();
  for (const view of ['RECHTS', 'LINKS', 'HINTEN']) {
    await page.locator('.sticker-views').getByRole('button', { name: view, exact: true }).click();
    await stage.scrollIntoViewIfNeeded();
    const box = await stage.boundingBox();
    if (!box) throw new Error('Sticker stage has no rendered size');
    for (const [x, y] of [[.5, .42], [.5, .35], [.45, .4], [.55, .4], [.5, .5], [.5, .6], [.4, .5], [.6, .5], [.35, .55], [.65, .55], [.4, .65], [.6, .65], [.5, .7]]) {
      await stage.click({ position: { x: Math.round(box.width * x), y: Math.round(box.height * y) } });
      if (await placedButtons(page).count() > before) return;
    }
  }
  throw new Error(`No valid visible sticker surface found: ${await page.locator('.sticker-hint').textContent()}`);
}

test('mobile sticker placement previews both targets, buys once on save, persists and removes freely', async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 390, height: 844 });
  const catalog = await (await page.request.get('/catalog/products.json')).json() as Product[];
  const product = catalog.find(item => item.handle === 'chrome-sticker')!;
  const initial = newPlayer(); initial.settings.tutorialSeen = true; initial.settings.tutorialHintsSeen = ['controls', 'ramp', 'police', 'radar', 'traffic', 'signs'];
  await page.addInitScript(player => {
    if (!localStorage.getItem('pfusch:player:v1')) localStorage.setItem('pfusch:player:v1', JSON.stringify(player));
    window.stickerScenes = [];
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', event => {
      const item = (event as CustomEvent).detail;
      if (item.isScene) window.stickerScenes.push(item);
    });
  }, initial);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openSticker(page, 'Helm', product);
  await checkWorkshopScroll(page, { width: 390, height: 844 });
  await checkWorkshopScroll(page, { width: 320, height: 568 });
  await page.setViewportSize({ width: 390, height: 844 });
  const before = await saved(page);
  await expect(footerAction(page)).toHaveText('Sticker platzieren');
  await expect(footerAction(page)).toBeDisabled();
  // The controls are intentionally open in the restored workshop.
  await expect(page.locator('.sticker-settings')).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Stickergröße' })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Stickerdrehung' })).toBeVisible();
  const size = page.locator('input[aria-label="Stickergröße"]');
  await expect(size).toHaveValue('0.09');
  await expect(page.locator('.sticker-targets').getByRole('button', { name: 'HELM', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await placeOnSurface(page);
  await expect(placedButtons(page)).toHaveCount(1);
  await expect(footerAction(page)).toHaveText(`Für ${digitalPrice(product)} Coins kaufen & speichern`);
  expect(await saved(page)).toEqual(before);
  await expect(page.getByRole('button', { name: 'Sticker größer machen' })).toBeVisible();
  await size.press('ArrowRight');
  await size.press('ArrowRight');
  await size.press('ArrowRight');
  await expect(size).toHaveValue('0.12');
  await page.getByRole('button', { name: '+ WEITERER STICKER', exact: true }).click();
  await expect(size).toHaveValue('0.09');
  await placedButtons(page).first().click();
  await expect(size).toHaveValue('0.12');
  await page.getByRole('button', { name: 'Ausgewählten Sticker duplizieren', exact: true }).click();
  await expect(placedButtons(page)).toHaveCount(2);
  await expect(footerAction(page)).toHaveText(`Für ${digitalPrice(product)} Coins kaufen & speichern`);
  expect(await saved(page)).toEqual(before);

  await page.locator('.sticker-targets').getByRole('button', { name: 'MOTORRAD', exact: true }).click();
  await expect(size).toHaveValue('0.09');
  await expect(placedButtons(page)).toHaveCount(0);
  await placeOnSurface(page);
  await expect(placedButtons(page)).toHaveCount(1);
  await page.locator('.sticker-targets').getByRole('button', { name: 'HELM', exact: true }).click();
  await expect(placedButtons(page)).toHaveCount(2);
  await page.locator('.sticker-targets').getByRole('button', { name: 'MOTORRAD', exact: true }).click();
  await expect(placedButtons(page)).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => {
    let decals = 0;
    window.stickerScenes.at(-1)?.traverse(object => { if (object.userData.bikeSticker) decals += 1; });
    return decals;
  })).toBeGreaterThanOrEqual(2);
  expect(await saved(page)).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await footerAction(page).scrollIntoViewIfNeeded();
  const actionBox = (await footerAction(page).boundingBox())!;
  expect(actionBox.height).toBeGreaterThanOrEqual(44);
  expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: test.info().outputPath('sticker-workshop-mobile.png') });
  // Two immediate events must still produce only one complete local transaction.
  await footerAction(page).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(page.locator('.sticker-workshop')).toHaveCount(0);
  const confirmed = await saved(page);
  expect(confirmed.coins).toBe(before.coins - digitalPrice(product));
  expect(confirmed.ownedItems.filter(id => id === product.id)).toHaveLength(1);
  expect(confirmed.stickers['125']).toHaveLength(1);
  expect(confirmed.stickers['helmet:fullface']).toHaveLength(2);
  const [original, copy] = confirmed.stickers['helmet:fullface'];
  expect(copy.id).not.toBe(original.id);
  expect(copy).toEqual({ ...original, id: copy.id });
  expect(confirmed.stickers['125'][0].size).toBe(0.09);
  expect(confirmed.stickers['helmet:fullface'][0].size).toBe(0.12);
  expect(confirmed.helmetColor).toBe(before.helmetColor);
  expect(confirmed.helmetVisor).toBe(before.helmetVisor);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await openSticker(page, 'Helm', product);
  expect((await saved(page)).stickers).toEqual(confirmed.stickers);
  await expect(placedButtons(page)).toHaveCount(2);
  await placedButtons(page).first().click();
  await expect(size).toHaveValue('0.12');
  await page.getByRole('button', { name: 'Ausgewählten Sticker entfernen', exact: true }).click();
  await expect(placedButtons(page)).toHaveCount(1);
  await placedButtons(page).first().click();
  await page.getByRole('button', { name: 'Ausgewählten Sticker entfernen', exact: true }).click();
  await expect(placedButtons(page)).toHaveCount(0);
  await expect(size).toHaveValue('0.09');
  await expect(footerAction(page)).toHaveText('Speichern');
  await footerAction(page).click();
  const removed = await saved(page);
  expect(removed.coins).toBe(confirmed.coins);
  expect(removed.stickers['helmet:fullface']).toEqual([]);
  expect(removed.stickers['125']).toEqual(confirmed.stickers['125']);
  expect(errors).toEqual([]);
});
