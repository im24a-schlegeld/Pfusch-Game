import { test, expect, type Page } from '@playwright/test';
import { newPlayer } from '../../app/domain/progression';
import type { Player } from '../../app/domain/types';

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pfusch:player:v1')!) as Player);
const sizes = [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }];
for (const viewport of sizes) {
  test(`garage remains usable without WebGL at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const initial = newPlayer(); initial.coins = 1000; initial.settings.tutorialSeen = true; initial.settings.tutorialHintsSeen = ['controls', 'ramp', 'police', 'radar', 'traffic', 'signs'];
    await page.addInitScript(player => {
      if (!localStorage.getItem('pfusch:player:v1')) localStorage.setItem('pfusch:player:v1', JSON.stringify(player));
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
        if (String(args[0]).includes('webgl')) return null;
        return getContext.apply(this, args);
      } as typeof getContext;
    }, initial);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.gc-primary')).toBeEnabled();
    await expect(page.getByRole('group', { name: 'Bildvorschau deines Setups' })).toBeVisible({ timeout: 60000 });
    await page.getByRole('button', { name: 'Lack', exact: true }).click();
    await page.getByRole('button', { name: /Weitere Farben/ }).click();
    const radios = page.getByRole('radio');
    const value = await radios.last().getAttribute('value');
    await radios.nth(3).check(); await radios.last().check();
    await expect(page.getByTestId('garage-model')).toHaveAttribute('data-paint', value!);
    expect((await saved(page)).paint).toBe(initial.paint);
    await page.getByRole('button', { name: 'Weniger Farben' }).click();
    await expect(page.locator('.gc-swatches input:checked')).toHaveCount(1);
    await expect(page.locator('.gc-swatches input:checked')).toHaveValue(value!);
    await page.locator('.gc-primary').click();
    await expect(page.locator('.gc-primary')).toHaveText(/Fahrt starten/);
    const purchased = await saved(page);
    expect(purchased.paint).toBe(value);
    expect(purchased.coins).toBeLessThan(initial.coins);
    await page.getByRole('button', { name: 'Fahrer', exact: true }).click();
    await page.getByRole('button', { name: 'Kopf', exact: true }).click();
    await page.getByRole('button', { name: 'Motocross', exact: true }).click();
    await page.getByRole('radio', { name: /Helmfarbe:/ }).nth(3).check();
    const helmetColor = await page.getByTestId('garage-model').getAttribute('data-helmet-color');
    await page.getByRole('radio', { name: /Visier \/ Brillenglas: Blau/ }).check();
    await expect(page.getByTestId('garage-model')).toHaveAttribute('data-helmet-color', helmetColor!);
    await page.locator('.gc-primary').click();
    await expect(page.locator('.gc-primary')).toHaveText(/Fahrt starten/);
    expect((await saved(page)).helmetVisor).toBe('#287a9d');
    await page.getByRole('button', { name: 'Integralhelm', exact: true }).click();
    await page.getByRole('button', { name: 'Oberteil', exact: true }).click();
    await expect(page.getByTestId('garage-model')).toHaveAttribute('data-helmet', 'motocross');
    await page.getByRole('button', { name: 'Setups speichern und verwalten' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('AKTUELLES SETUP SPEICHERN').fill('Meine Garage');
    await dialog.getByRole('button', { name: 'SPEICHERN', exact: true }).click();
    await expect(dialog.getByRole('article', { name: 'Meine Garage', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.gc-primary')).toBeEnabled();
    const afterReload = await saved(page);
    expect(afterReload.paint).toBe(value); expect(afterReload.helmetColor).toBe(helmetColor);
    expect(afterReload.coins).toBe(purchased.coins); expect(afterReload.savedSetups[0].name).toBe('Meine Garage');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    const button = await page.locator('.gc-primary').boundingBox();
    expect(button!.y).toBeGreaterThanOrEqual(0);
    expect(button!.y + button!.height).toBeLessThanOrEqual(viewport.height);
    await expect(page.getByRole('group', { name: 'Bildvorschau deines Setups' })).toBeVisible({ timeout: 60000 });
    await page.screenshot({ path: `outputs/garage-configurator-${viewport.width}.png` });
  });
}
