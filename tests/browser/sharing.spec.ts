import { expect, test, type Page } from '@playwright/test';
import { newPlayer } from '../../app/domain/progression';
import { TUTORIAL_HINTS } from '../../app/domain/tutorial';
import type { Engine } from '../../app/game/engine';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function prepareSharing(page: Page, native: boolean) {
  const player = newPlayer();
  player.settings.tutorialSeen = true;
  player.settings.tutorialHintsSeen = [...TUTORIAL_HINTS];
  player.settings.quality = 'low';
  player.settings.reducedMotion = true;
  player.highScore = 7723;
  player.leaderboardName = 'Alex';
  player.history = [{ score: 7723, date: '2026-10-16' }];
  await page.addInitScript(({ saved, native }) => {
    localStorage.setItem('pfusch:player:v1', JSON.stringify(saved));
    Math.random = () => 5489 / 0xffffffff;
    Object.defineProperty(navigator, 'share', { configurable: true, value: native ? async (data: ShareData) => {
      const state = document.documentElement.dataset;
      state.shareCount = String(Number(state.shareCount ?? 0) + 1);
      state.shareData = JSON.stringify(data);
      state.shareActivated = String(navigator.userActivation.isActive);
      if (state.cancelShare === 'true') throw new DOMException('Dismissed', 'AbortError');
    } : undefined });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async () => { document.documentElement.dataset.linkCopied = 'true'; },
    } });
    window.open = () => ({ opener: null, location: {
      set href(url: string) { document.documentElement.dataset.shareDraft = url; },
    }, close() {} }) as unknown as Window;
  }, { saved: player, native });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Fahrt starten', exact: true })).toBeVisible({ timeout: 60000 });
}

test('native sharing uses the click gesture and cancellation keeps the same crashed ride retryable', async ({ page }) => {
  await prepareSharing(page, true);
  await page.getByRole('navigation', { name: 'Spielnavigation' }).getByRole('button', { name: 'RANG', exact: true }).click();
  await page.locator('.game-share-section').getByRole('button', { name: 'TEILEN', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-share-activated', 'true');
  const data = JSON.parse((await page.locator('html').getAttribute('data-share-data'))!) as ShareData;
  expect(new URL(data.url!).searchParams.get('points')).toBe('7723');
  await expect(page.locator('.game-share-choices')).toHaveCount(0);
  await page.locator('.game-invite-section').getByRole('button', { name: 'FREUND EINLADEN', exact: true }).click();
  const invitation = JSON.parse((await page.locator('html').getAttribute('data-share-data'))!) as ShareData;
  expect(new URL(invitation.url!).searchParams.get('share')).toBe('invite');
  await page.getByRole('navigation', { name: 'Spielnavigation' }).getByRole('button', { name: 'GARAGE', exact: true }).click();
  await page.getByRole('button', { name: 'Fahrt starten', exact: true }).click();
  const ride = page.getByTestId('ride-screen');
  await expect(ride).toHaveAttribute('data-phase', 'playing', { timeout: 60000 });
  // Exercise the real mounted ride's crash/share flow without waiting for
  // software WebGL frame rate to generate a particular traffic encounter.
  await ride.evaluate(element => {
    type Hook = { memoizedState: unknown; next: Hook | null };
    type Fiber = { memoizedState: Hook | null; return: Fiber | null };
    const node = element as unknown as Record<string, unknown>;
    let fiber = node[Object.keys(node).find(key => key.startsWith('__reactFiber$'))!] as Fiber | null;
    while (fiber) {
      for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const value = Array.isArray(hook.memoizedState) ? hook.memoizedState[0] : hook.memoizedState;
        const candidate = value && typeof value === 'object' && 'engine' in value ? value.engine as Engine : value as Engine | undefined;
        if (candidate?.world && typeof candidate.crash === 'function') { candidate.crash('Wheelie fall'); return; }
      }
      fiber = fiber.return;
    }
    throw new Error('Mounted production ride engine not found');
  });
  await expect(ride).toHaveAttribute('data-phase', 'crashed', { timeout: 60000 });
  const revive = page.locator('.ride-revive');
  await expect(revive).toBeVisible();
  await page.locator('html').evaluate(element => { (element as HTMLElement).dataset.cancelShare = 'true'; });
  await revive.getByRole('button', { name: 'EINLADEN & WEITER', exact: true }).click();
  await expect(revive).toContainText('Teilen abgebrochen.');
  await expect(ride).toHaveAttribute('data-phase', 'crashed');
  await expect(ride).toHaveAttribute('data-revives', '0');
  await expect(page.locator('html')).not.toHaveAttribute('data-share-draft');
  await expect(page.locator('html')).not.toHaveAttribute('data-link-copied');
  await page.locator('html').evaluate(element => { (element as HTMLElement).dataset.cancelShare = 'false'; });
  await revive.getByRole('button', { name: 'EINLADEN & WEITER', exact: true }).click();
  await expect(ride).toHaveAttribute('data-revives', '1');
  await expect(revive).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-share-activated', 'true');
});

test('unsupported native sharing opens only WhatsApp with no automatic copy', async ({ page }) => {
  await prepareSharing(page, false);
  await page.getByRole('navigation', { name: 'Spielnavigation' }).getByRole('button', { name: 'RANG', exact: true }).click();
  await page.locator('.game-invite-section').getByRole('button', { name: 'FREUND EINLADEN', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-share-draft', /^https:\/\/wa\.me\//);
  await expect(page.locator('.game-share-choices')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-link-copied');
});
