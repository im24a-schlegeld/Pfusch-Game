import { expect, test } from '@playwright/test';
import { newPlayer } from '../../app/domain/progression';

test('returning to a cached game refreshes identity and restores the settings login without losing the account save', async ({ page }) => {
  let mode: 'customer' | 'guest' | 'offline' = 'customer';
  const player = { ...newPlayer(), id: 'shopify:123', coins: 432 };
  await page.route(url => url.pathname === '/', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('</head>',
      '<script type="application/json" id="pfusch-runtime-config">{"version":1,"mode":"oxygen"}</script></head>') });
  });
  await page.route('**/app/game/SceneView.tsx*', route => route.fulfill({
    contentType: 'application/javascript', body: 'export default function SceneView(){return null;}',
  }));
  await page.route('**/api/rewards/**', route => route.fulfill({ status: 503, json: { error: 'service_unavailable' } }));
  await page.route('**/api/player', route => route.fulfill(mode === 'customer'
    ? { json: { customer: { id: '123' }, player, compareDigest: 'a'.repeat(64), csrfToken: 'account-return-test-only',
      storage: { allowed: true, reason: 'subscribed', completedRuns: 0, freeRuns: 5 } } }
    : { status: mode === 'guest' ? 401 : 503, json: { error: mode === 'guest' ? 'login_required' : 'customer_account_unavailable' } }));
  await page.goto('/');
  const account = page.getByRole('button', { name: 'Konto öffnen', exact: true });
  await account.click({ timeout: 60000 });
  const login = page.getByRole('link', { name: 'MIT PFUSCH-KONTO ANMELDEN', exact: true });
  await expect(login).toHaveCount(0);

  mode = 'offline';
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(page.getByText('Shop-Freigabe nicht erreichbar. Status erneut prüfen.', { exact: true })).toBeVisible();
  await expect(account).toBeVisible();
  await expect(login).toHaveCount(0);

  mode = 'guest';
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(page.getByRole('link', { name: 'Anmelden', exact: true })).toBeVisible();
  await expect(login).toBeVisible();
  await expect(page.locator('.top-right .coin')).toContainText('432');
  await expect(page.getByRole('button', { name: 'SPIELSTAND EXPORTIEREN', exact: true })).toBeVisible();

  mode = 'customer';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(account).toBeVisible();
  await expect(login).toHaveCount(0);
  await expect(page.locator('.top-right .coin')).toContainText('432');
});
