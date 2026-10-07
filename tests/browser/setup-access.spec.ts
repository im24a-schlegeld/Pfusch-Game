import { test, expect } from '@playwright/test';
import { newPlayer } from '../../app/domain/progression';

test('signed-in setup saving recovers after a shop outage and reports newsletter denial truthfully', async ({ page }) => {
  let mode: 'online' | 'offline' | 'newsletter' = 'online';
  let posts = 0;
  let account = { ...newPlayer(), id: 'shopify:123456', runsPlayed: 20 };
  let digest = 'a'.repeat(64);
  await page.route(url => url.pathname === '/', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('<head>',
      '<head><script type="application/json" id="pfusch-runtime-config">{"version":1,"mode":"oxygen"}</script>') });
  });
  // This regression exercises the real account adapter and setup dialog, not WebGL.
  await page.route('**/app/game/SceneView.tsx*', route => route.fulfill({
    contentType: 'application/javascript', body: 'export default function SceneView(){return null;}',
  }));
  await page.route('**/api/player', async route => {
    if (mode === 'offline') { await route.fulfill({ status: 503, json: { error: 'shopify_unavailable' } }); return; }
    if (route.request().method() === 'POST') {
      expect(mode).toBe('online');
      account = route.request().postDataJSON().player;
      digest = 'b'.repeat(64); posts++;
    }
    await route.fulfill({ json: { customer: { id: '123456' }, player: account,
      compareDigest: digest, csrfToken: 'csrf-token-for-browser-test-123456',
      storage: { allowed: mode === 'online', reason: mode === 'online' ? 'subscribed' : 'newsletter_required', completedRuns: 20, freeRuns: 5 } } });
  });
  await page.goto('/');
  const launch = page.getByRole('button', { name: 'Setups speichern und verwalten' });
  await expect(launch).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('button', { name: 'Sammlung', exact: true })).toHaveCount(0);
  mode = 'offline';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await launch.click();
  const dialog = page.getByRole('dialog'), name = dialog.getByLabel('AKTUELLES SETUP SPEICHERN');
  const save = dialog.getByRole('button', { name: 'SPEICHERN', exact: true });
  await name.fill('Mein Setup');
  await save.click();
  await expect(dialog.locator('.setup-message')).toContainText('Shop-Freigabe nicht erreichbar');
  await expect(name).toHaveValue('Mein Setup');
  expect(posts).toBe(0);
  mode = 'online';
  await save.click();
  await expect(dialog.locator('.setup-message')).toContainText('Im Konto gespeichert.');
  expect(posts).toBe(1);
  expect(account.savedSetups.map(setup => setup.name)).toEqual(['Mein Setup']);
  mode = 'newsletter';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await name.fill('Zweites Setup');
  await save.click();
  await expect(dialog.locator('.setup-message')).toContainText('Newsletter im Shop abonnieren');
  await expect(dialog.locator('.setup-message')).not.toContainText('anmelden');
  await expect(name).toHaveValue('Zweites Setup');
  expect(posts).toBe(1);
});
