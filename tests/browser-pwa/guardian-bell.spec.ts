import { expect, test } from '@playwright/test';
import { newPlayer } from '../../app/domain/progression';

test.use({ serviceWorkers: 'block' });

test('one Bell bursts, is saved before countdown, then continues the same ride once', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let player = { ...newPlayer(), id: 'shopify:123', guardianBells: { earned: 1, spent: 0, spentRunIds: [] as string[] } };
  player.settings.tutorialSeen = true;
  player.settings.tutorialHintsSeen = ['controls', 'ramp', 'police', 'radar', 'traffic', 'signs'];
  player.settings.muted = true;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Math.random = () => 5489 / 0xffffffff;
  });
  await page.route('**/api/player', route => {
    if (route.request().method() === 'POST') player = route.request().postDataJSON().player;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      customer: { id: '123' }, player, compareDigest: 'a'.repeat(64), csrfToken: 'test-csrf-token-for-account',
      storage: { allowed: true, reason: 'subscribed', completedRuns: player.runsPlayed, freeRuns: 5 },
      purchases: { items: [], available: true, history: 'all' },
    }) });
  });
  await page.route('**/api/rewards/status', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    available: false, reason: 'rewards_disabled', csrfToken: 'test-csrf-token-for-account',
    verifiedPoints: 0, verifiedRuns: 0, pointsRequired: 50000, runsRequired: 10,
    dailyPoints: 0, dailyCap: 10000, eligible: false, pending: false, reward: null,
  }) }));
  await page.route('**/api/referral', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ code: 'v1.abcdefghijklmnop.valid-test-signature', coins: 150, guardianBells: 1 }) }));
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.getByRole('button', { name: 'Konto öffnen', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Fahrt starten/i }).first().click();
  const ride = page.getByTestId('ride-screen');
  await expect(ride).toHaveAttribute('data-phase', 'playing');
  await page.keyboard.down('ArrowDown');
  await expect(ride).toHaveAttribute('data-phase', 'crashed', { timeout: 20000 });
  await page.keyboard.up('ArrowDown');
  await page.getByRole('button', { name: /1 BELL EINLÖSEN/ }).click();
  await expect(ride).toHaveAttribute('data-revives', '0');
  await expect(ride).toHaveAttribute('data-resume-countdown', '0');
  await expect(page.locator('.guardian-bell-burst')).toBeVisible();
  await page.screenshot({ path: 'outputs/browser-pwa/guardian-bell-burst-mobile.png' });
  await expect.poll(() => player.guardianBells.spent).toBe(1);
  await expect(ride).toHaveAttribute('data-revives', '1');
  await expect(page.locator('.guardian-bell-burst')).toHaveCount(0);
  await expect(ride).toHaveAttribute('data-resume-countdown', /^[1-3]$/);
  await page.screenshot({ path: 'outputs/browser-pwa/guardian-bell-countdown-mobile.png' });
  await expect(ride).toHaveAttribute('data-phase', 'playing');
  await page.keyboard.down('ArrowDown');
  await expect(ride).toHaveAttribute('data-phase', 'crashed', { timeout: 20000 });
  await page.keyboard.up('ArrowDown');
  await expect(page.locator('.ride-revive')).toHaveCount(0);
  await expect.poll(() => player.runsPlayed).toBe(1);
  expect(player.guardianBells.spent).toBe(1);
  expect(player.processedRuns).toHaveLength(1);
});
