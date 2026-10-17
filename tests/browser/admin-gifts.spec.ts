import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

interface GiftBody { id: string; field: string; value: { id: string; kind: string; amount: number; message: string } }
const shop = 'gift-browser-tests.myshopify.com';
async function dashboard(page: Page, options: { failRefresh?: boolean; loseFirstResponse?: boolean; editor?: boolean; empty?: boolean; withSave?: boolean } = {}) {
  const sent: GiftBody[] = [], tokens: string[] = [];
  const credited = new Set<string>();
  const player = options.withSave ? { coins: 100, xp: 0, level: 1, runs: 3, runsPlayed: 3, highScore: 100,
    totalDistance: 500, totalNearMisses: 0, totalWheelieMeters: 0, guardianBells: { earned: 0, spent: 0 },
    ownedItems: [], equipped: {}, variants: {}, stickers: {} } : null;
  // Exercise the production raw HTML shell without importing server GraphQL adapters into Playwright.
  const source = await readFile(new URL('../../server/oxygen/adminDashboard.ts', import.meta.url), 'utf8');
  const template = source.match(/const html = String\.raw`([\s\S]+?)`\.replace\('__API_KEY__'/)?.[1];
  if (!template) throw new Error('Dashboard template not found');
  const html = template.replace('__API_KEY__', 'test-app-key');
  await page.route('**/admin', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', route => route.fulfill({
    contentType: 'application/javascript', body: 'window.shopify={idToken:async()=>"test-staff-id-token"};',
  }));
  await page.route('**/api/admin/**', async route => {
    const request = route.request(), url = new URL(request.url());
    tokens.push(request.headers().authorization ?? '');
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as GiftBody;
      sent.push(body); credited.add(body.value.id);
      if (options.loseFirstResponse && sent.length === 1) { await route.abort('failed'); return; }
      await route.fulfill({ json: { changed: 'gift', gift: body.value, duplicate: sent.length > credited.size } });
      return;
    }
    if (url.searchParams.has('catalog')) { await route.fulfill({ json: { catalog: options.withSave ? {
      bikes: [], paint: [], rims: [], helmets: [], helmetColor: [], helmetVisor: [], pantsColor: [], shoesColor: [], products: [],
    } : null } }); return; }
    if (url.searchParams.has('id')) { await route.fulfill({ json: { id: '77', player } }); return; }
    if (options.failRefresh && sent.length) { await route.fulfill({ status: 503, json: { error: 'refresh_unavailable' } }); return; }
    if (url.pathname === '/api/admin/overview') {
      await route.fulfill({ json: { shop, statistics: [], metrics: { players: 0, runs: 0, verifiedPoints: 0 } } });
      return;
    }
    await route.fulfill({ json: { editor: options.editor !== false, staffId: '12345', rows: options.empty ? [] : [
      { id: '77', name: 'Test Rider', email: 'rider@example.invalid', player, online: false },
    ], more: false, cursor: null } });
  });
  await page.goto('/admin');
  if (!options.empty) await page.getByRole('button', { name: 'Test Rider', exact: true }).click();
  return { sent, credited, tokens };
}

async function openGift(page: Page) {
  await page.locator('#giftSection > summary').click();
  return page.getByRole('region', { name: 'Geschenk senden' });
}

test('sends bounded Coins or Guardian Bells with the Shopify staff token', async ({ page }) => {
  const server = await dashboard(page);
  const form = await openGift(page);
  await expect(form).toBeVisible();
  await page.getByLabel('Menge', { exact: true }).fill('2000');
  await page.getByLabel('Nachricht (optional, max. 80 Zeichen)', { exact: true }).fill('x'.repeat(80));
  await form.getByRole('button', { name: 'Geschenk senden', exact: true }).click();
  const amount = await page.evaluate(() => new Intl.NumberFormat('de-CH').format(2000));
  await expect(page.locator('#giftFeedback')).toHaveText(`Geschenk gesendet: +${amount} Coins.`);
  expect(server.sent[0]).toMatchObject({ id: '77', field: 'gift', value: { kind: 'coins', amount: 2000, message: 'x'.repeat(80) } });
  await page.getByLabel('Geschenk', { exact: true }).selectOption('guardianBells');
  await expect(page.getByLabel('Menge', { exact: true })).toHaveAttribute('max', '5');
  await page.getByLabel('Menge', { exact: true }).fill('6');
  await form.getByRole('button', { name: 'Geschenk senden', exact: true }).click();
  await expect(page.locator('#giftFeedback')).toContainText('zwischen 1 und 5');
  expect(server.sent).toHaveLength(1);
  await page.getByLabel('Menge', { exact: true }).fill('5');
  await form.getByRole('button', { name: 'Geschenk senden', exact: true }).click();
  await expect(page.locator('#giftFeedback')).toHaveText('Geschenk gesendet: +5 Guardian Bells.');
  await expect(page.locator('#giftSection')).toHaveJSProperty('open', true);
  expect(server.sent[1]).toMatchObject({ value: { kind: 'guardianBells', amount: 5, message: '' } });
  expect(server.tokens.every(token => token === 'Bearer test-staff-id-token')).toBe(true);
});

test('keeps a delivered gift successful when the following dashboard refresh fails', async ({ page }) => {
  const server = await dashboard(page, { failRefresh: true });
  const form = await openGift(page);
  await form.getByRole('button', { name: 'Geschenk senden', exact: true }).click();
  await expect(page.locator('#message')).toContainText('refresh_unavailable');
  await expect(page.locator('#giftFeedback')).toHaveText('Geschenk gesendet: +100 Coins.');
  await expect(page.locator('#giftFeedback')).toHaveClass('success');
  expect(server.sent).toHaveLength(1);
  expect(server.credited.size).toBe(1);
});

test('retries an uncertain send with its original gift ID', async ({ page }) => {
  const server = await dashboard(page, { loseFirstResponse: true });
  const send = (await openGift(page)).getByRole('button', { name: 'Geschenk senden', exact: true });
  await send.click();
  await expect(page.locator('#giftFeedback')).toHaveClass('error');
  await send.click();
  await expect(page.locator('#giftFeedback')).toHaveText('Geschenk gesendet: +100 Coins.');
  expect(server.sent).toHaveLength(2);
  expect(server.sent[1].value.id).toBe(server.sent[0].value.id);
  expect(server.credited.size).toBe(1);
});

test('opens native disclosures with the keyboard and preserves them across refresh', async ({ page }, testInfo) => {
  await dashboard(page, { withSave: true });
  await expect(page.getByRole('button', { name: 'Test Rider', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const id of ['giftSection', 'valuesSection', 'garageEditor', 'statisticsPanel', 'systemPanel']) {
    await expect(page.locator('#' + id)).toHaveJSProperty('open', false);
  }
  await expect(page.getByRole('tab')).toHaveCount(0);
  const statistics = page.locator('#statisticsPanel > summary');
  await statistics.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#statisticsTopic')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.locator('#statisticsTopic')).toBeHidden();
  await page.locator('#systemPanel > summary').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#staff')).toHaveText('12345');
  await expect(page.locator('#staff')).toBeVisible();
  await page.locator('#valuesSection > summary').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#editCoins')).toBeVisible();
  await page.locator('#garageEditor > summary').click();
  await expect(page.locator('#inventorySearch')).toBeVisible();
  await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Aktualisieren', exact: true })).toBeEnabled();
  await expect(page.locator('#inventorySearch')).toBeVisible();
  for (const id of ['valuesSection', 'garageEditor', 'systemPanel']) {
    await expect(page.locator('#' + id)).toHaveJSProperty('open', true);
    await page.locator('#' + id + ' > summary').click();
  }
  await page.screenshot({ path: testInfo.outputPath('dashboard-desktop.png'), fullPage: true });
});

test('keeps mobile player details compact until an action is opened', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await dashboard(page, { withSave: true });
  await expect(page.getByRole('heading', { name: 'Test Rider', exact: true })).toBeVisible();
  await expect(page.locator('#giftAmount')).toBeHidden();
  await expect(page.locator('#editCoins')).toBeHidden();
  await expect(page.locator('#inventorySearch')).toBeHidden();
  await expect(page.locator('#live')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dashboard-mobile.png'), fullPage: true });
  await openGift(page);
  await expect(page.getByLabel('Menge', { exact: true })).toHaveAccessibleDescription(/1.*2.*000/);
  await page.getByLabel('Geschenk', { exact: true }).selectOption('guardianBells');
  await expect(page.getByLabel('Menge', { exact: true })).toHaveAccessibleDescription(/1.*5/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dashboard-mobile-gift.png'), fullPage: true });
});

test('explains read-only access and disables gift mutations', async ({ page }) => {
  const server = await dashboard(page, { editor: false });
  await expect((await openGift(page)).getByRole('button', { name: 'Geschenk senden', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Menge', { exact: true })).toBeDisabled();
  await expect(page.locator('#permissionHint')).toContainText('Nur Lesen');
  expect(server.sent).toHaveLength(0);
});

test('shows an actionable empty customer list', async ({ page }) => {
  await dashboard(page, { empty: true });
  await expect(page.locator('#users')).toContainText('Keine Kunden gefunden');
  await expect(page.getByRole('button', { name: 'Weitere Kunden', exact: true })).toBeDisabled();
  await expect(page.locator('#empty')).toContainText('Wähle');
});
