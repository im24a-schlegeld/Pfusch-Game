import { expect, test } from '@playwright/test';

test('reward status separates login, configuration and connection errors and can recover', async ({ page }) => {
  let response: unknown = { error: 'not_configured' }, httpStatus = 503, offline = false;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/rewards/**', async route => {
    expect(route.request().method()).toBe('GET');
    if (offline) await route.abort('internetdisconnected');
    else await route.fulfill({ status: httpStatus, contentType: 'application/json', body: JSON.stringify(response) });
  });
  await page.goto('/tests/browser/fixtures/real-reward.html');
  const card = page.locator('.real-reward');
  const retry = page.getByRole('button', { name: 'ERNEUT PRÜFEN' });
  await expect(card).toContainText('auf dem Spielserver noch nicht eingerichtet');
  await expect(card).not.toContainText('melde dich');
  await expect(card).not.toContainText('Shop-Belohnungen sind noch nicht verfügbar');

  httpStatus = 401; response = { error: 'login_required' };
  await retry.click();
  await expect(card).toContainText('Bitte melde dich im Spiel an');
  await expect(card).not.toContainText('noch nicht eingerichtet');
  await page.getByRole('button', { name: 'IM SPIEL ANMELDEN' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-sign-in', 'requested');

  httpStatus = 503; response = { error: 'admin_unavailable' };
  await retry.click();
  await expect(card).toContainText('Rabattdienst ist vorübergehend nicht erreichbar');
  await expect(card).not.toContainText('melde dich');
  await expect(page.getByRole('button', { name: 'IM SPIEL ANMELDEN' })).not.toBeVisible();

  offline = true;
  await retry.click();
  await expect(card).toContainText('Verbindung zum Rabattdienst ist unterbrochen');
  await expect(card).not.toContainText('melde dich');

  offline = false; httpStatus = 200;
  const progress = { available: true, csrfToken: 'test-only', verifiedPoints: 1234, verifiedRuns: 2,
    pointsRequired: 50000, runsRequired: 10, dailyPoints: 1234, dailyCap: 10000, eligible: false, pending: false, reward: null };
  response = { ...progress, available: false, reason: 'rewards_disabled' };
  await retry.click();
  await expect(card).toContainText('Shop-Rabatte sind derzeit deaktiviert.');
  await expect(card).not.toContainText('melde dich');
  await expect(page.getByRole('button', { name: 'IM SPIEL ANMELDEN' })).not.toBeVisible();
  response = progress;
  await page.reload();
  await expect(card).toContainText('2 / 10 bestätigte Fahrten');
  await expect(card).not.toContainText('Verbindung zum Rabattdienst ist unterbrochen');
  await expect(page.getByRole('button', { name: 'NOCH NICHT FREIGESCHALTET' })).toBeDisabled();
  await expect(retry).not.toBeVisible();
  expect(errors).toEqual([]);
});
