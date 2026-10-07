import { test, expect, type Page } from '@playwright/test';
import { newPlayer } from '../../app/domain/progression';
import type { Player } from '../../app/domain/types';
import { chooseArea, choosePart, primaryAction } from './garage-helpers';

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pfusch:player:v1')!) as Player);
const openSetups = (page: Page) => page.getByRole('button', { name: 'Setups speichern und verwalten' }).click();

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`setups save, restore and delete without changing inventory at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const initial = newPlayer();
    initial.settings.tutorialSeen = true; initial.settings.tutorialHintsSeen = ['controls', 'ramp', 'police', 'radar', 'traffic', 'signs'];
    await page.addInitScript(player => {
      if (!localStorage.getItem('pfusch:player:v1')) localStorage.setItem('pfusch:player:v1', JSON.stringify(player));
    }, initial);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(primaryAction(page)).toHaveText('Fahrt starten', { timeout: 90000 });
    await expect(primaryAction(page)).toBeEnabled();
    await expect(page.getByRole('navigation', { name: 'Garage-Bereiche' }).getByRole('button')).toHaveCount(2);
    await openSetups(page);
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('AKTUELLES SETUP SPEICHERN').fill('Strasse');
    await dialog.getByRole('button', { name: 'SPEICHERN', exact: true }).click();
    await expect(dialog.getByRole('article', { name: 'Strasse', exact: true })).toBeVisible();
    expect((await saved(page)).savedSetups).toHaveLength(1);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await chooseArea(page, 'Fahrer');
    await choosePart(page, 'Kopf');
    await page.getByRole('button', { name: 'Motocross', exact: true }).click();
    await openSetups(page);
    await dialog.getByLabel('AKTUELLES SETUP SPEICHERN').fill('Vorschau');
    await expect(dialog.getByRole('button', { name: 'SPEICHERN', exact: true })).toBeDisabled();
    expect((await saved(page)).helmet).toBe('fullface');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(primaryAction(page)).toHaveText('Ausrüsten');
    await primaryAction(page).click();
    await openSetups(page);
    await dialog.getByLabel('AKTUELLES SETUP SPEICHERN').fill('Cross');
    await dialog.getByRole('button', { name: 'SPEICHERN', exact: true }).click();
    expect((await saved(page)).savedSetups).toHaveLength(2);
    await page.reload();
    await openSetups(page);
    await expect(dialog.getByRole('article', { name: 'Cross', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Strasse ausrüsten', exact: true }).click();
    await expect(dialog.locator('.setup-message')).toContainText('ausgerüstet');
    expect((await saved(page)).helmet).toBe('fullface');
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `outputs/saved-setups-${viewport.width}.png` });
    await dialog.getByRole('button', { name: 'Cross löschen', exact: true }).click();
    await dialog.getByRole('button', { name: 'LÖSCHEN BESTÄTIGEN', exact: true }).click();
    await expect(dialog.getByRole('article', { name: 'Cross', exact: true })).toHaveCount(0);
    await page.reload();
    await openSetups(page);
    await expect(dialog.getByRole('article', { name: 'Strasse', exact: true })).toBeVisible();
    const result = await saved(page);
    expect(result.savedSetups.map(setup => setup.name)).toEqual(['Strasse']);
    expect(result.coins).toBe(initial.coins);
    expect(result.ownedItems).toEqual(initial.ownedItems);
    expect(result.helmet).toBe('fullface');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(errors).toEqual([]);
  });
}
