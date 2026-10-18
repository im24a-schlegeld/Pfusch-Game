import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function dashboard(page: Page, options: { forbidden?: boolean; conflict?: boolean } = {}) {
  const source = await readFile(new URL('../../server/oxygen/adminDashboard.ts', import.meta.url), 'utf8');
  const template = source.match(/const html = String\.raw`([\s\S]+?)`\.replace\('__API_KEY__'/)?.[1];
  if (!template) throw new Error('Dashboard template not found');
  const writes: { version: number; flagCoinPrice: number; compareDigest: string | null }[] = [];
  let price = 5000, digest = 'a'.repeat(64);
  await page.route('**/admin', route => route.fulfill({ contentType: 'text/html', body: template.replace('__API_KEY__', 'test-app') }));
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', route => route.fulfill({
    contentType: 'application/javascript', body: 'window.shopify={idToken:async()=>"test-staff-token"};',
  }));
  await page.route('**/api/admin/**', async route => {
    const request = route.request(), url = new URL(request.url());
    expect(request.headers().authorization).toBe('Bearer test-staff-token');
    if (url.pathname === '/api/admin/economy') {
      if (options.forbidden) { await route.fulfill({ status: 403, json: { error: 'admin_editor_not_authorized' } }); return; }
      if (request.method() === 'POST') {
        const body = request.postDataJSON() as typeof writes[number];
        writes.push(body);
        if (options.conflict) {
          price = 7000; digest = 'b'.repeat(64);
          await route.fulfill({ status: 409, json: { error: 'edit_conflict_reload' } }); return;
        }
        price = body.flagCoinPrice; digest = 'b'.repeat(64);
      }
      await route.fulfill({ json: { version: 1, flagCoinPrice: price, compareDigest: digest } }); return;
    }
    if (url.pathname === '/api/admin/overview') {
      await route.fulfill({ json: { shop: 'PFUSCH Test', statistics: [], metrics: { players: 0, runs: 0, verifiedPoints: 0 } } }); return;
    }
    if (url.searchParams.has('catalog')) { await route.fulfill({ json: { catalog: null } }); return; }
    await route.fulfill({ json: { editor: true, staffId: '12345', rows: [], more: false, cursor: null } });
  });
  await page.goto('/admin');
  await page.locator('#economyPanel > summary').click();
  return writes;
}

test('edits the global flag coin price without selecting a customer on a narrow screen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes = await dashboard(page);
  const input = page.getByLabel('Flagge · Preis in Coins', { exact: true });
  const save = page.getByRole('button', { name: 'Flaggenpreis speichern', exact: true });
  await expect(input).toHaveValue('5000');
  await input.fill('0');
  await save.click();
  await expect(page.locator('#economyFeedback')).toContainText('ganze Zahl zwischen 1');
  expect(writes).toHaveLength(0);
  await input.fill('6250');
  await save.click();
  await expect(page.locator('#economyFeedback')).toContainText('Flaggenpreis gespeichert');
  expect(writes).toEqual([{ version: 1, flagCoinPrice: 6250, compareDigest: 'a'.repeat(64) }]);
  await page.getByRole('button', { name: 'Preis neu laden', exact: true }).click();
  await expect(input).toHaveValue('6250');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dashboard-economy-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(save).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('shows a stale-price conflict and reloads the current setting', async ({ page }) => {
  const writes = await dashboard(page, { conflict: true });
  const input = page.getByLabel('Flagge · Preis in Coins', { exact: true });
  await expect(input).toHaveValue('5000');
  await input.fill('6250');
  await page.getByRole('button', { name: 'Flaggenpreis speichern', exact: true }).click();
  await expect(page.locator('#economyFeedback')).toHaveText('Der Flaggenpreis wurde inzwischen geändert. Bitte Preis neu laden und erneut prüfen.');
  expect(writes).toHaveLength(1);
  await page.getByRole('button', { name: 'Preis neu laden', exact: true }).click();
  await expect(input).toHaveValue('7000');
});

test('keeps price controls disabled when staff authorization is denied', async ({ page }) => {
  const writes = await dashboard(page, { forbidden: true });
  await expect(page.locator('#economyFeedback')).toHaveText('Für deinen Shopify-Zugang ist das Bearbeiten der Spielpreise nicht freigegeben.');
  await expect(page.getByLabel('Flagge · Preis in Coins', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Flaggenpreis speichern', exact: true })).toBeDisabled();
  expect(writes).toHaveLength(0);
});
