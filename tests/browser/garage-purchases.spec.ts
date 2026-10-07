import { test, expect, type Page } from '@playwright/test';
import { BIKES, PAINTS, RIMS } from '../../app/domain/config';
import { newPlayer } from '../../app/domain/progression';
import type { Player } from '../../app/domain/types';
import { chooseArea, chooseBike, choosePaletteValue, choosePart, primaryAction } from './garage-helpers';

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pfusch:player:v1')!) as Player);
async function garage(page: Page) {
  await expect(primaryAction(page)).toBeEnabled({ timeout: 90000 });
  await chooseArea(page, 'Motorrad');
}

for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
  test(`common action buys and equips exact bike and colors at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(180000);
    await page.setViewportSize(viewport);
    const initial = { ...newPlayer(), xp: 200, level: 2, coins: 1000 };
    await page.addInitScript(player => {
      if (!localStorage.getItem('pfusch:player:v1')) localStorage.setItem('pfusch:player:v1', JSON.stringify(player));
    }, initial);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await garage(page);
    const model = page.getByTestId('garage-model');
    const roller = BIKES.find(entry => entry.id === 'scooter')!;
    const before = await saved(page);
    await chooseBike(page, 'Sport');
    await expect(primaryAction(page)).toHaveText('Ab Level 6 verfügbar');
    await expect(primaryAction(page)).toBeDisabled();
    await chooseBike(page, 'Roller');
    await expect(model).toHaveAttribute('data-bike', 'scooter');
    expect(await saved(page)).toEqual(before);
    await expect(primaryAction(page)).toHaveText(`Für ${roller.price} Coins kaufen & ausrüsten`);
    await expect(primaryAction(page)).toBeEnabled();
    const buttonBox = (await primaryAction(page).boundingBox())!;
    expect(buttonBox.height).toBeGreaterThanOrEqual(44);
    expect(buttonBox.y).toBeGreaterThanOrEqual(0);
    expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(viewport.height);
    await primaryAction(page).click();
    await expect(primaryAction(page)).toHaveText('Fahrt starten');
    let account = await saved(page);
    expect(account.coins).toBe(before.coins - roller.price);
    expect(account.bike).toBe('scooter');
    expect(account.ownedItems.filter(id => id === 'bike:scooter')).toHaveLength(1);
    await page.reload();
    await garage(page);
    await expect(model).toHaveAttribute('data-bike', 'scooter');
    await chooseBike(page, 'Töffli');
    await primaryAction(page).click();
    await expect(primaryAction(page)).toHaveText('Fahrt starten');
    await chooseBike(page, 'Roller');
    await expect(primaryAction(page)).toHaveText('Ausrüsten');
    await primaryAction(page).click();
    await expect(primaryAction(page)).toHaveText('Fahrt starten');
    expect((await saved(page)).bike).toBe('scooter');
    expect((await saved(page)).coins).toBe(account.coins);

    for (const kind of ['paint', 'rims'] as const) {
      const title = kind === 'paint' ? 'Lackfarbe' : 'Felgenfarbe';
      const palette = kind === 'paint' ? PAINTS : RIMS;
      const color = palette.find(entry => entry.price > 0 && entry.value !== initial[kind])!;
      account = await saved(page);
      await choosePart(page, kind === 'paint' ? 'Lack' : 'Felgen');
      await choosePaletteValue(page, title, color.value);
      await expect(model).toHaveAttribute(`data-${kind}`, color.value);
      expect(await saved(page)).toEqual(account);
      await expect(primaryAction(page)).toHaveText(`Für ${color.price} Coins kaufen & ausrüsten`);
      await primaryAction(page).click();
      await expect(primaryAction(page)).toHaveText('Fahrt starten');
      const purchased = await saved(page);
      expect(purchased.coins).toBe(account.coins - color.price);
      expect(purchased[kind]).toBe(color.value);
      expect(purchased.ownedItems.filter(id => id === `${kind}:${color.value}`)).toHaveLength(1);
      await page.reload();
      await garage(page);
      await expect(model).toHaveAttribute(`data-${kind}`, color.value);
      await choosePart(page, kind === 'paint' ? 'Lack' : 'Felgen');
      await choosePaletteValue(page, title, initial[kind]);
      await primaryAction(page).click();
      await expect(primaryAction(page)).toHaveText('Fahrt starten');
      await choosePaletteValue(page, title, color.value);
      await expect(primaryAction(page)).toHaveText('Ausrüsten');
      await primaryAction(page).click();
      await expect(primaryAction(page)).toHaveText('Fahrt starten');
      expect((await saved(page))[kind]).toBe(color.value);
      expect((await saved(page)).coins).toBe(purchased.coins);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(errors).toEqual([]);
  });
}

test('no-coin player can preview paid options and sees specific purchase blockers', async ({ page }) => {
  const initial = { ...newPlayer(), coins: 0 };
  await page.addInitScript(player => localStorage.setItem('pfusch:player:v1', JSON.stringify(player)), initial);
  await page.goto('/');
  await garage(page);
  const before = await saved(page);
  await chooseBike(page, 'Sport');
  await expect(primaryAction(page)).toHaveText('Ab Level 6 verfügbar');
  await expect(primaryAction(page)).toBeDisabled();
  for (const kind of ['paint', 'rims'] as const) {
    const title = kind === 'paint' ? 'Lackfarbe' : 'Felgenfarbe';
    const color = (kind === 'paint' ? PAINTS : RIMS).find(entry => entry.price > 0)!;
    await choosePart(page, kind === 'paint' ? 'Lack' : 'Felgen');
    await choosePaletteValue(page, title, color.value);
    await expect(primaryAction(page)).toHaveText(`Dir fehlen ${color.price} Coins`);
    await expect(primaryAction(page)).toBeDisabled();
    await expect(page.getByTestId('garage-model')).toHaveAttribute(`data-${kind}`, color.value);
    await expect(page.getByTestId('garage-model')).toHaveAttribute('data-bike', before.bike);
  }
  expect(await saved(page)).toEqual(before);
});
