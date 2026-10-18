import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function dashboard(page: Page, options: { readonly?: boolean; conflict?: boolean; forbidden?: boolean } = {}) {
  const source = await readFile(new URL('../../server/oxygen/adminDashboard.ts', import.meta.url), 'utf8');
  const template = source.match(/const html = String\.raw`([\s\S]+?)`\.replace\('__API_KEY__'/)?.[1];
  if (!template) throw new Error('Dashboard template not found');
  const writes: { id: string; price: number | null; expected: string | null }[] = [];
  const products = [
    { id: 'flag-id', title: 'PFUSCH Flagge', category: 'cape', shopPrice: 35, currency: 'CHF', defaultPrice: 5000, editable: true },
    { id: 'shirt-id', title: 'PFUSCH Shirt', category: 'upper', shopPrice: 30, currency: 'CHF', defaultPrice: 120, editable: true },
  ];
  const prices: Record<string, number> = { 'shirt-id': 75 };
  let digest = 'a'.repeat(64);
  await page.route('**/admin', route => route.fulfill({ contentType: 'text/html', body: template.replace('__API_KEY__', 'test-app') }));
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', route => route.fulfill({
    contentType: 'application/javascript', body: 'window.shopify={idToken:async()=>"test-staff-token"};',
  }));
  await page.route('**/api/admin/**', async route => {
    const request = route.request(), url = new URL(request.url());
    expect(request.headers().authorization).toBe('Bearer test-staff-token');
    if (url.pathname === '/api/admin/prices') {
      if (request.method() === 'POST') {
        const body = request.postDataJSON() as typeof writes[number];
        writes.push(body);
        if (options.forbidden) { await route.fulfill({ status: 403, json: { error: 'admin_editor_not_authorized' } }); return; }
        if (options.conflict) {
          prices['flag-id'] = 7000; digest = 'b'.repeat(64);
          await route.fulfill({ status: 409, json: { error: 'game_price_conflict_reload' } }); return;
        }
        if (body.price === null) delete prices[body.id]; else prices[body.id] = body.price;
        digest = 'b'.repeat(64);
        await route.fulfill({ json: { changed: body.id, prices, digest } }); return;
      }
      await route.fulfill({ json: { products, prices, digest, editor: !options.readonly } }); return;
    }
    if (url.pathname === '/api/admin/overview') {
      await route.fulfill({ json: { shop: 'PFUSCH Test', statistics: [], metrics: { players: 0, runs: 0, verifiedPoints: 0 } } }); return;
    }
    if (url.searchParams.has('catalog')) { await route.fulfill({ json: { catalog: null } }); return; }
    await route.fulfill({ json: { editor: true, staffId: '12345', rows: [], more: false, cursor: null } });
  });
  await page.goto('/admin');
  await page.locator('#pricesPanel > summary').click();
  await expect(page.getByLabel('Produktpreis auswählen')).toHaveValue('flag-id');
  return { writes, prices };
}

test('edits and resets the flag coin price through the shared product prices on a narrow screen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { writes, prices } = await dashboard(page);
  const input = page.getByLabel('Spielpreis in Coins', { exact: true });
  const save = page.getByRole('button', { name: 'Preis speichern', exact: true });
  await expect(input).toHaveValue('5000');
  await input.fill('10001');
  await save.click();
  await expect(page.locator('#priceFeedback')).toContainText('0 bis 10000');
  expect(writes).toHaveLength(0);
  await input.fill('6250');
  await save.click();
  await expect(page.locator('#priceFeedback')).toContainText('Spielpreis gespeichert');
  expect(writes).toEqual([{ id: 'flag-id', price: 6250, expected: 'a'.repeat(64) }]);
  expect(prices).toEqual({ 'shirt-id': 75, 'flag-id': 6250 });
  await page.getByRole('button', { name: 'Neu laden', exact: true }).click();
  await expect(input).toHaveValue('6250');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dashboard-flag-price-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Standardpreis', exact: true }).click();
  await expect(input).toHaveValue('5000');
  expect(prices).toEqual({ 'shirt-id': 75 });
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(save).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('shows a stale-price conflict and reloads the current setting', async ({ page }) => {
  const { writes } = await dashboard(page, { conflict: true });
  const input = page.getByLabel('Spielpreis in Coins', { exact: true });
  await expect(input).toHaveValue('5000');
  await input.fill('6250');
  await page.getByRole('button', { name: 'Preis speichern', exact: true }).click();
  await expect(page.locator('#priceFeedback')).toHaveText('Die Spielpreise wurden inzwischen geändert. Bitte neu laden und erneut prüfen.');
  expect(writes).toHaveLength(1);
  await page.getByRole('button', { name: 'Neu laden', exact: true }).click();
  await expect(input).toHaveValue('7000');
});

test('keeps price controls disabled for staff with read-only access', async ({ page }) => {
  const { writes } = await dashboard(page, { readonly: true });
  await expect(page.locator('#priceFeedback')).toContainText('Nur Lesen');
  await expect(page.getByLabel('Spielpreis in Coins', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Preis speichern', exact: true })).toBeDisabled();
  expect(writes).toHaveLength(0);
});

test('shows a friendly error when write authorization is rejected', async ({ page }) => {
  await dashboard(page, { forbidden: true });
  await page.getByLabel('Spielpreis in Coins', { exact: true }).fill('6250');
  await page.getByRole('button', { name: 'Preis speichern', exact: true }).click();
  await expect(page.locator('#priceFeedback')).toHaveText('Für deinen Shopify-Zugang ist das Bearbeiten der Spielpreise nicht freigegeben.');
});
