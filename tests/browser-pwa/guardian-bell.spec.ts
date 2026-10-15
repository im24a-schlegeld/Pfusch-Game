import { expect, test } from '@playwright/test';
import { newPlayer } from '../../app/domain/progression';

test.use({ serviceWorkers: 'block' });

test('one Bell bursts, is saved before countdown, then continues the same ride once', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let player = { ...newPlayer(), id: 'shopify:123', guardianBells: { earned: 1, spent: 0, spentRunIds: [] as string[] } };
  player.settings.tutorialSeen = true;
  player.settings.tutorialHintsSeen = ['controls', 'ramp', 'police', 'radar', 'traffic', 'signs'];
  player.settings.muted = true;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Math.random = () => 5489 / 0xffffffff;
    // The production Bell has an 800 ms fallback. Extend only that test's
    // timer while its DOM overlay exists; a synthetic animationend will
    // complete the same real React handler immediately after screenshot.
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
      nativeSetTimeout(handler, delay === 800 && document.querySelector('.guardian-bell-burst')
        ? 60_000 : delay, ...args)) as typeof window.setTimeout;
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
  // Keep only the test's CSS animation visible until the screenshot is saved.
  await page.addStyleTag({ content: '.guardian-bell-burst { --guardian-bell-duration: 60000ms !important; }' });
  await page.getByRole('button', { name: /1 BELL EINLÖSEN/ }).click();
  await expect(ride).toHaveAttribute('data-revives', '0');
  await expect(ride).toHaveAttribute('data-resume-countdown', '0');
  const bellBurst = page.locator('.guardian-bell-burst');
  await expect(bellBurst).toBeVisible();
  // Playwright fast-forwards finite CSS animations during screenshots by default.
  // Freeze the real animation at its visible whole-bell frame so the artifact
  // proves the Gothic artwork appeared instead of capturing the departing dialog.
  await bellBurst.evaluate(element => {
    const animations = element.getAnimations({ subtree: true });
    if (animations.length < 6) throw new Error('Guardian Bell burst animation is missing');
    for (const animation of animations) {
      animation.pause();
      // 25% of the deliberately extended test animation: the whole bell is visible.
      animation.currentTime = 15000;
    }
  });
  await expect(bellBurst.locator('.guardian-bell-burst-whole')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'outputs/browser-pwa/guardian-bell-burst-mobile.png', animations: 'allow' });
  // Trigger the component's real animation-completion handler now that the
  // artwork has been recorded, rather than racing its 800 ms production timer.
  await bellBurst.evaluate(element => {
    element.dispatchEvent(new AnimationEvent('animationend', {
      bubbles: true, animationName: 'guardian-bell-overlay',
    }));
  });
  // Do not locate the bell again: it may have unmounted after the screenshot.
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
