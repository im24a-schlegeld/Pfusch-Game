import { expect, test, type Page } from '@playwright/test';
import { newPlayer } from '../../app/domain/progression';
import { primaryAction } from './garage-helpers';
import { TUTORIAL_HINTS } from '../../app/domain/tutorial';

const gift = { id: '78ef760a-dc5d-4281-96d1-8263a070dc93', kind: 'coins', amount: 100,
  message: 'Viel Spass beim Fahren!', sentAt: '2026-10-16T18:00:00.000Z' };
async function account(page: Page, initialGift: boolean) {
  let pending = initialGift, acknowledged = 0;
  const player = { ...newPlayer(), id: 'shopify:123', coins: 600 };
  player.settings = { ...player.settings, tutorialSeen: true, tutorialHintsSeen: [...TUTORIAL_HINTS], quality: 'low', reducedMotion: true };
  await page.route(url => url.pathname === '/', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('</head>',
      '<script type="application/json" id="pfusch-runtime-config">{"version":1,"mode":"oxygen"}</script></head>') });
  });
  await page.route('**/api/rewards/**', route => route.fulfill({ status: 503, json: { error: 'service_unavailable' } }));
  await page.route('**/api/player', route => {
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
    if (body?.acknowledgedGiftIds) {
      acknowledged++;
      pending = false;
      return route.fulfill({ json: { acknowledgedGiftIds: [gift.id], gifts: [] } });
    }
    return route.fulfill({ json: { customer: { id: '123' }, player: body?.player ?? player,
      compareDigest: 'a'.repeat(64), csrfToken: 'gift-popup-test-csrf-token', gifts: pending ? [gift] : [],
      storage: { allowed: true, reason: 'subscribed', completedRuns: 0, freeRuns: 5 } } });
  });
  return { send: () => { pending = true; }, acknowledged: () => acknowledged };
}

test('shows a server gift for four seconds without another balance credit or a dismissal button', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-17T10:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-17T10:00:01Z'));
  await page.setViewportSize({ width: 390, height: 844 });
  const server = await account(page, true);
  await page.goto('/');
  const popup = page.getByRole('status').filter({ hasText: 'GESCHENK ERHALTEN' });
  await expect(popup).toBeVisible({ timeout: 60000 });
  await expect(popup).toContainText('+100 Coins');
  await expect(popup).toContainText(gift.message);
  await expect(popup.getByRole('button')).toHaveCount(0);
  await expect(page.locator('.top-right .coin')).toContainText('600');
  await page.clock.fastForward(2500);
  await expect(popup).toBeVisible();
  expect(server.acknowledged()).toBe(0);
  await page.clock.fastForward(1500);
  await expect(popup).toHaveCount(0);
  await expect.poll(server.acknowledged).toBe(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Konto öffnen', exact: true })).toBeVisible();
  await expect(popup).toHaveCount(0);
});

test('defers a gift received during a ride until the garage opens', async ({ page }) => {
  await page.clock.install();
  const server = await account(page, false);
  await page.goto('/');
  await primaryAction(page).click({ timeout: 60000 });
  await expect(page.getByTestId('ride-screen')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('ride-screen')).toHaveAttribute('data-phase', 'playing', { timeout: 60000 });
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  server.send();
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  const popup = page.getByRole('status').filter({ hasText: 'GESCHENK ERHALTEN' });
  await page.clock.fastForward(4500);
  await expect(popup).toHaveCount(0);
  expect(server.acknowledged()).toBe(0);
  await page.keyboard.press('Escape');
  // The clock is paused to measure popup lifetime; dispatch the mounted
  // button without waiting for a CSS transition's animation frames.
  await page.getByRole('button', { name: 'ZUR GARAGE', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await expect(popup).toBeVisible();
  await page.clock.fastForward(4000);
  await expect(popup).toHaveCount(0);
  await expect.poll(server.acknowledged).toBe(1);
});
