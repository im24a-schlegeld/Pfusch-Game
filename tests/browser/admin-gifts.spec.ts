import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

interface GiftBody { id: string; field: string; value: { id: string; kind: string; amount: number; message: string } }
const shop = 'gift-browser-tests.myshopify.com';
async function dashboard(page: Page, options: { failRefresh?: boolean; loseFirstResponse?: boolean; editor?: boolean; empty?: boolean } = {}) {
  const sent: GiftBody[] = [], tokens: string[] = [];
  const credited = new Set<string>();
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
    if (url.searchParams.has('catalog')) { await route.fulfill({ json: { catalog: null } }); return; }
    if (url.searchParams.has('id')) { await route.fulfill({ json: { id: '77', player: null } }); return; }
    if (options.failRefresh && sent.length) { await route.fulfill({ status: 503, json: { error: 'refresh_unavailable' } }); return; }
    if (url.pathname === '/api/admin/overview') {
      await route.fulfill({ json: { shop, statistics: [], metrics: { players: 0, runs: 0, verifiedPoints: 0 } } });
      return;
    }
    await route.fulfill({ json: { editor: options.editor !== false, staffId: '12345', rows: options.empty ? [] : [
      { id: '77', name: 'Test Rider', email: 'rider@example.invalid', player: null, online: false },
    ], more: false, cursor: null } });
  });
  await page.goto('/admin');
  if (!options.empty) await page.getByRole('button', { name: 'Test Rider', exact: true }).click();
  return { sent, credited, tokens };
}

test('sends bounded Coins or Guardian Bells with the Shopify staff token', async ({ page }) => {
  const server = await dashboard(page);
  const form = page.getByRole('region', { name: 'Geschenk senden' });
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
  expect(server.sent[1]).toMatchObject({ value: { kind: 'guardianBells', amount: 5, message: '' } });
  expect(server.tokens.every(token => token === 'Bearer test-staff-id-token')).toBe(true);
});

test('keeps a delivered gift successful when the following dashboard refresh fails', async ({ page }) => {
  const server = await dashboard(page, { failRefresh: true });
  await page.getByRole('region', { name: 'Geschenk senden' }).getByRole('button', { name: 'Geschenk senden', exact: true }).click();
  await expect(page.locator('#message')).toContainText('refresh_unavailable');
  await expect(page.locator('#giftFeedback')).toHaveText('Geschenk gesendet: +100 Coins.');
  await expect(page.locator('#giftFeedback')).toHaveClass('success');
  expect(server.sent).toHaveLength(1);
  expect(server.credited.size).toBe(1);
});

test('retries an uncertain send with its original gift ID', async ({ page }) => {
  const server = await dashboard(page, { loseFirstResponse: true });
  const send = page.getByRole('region', { name: 'Geschenk senden' }).getByRole('button', { name: 'Geschenk senden', exact: true });
  await send.click();
  await expect(page.locator('#giftFeedback')).toHaveClass('error');
  await send.click();
  await expect(page.locator('#giftFeedback')).toHaveText('Geschenk gesendet: +100 Coins.');
  expect(server.sent).toHaveLength(2);
  expect(server.sent[1].value.id).toBe(server.sent[0].value.id);
  expect(server.credited.size).toBe(1);
});

test('organizes players, sample statistics and system details in keyboard-accessible tabs', async ({ page }, testInfo) => {
  await dashboard(page);
  const players = page.getByRole('tab', { name: 'Spieler', exact: true });
  await expect(players).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Test Rider', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await players.focus();
  await page.keyboard.press('ArrowRight');
  const statistics = page.getByRole('tab', { name: 'Statistik', exact: true });
  await expect(statistics).toBeFocused();
  await expect(statistics).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Statistik', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Geschenk senden' })).toBeHidden();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'System', exact: true })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'System', exact: true })).toContainText('12345');
  await page.keyboard.press('Home');
  await expect(players).toBeFocused();
  await expect(page.getByRole('region', { name: 'Geschenk senden' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('dashboard-desktop.png'), fullPage: true });
});

test('keeps player details and gift controls readable on a narrow mobile viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await dashboard(page);
  await expect(page.getByRole('heading', { name: 'Test Rider', exact: true })).toBeVisible();
  await expect(page.getByLabel('Menge', { exact: true })).toHaveAccessibleDescription(/1.*2.*000/);
  await page.getByLabel('Geschenk', { exact: true }).selectOption('guardianBells');
  await expect(page.getByLabel('Menge', { exact: true })).toHaveAccessibleDescription(/1.*5/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dashboard-mobile.png'), fullPage: true });
});

test('explains read-only access and disables gift mutations', async ({ page }) => {
  const server = await dashboard(page, { editor: false });
  await expect(page.getByRole('region', { name: 'Geschenk senden' }).getByRole('button', { name: 'Geschenk senden', exact: true })).toBeDisabled();
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
