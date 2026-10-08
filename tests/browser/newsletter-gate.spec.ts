import { test, expect } from '@playwright/test';
import { newPlayer } from '../../app/domain/progression';

test('fifth ride settles once and every later start stays gated after reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const initial = newPlayer();
  initial.runsPlayed = 4;
  initial.settings.tutorialSeen = true; initial.settings.tutorialHintsSeen = ['controls', 'ramp', 'police', 'radar', 'traffic', 'signs'];
  initial.settings.reducedMotion = true;
  await page.addInitScript((player) => {
    if (!localStorage.getItem('pfusch:player:v1'))
      localStorage.setItem('pfusch:player:v1', JSON.stringify(player));
  }, initial);
  await page.goto('/');
  await page.getByRole('button', { name: 'FAHRT STARTEN', exact: true }).click();
  await expect(page.getByTestId('ride-screen')).toHaveAttribute('data-phase', 'playing', { timeout: 60000 });
  await page.keyboard.press('p');
  await page.getByRole('button', { name: 'FAHRT BEENDEN', exact: true }).click();
  await expect(page.getByTestId('ride-results')).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pfusch:player:v1')!));
  expect(saved.runsPlayed).toBe(5);
  expect(saved.processedRuns).toHaveLength(1);
  await page.getByRole('button', { name: 'WEITERFAHREN FREISCHALTEN', exact: true }).click();
  await expect(page.getByTestId('save-access-gate')).toBeVisible();
  await expect(page.getByTestId('ride-screen')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'STATUS PRÜFEN', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('save-access-gate')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'FAHRT STARTEN', exact: true }).click();
  await expect(page.getByTestId('save-access-gate')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('garage-model')).toBeVisible();
  await page.getByRole('button', { name: 'ZURÜCK ZUM SPIEL', exact: true }).click();
  await page.getByRole('navigation', { name: 'Spielnavigation' }).getByRole('button', { name: 'AUFGABEN', exact: true }).click();
  await page.getByRole('button', { name: 'FAHRT STARTEN', exact: true }).click();
  await expect(page.getByTestId('save-access-gate')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pfusch:player:v1')!))).toEqual(saved);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
