import { expect, test, type Page } from '@playwright/test';

const progress = { available: true, csrfToken: 'test-only', verifiedPoints: 1234, verifiedRuns: 2,
  pointsRequired: 50000, runsRequired: 10, dailyPoints: 1234, dailyCap: 10000, eligible: false, pending: false, reward: null };
const shopifyLogin = 'https://account.pfusch-clothing.ch/authentication/login?client_id=test-only';

async function returnToGame(page: Page, event: 'focus' | 'pageshow' | 'visibilitychange' = 'focus') {
  await page.clock.fastForward(1100);
  await page.evaluate(name => {
    (name === 'visibilitychange' ? document : window).dispatchEvent(new Event(name));
  }, event);
}

async function mockLogin(page: Page) {
  // Use a fresh browser navigation, so Playwright can also intercept the
  // destination. A fulfilled HTTP redirect can bypass its destination route.
  await page.route('**/auth/login?**', route => route.fulfill({ contentType: 'text/html',
    body: `<!doctype html><html><body><script>location.replace(${JSON.stringify(shopifyLogin)})</script></body></html>` }));
  await page.route('https://account.pfusch-clothing.ch/**', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><body><h1>Shopify-Konto anmelden</h1></body></html>',
  }));
}

test('reward status recovers automatically on return and separates login, configuration and connection errors', async ({ page }) => {
  let response: unknown = { error: 'not_configured' }, httpStatus = 503, offline = false;
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  await page.route('**/api/rewards/**', async route => {
    requests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    if (offline) await route.abort('internetdisconnected');
    else await route.fulfill({ status: httpStatus, contentType: 'application/json', body: JSON.stringify(response) });
  });
  await page.goto('/tests/browser/fixtures/real-reward.html');
  const card = page.locator('.real-reward');
  const retry = page.getByRole('button', { name: 'ERNEUT PRÜFEN' });
  await expect(retry).toHaveCount(0);
  await expect(card).toContainText('auf dem Spielserver noch nicht eingerichtet');
  await expect(card).not.toContainText('melde dich');
  await expect(card).not.toContainText('Shop-Belohnungen sind noch nicht verfügbar');

  httpStatus = 401; response = { error: 'login_required' };
  await returnToGame(page);
  await expect(card).toContainText('Bitte melde dich im Spiel an');
  await expect(card).not.toContainText('noch nicht eingerichtet');
  await expect(page.getByRole('link', { name: 'IM SPIEL ANMELDEN' })).toHaveAttribute('href', /^\/auth\/login\?return_to=/);

  httpStatus = 503; response = { error: 'admin_unavailable' };
  await returnToGame(page, 'pageshow');
  await expect(card).toContainText('Rabattdienst ist vorübergehend nicht erreichbar');
  await expect(card).not.toContainText('melde dich');
  await expect(page.getByRole('link', { name: 'IM SPIEL ANMELDEN' })).toHaveCount(0);

  offline = true;
  await returnToGame(page, 'visibilitychange');
  await expect(card).toContainText('Verbindung zum Rabattdienst ist unterbrochen');
  await expect(card).not.toContainText('melde dich');

  offline = false; httpStatus = 200;
  response = { ...progress, available: false, reason: 'rewards_disabled' };
  await returnToGame(page);
  await expect(card).toContainText('Shop-Rabatte sind derzeit deaktiviert.');
  await expect(card).not.toContainText('melde dich');
  await expect(page.getByRole('link', { name: 'IM SPIEL ANMELDEN' })).toHaveCount(0);
  response = progress;
  const beforeRefresh = requests.length;
  await returnToGame(page);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(card).toContainText('2 / 10 bestätigte Fahrten');
  expect(requests).toHaveLength(beforeRefresh + 1);
  await expect(card).not.toContainText('Verbindung zum Rabattdienst ist unterbrochen');
  await expect(page.getByRole('button', { name: 'NOCH NICHT FREIGESCHALTET' })).toBeDisabled();

  httpStatus = 401; response = { error: 'login_required' };
  await returnToGame(page);
  await expect(card).toContainText('Bitte melde dich im Spiel an');
  await expect(card).not.toContainText('2 / 10 bestätigte Fahrten');
  await expect(card.getByRole('button')).toHaveCount(0);
  response = progress; httpStatus = 200;
  await page.reload();
  await expect(card).toContainText('2 / 10 bestätigte Fahrten');
  expect(requests.every(request => request === 'GET /api/rewards/status')).toBe(true);
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`actual rewards screen has one working login link and no redundant footer at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const rewardRequests: string[] = [];
    await page.route('**/api/rewards/**', route => {
      rewardRequests.push(route.request().method());
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"login_required"}' });
    });
    await mockLogin(page);
    await page.goto('/tests/browser/fixtures/real-reward.html?view=rewards');
    const card = page.locator('.real-reward');
    await expect(card).toContainText('Bitte melde dich im Spiel an');
    await expect(page.getByRole('button', { name: 'ERNEUT PRÜFEN' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'ZUR GARAGE', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Zurück zur Garage', exact: true })).toBeVisible();
    const login = card.getByRole('link', { name: 'IM SPIEL ANMELDEN' });
    await expect(login).toHaveCount(1);
    await login.scrollIntoViewIfNeeded();
    const box = await login.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `outputs/shop-reward-login-${viewport.width}.png` });
    await login.click();
    await expect(page).toHaveURL(shopifyLogin);
    await expect(page.getByRole('heading', { name: 'Shopify-Konto anmelden' })).toBeVisible();
    expect(page.context().pages()).toHaveLength(1);
    expect(rewardRequests).toEqual(['GET']);
  });

  test(`save-access popup login is reachable and navigates above the dialog at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockLogin(page);
    await page.goto('/tests/browser/fixtures/real-reward.html?view=gate');
    const dialog = page.getByRole('dialog');
    const login = dialog.getByRole('link', { name: 'MIT PFUSCH-KONTO ANMELDEN' });
    await expect(dialog).toBeVisible();
    await expect(login).toHaveAttribute('target', '_top');
    await login.scrollIntoViewIfNeeded();
    const box = await login.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `outputs/save-access-login-${viewport.width}.png` });
    await login.click();
    await expect(page).toHaveURL(shopifyLogin);
    await expect(page.getByRole('heading', { name: 'Shopify-Konto anmelden' })).toBeVisible();
    expect(page.context().pages()).toHaveLength(1);
  });
}

test('reward login retains callback support when no OAuth link is available', async ({ page }) => {
  await page.route('**/api/rewards/status', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"login_required"}' }));
  await page.goto('/tests/browser/fixtures/real-reward.html?view=fallback');
  await page.getByRole('button', { name: 'IM SPIEL ANMELDEN' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-sign-in', 'requested');
});

test('popup OAuth link leaves an embedded game at the top level', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLogin(page);
  await page.goto('/tests/browser/fixtures/real-reward.html?view=gate');
  await page.setContent('<!doctype html><html><body style="margin:0"><iframe title="PFUSCH-Spiel" src="/tests/browser/fixtures/real-reward.html?view=gate" style="border:0;width:100%;height:100vh"></iframe></body></html>');
  await page.frameLocator('iframe').getByRole('link', { name: 'MIT PFUSCH-KONTO ANMELDEN' }).click();
  await expect(page).toHaveURL(shopifyLogin);
  await expect(page.getByRole('heading', { name: 'Shopify-Konto anmelden' })).toBeVisible();
  expect(page.context().pages()).toHaveLength(1);
});
