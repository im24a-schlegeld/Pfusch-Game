import { expect, test, type Page } from '@playwright/test';
import { newPlayer } from '../../app/domain/progression';

// Account requests in this DOM fixture must stay on Playwright's mocked routes.
// Real offline caching is exercised separately by offline.spec.ts.
test.use({ serviceWorkers: 'block' });

async function prepareAccount(page: Page, options: { customer?: boolean; standalone?: boolean } = {}) {
  let customer = options.customer ?? true;
  const player = { ...newPlayer(), id: 'shopify:123' };
  await page.addInitScript(standalone => {
    // This test exercises menu DOM, without starting a WebGL renderer.
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type.includes('webgl')) return null;
      return Reflect.apply(original, this, [type, ...args]);
    } });
    if (standalone) Object.defineProperty(navigator, 'standalone', { value: true });
  }, options.standalone ?? false);
  await page.route('**/api/player', route => route.fulfill({
    status: customer ? 200 : 401,
    contentType: 'application/json',
    body: JSON.stringify(customer ? {
      customer: { id: '123' }, player, compareDigest: 'a'.repeat(64), csrfToken: 'test-csrf-token-for-account',
      storage: { allowed: true, reason: 'subscribed', completedRuns: 0, freeRuns: 5 },
      purchases: { items: [], available: true, history: 'all' },
    } : { error: 'login_required' }),
  }));
  // A logged-in garage prepares rewards in the background. An unmocked 401
  // would correctly expire the account and remove the post-login hint.
  await page.route('**/api/rewards/status', route => route.fulfill({
    status: customer ? 200 : 401,
    contentType: 'application/json',
    body: JSON.stringify(customer ? {
      available: false, reason: 'rewards_disabled', csrfToken: 'test-csrf-token-for-account',
      verifiedPoints: 0, verifiedRuns: 0, pointsRequired: 50000, runsRequired: 10,
      dailyPoints: 0, dailyCap: 10000, eligible: false, pending: false, reward: null,
    } : { error: 'login_required' }),
  }));
  await page.goto('/', { waitUntil: 'load' });
  return { login: () => { customer = true; } };
}

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`login return offers a dismissible app hint without covering garage controls at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await prepareAccount(page);
    await expect(page.getByRole('button', { name: 'Konto öffnen', exact: true })).toBeVisible();
    const hint = page.getByTestId('offline-install-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('sobald du wieder online bist');
    await expect(hint).toContainText('Safari');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const box = (await hint.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `outputs/browser-pwa/install-hint-${viewport.width}x${viewport.height}.png` });
    await hint.getByRole('button', { name: 'Installationshinweis schließen', exact: true }).click();
    await page.getByRole('button', { name: 'AUFGABEN', exact: true }).click();
    await page.getByRole('button', { name: 'GARAGE', exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(hint).toHaveCount(0);
  });
}

test('guest sees the hint only after account recovery and uses the browser install prompt when available', async ({ page }) => {
  const account = await prepareAccount(page, { customer: false });
  const hint = page.getByTestId('offline-install-hint');
  await expect(page.getByRole('link', { name: 'Anmelden', exact: true })).toBeVisible();
  await expect(hint).toHaveCount(0);
  account.login();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Konto öffnen', exact: true })).toBeVisible();
  await expect(hint).toBeVisible();
  await page.evaluate(() => {
    const host = window as Window & { installPromptCalls?: number };
    host.installPromptCalls = 0;
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, { prompt: async () => { host.installPromptCalls!++; }, userChoice: Promise.resolve({ outcome: 'accepted' }) });
    window.dispatchEvent(event);
  });
  await hint.getByRole('button', { name: 'INSTALLIEREN', exact: true }).click();
  expect(await page.evaluate(() => (window as Window & { installPromptCalls?: number }).installPromptCalls)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(hint).toHaveCount(0);
});

test('installed standalone app does not offer another installation', async ({ page }) => {
  await prepareAccount(page, { standalone: true });
  await expect(page.getByRole('button', { name: 'Konto öffnen', exact: true })).toBeVisible();
  await expect(page.getByTestId('offline-install-hint')).toHaveCount(0);
});
