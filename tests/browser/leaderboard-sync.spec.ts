import { expect, test } from '@playwright/test';
// Include the fixture's Window declaration without executing its browser code.
import type {} from './fixtures/leaderboard-sync';

test('ranking waits for account saves, refreshes the final trial and tolerates duplicate names', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /same key|unique.*key/i.test(message.text())) errors.push(message.text());
  });
  await page.goto('/tests/browser/fixtures/leaderboard-sync.html');
  const ownRow = page.locator('.ranking-list > .you');
  await expect(ownRow).toContainText('Sam');
  await expect.poll(() => page.evaluate(() => window.leaderboardSyncProbe.fetches)).toBe(1);
  await page.getByRole('textbox', { name: 'Anzeigename' }).fill('Alex');
  await page.getByRole('button', { name: 'NAMEN SPEICHERN' }).click();
  await expect.poll(() => page.evaluate(() => window.leaderboardSyncProbe.saving)).toBe(true);
  // A period change while POST is blocked must discard the earlier pending fetch.
  await page.getByRole('tab', { name: 'DIESE WOCHE' }).click();
  expect(await page.evaluate(() => window.leaderboardSyncProbe.fetches)).toBe(1);
  await page.evaluate(() => window.leaderboardSyncProbe.acknowledge());
  await expect(ownRow).toContainText('Alex');
  await expect.poll(() => page.evaluate(() => window.leaderboardSyncProbe.fetches)).toBe(2);
  expect(await page.evaluate(() => window.leaderboardSyncProbe.periods)).toEqual(['day', 'week']);

  await page.evaluate(() => window.leaderboardSyncProbe.completeTrial());
  await expect.poll(() => page.evaluate(() => window.leaderboardSyncProbe.saving)).toBe(true);
  expect(await page.evaluate(() => window.leaderboardSyncProbe.fetches)).toBe(2);
  await page.evaluate(() => window.leaderboardSyncProbe.acknowledge());
  await expect(ownRow).toContainText('222');
  await expect.poll(() => page.evaluate(() => window.leaderboardSyncProbe.fetches)).toBe(3);
  expect(await page.evaluate(() => window.leaderboardSyncProbe.posts)).toBe(2);
  expect(errors).toEqual([]);
});
