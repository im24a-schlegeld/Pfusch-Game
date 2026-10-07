import { test, expect, type Page } from '@playwright/test';
import { newPlayer } from '../../app/domain/progression';
import type { Player } from '../../app/domain/types';

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pfusch:player:v1')!) as Player);
const openSetups = (page: Page) => page.getByRole('button', { name: 'Setups speichern und verwalten' }).click();

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`setups save, restore and delete without changing inventory at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const initial = newPlayer();
    initial.settings.tutorialSeen = true;
    await page.addInitScript(player => {
      if (!localStorage.getItem('pfusch:player:v1')) localStorage.setItem('pfusch:player:v1', JSON.stringify(player));
    }, initial);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'FAHRT STARTEN', exact: true })).toBeEnabled({ timeout: 90000 });
    await expect(page.locator('.garage-controls .equipped-slots').filter({ hasText: 'OBERTEIL' })).toHaveCount(0);
    await openSetups(page);
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('AKTUELLES SETUP SPEICHERN').fill('Strasse');
    await dialog.getByRole('button', { name: 'SPEICHERN', exact: true }).click();
    await expect(dialog.getByRole('article', { name: 'Strasse', exact: true })).toBeVisible();
    expect((await saved(page)).savedSetups).toHaveLength(1);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Vorschau Motocross Helm', exact: true }).click();
    await openSetups(page);
    await dialog.getByLabel('AKTUELLES SETUP SPEICHERN').fill('Vorschau');
    await expect(dialog.getByRole('button', { name: 'SPEICHERN', exact: true })).toBeDisabled();
    expect((await saved(page)).helmet).toBe('fullface');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'HELM AUSRÜSTEN', exact: true }).click();
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
