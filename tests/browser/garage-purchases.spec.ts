import { test, expect, type Page } from '@playwright/test';
import { BIKES, PAINTS, RIMS } from '../../app/domain/config';
import { visiblePalette } from '../../app/domain/paletteView';
import { newPlayer } from '../../app/domain/progression';
import type { Player } from '../../app/domain/types';

const saved = (page: Page) => page.evaluate(() =>
  JSON.parse(localStorage.getItem('pfusch:player:v1')!) as Player);

async function garage(page: Page) {
  await page.getByRole('navigation', { name: 'Spielnavigation' })
    .getByRole('button', { name: 'GARAGE', exact: true }).click();
  await page.getByRole('tab', { name: 'MOTORRAD', exact: true }).click();
}

for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
  test(`adjacent bike and color purchases preserve preview/equip at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const initial = { ...newPlayer(), xp: 200, level: 2, coins: 1000 };
    await page.addInitScript((player) => {
      if (!localStorage.getItem('pfusch:player:v1'))
        localStorage.setItem('pfusch:player:v1', JSON.stringify(player));
    }, initial);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await garage(page);

    const model = page.getByTestId('garage-model');
    const roller = BIKES.find((entry) => entry.id === 'scooter')!;
    const preview = page.getByRole('button', { name: 'Ansehen Roller', exact: true });
    const buy = page.getByRole('button', { name: 'Kaufen Roller', exact: true });
    const before = await saved(page);
    await preview.click();
    await expect(model).toHaveAttribute('data-bike', 'scooter');
    expect(await saved(page)).toEqual(before);
    const row = page.locator('.bike-card').filter({ has: preview });
    await expect(row.getByRole('button', { name: 'Kaufen Roller', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Kaufen Sport', exact: true })).toBeDisabled();
    await buy.scrollIntoViewIfNeeded();
    const viewBox = (await preview.boundingBox())!, buyBox = (await buy.boundingBox())!;
    expect(Math.abs(viewBox.y - buyBox.y)).toBeLessThan(2);
    expect(buyBox.x).toBeGreaterThan(viewBox.x);
    expect(buyBox.height).toBeGreaterThanOrEqual(44);
    await buy.click();
    let account = await saved(page);
    expect(account.coins).toBe(before.coins - roller.price);
    expect(account.bike).toBe(before.bike);
    expect(account.ownedItems.filter((id) => id === 'bike:scooter')).toHaveLength(1);
    await expect(buy).toHaveCount(0);
    await page.reload();
    await garage(page);
    await expect(model).toHaveAttribute('data-bike', before.bike);
    await page.getByRole('button', { name: 'Ausrüsten Roller', exact: true }).click();
    expect((await saved(page)).bike).toBe('scooter');
    expect((await saved(page)).coins).toBe(account.coins);

    for (const kind of ['paint', 'rims'] as const) {
      const title = kind === 'paint' ? 'Lackfarbe' : 'Felgenfarbe';
      const palette = kind === 'paint' ? PAINTS : RIMS;
      const color = visiblePalette(palette).find((entry) => entry.price > 0 && entry.value !== initial[kind])!;
      account = await saved(page);
      await page.locator('summary').filter({ hasText: title }).click();
      const colorPreview = page.getByRole('button', { name: `${color.name} ${kind}`, exact: true });
      const colorBuy = page.getByRole('button', { name: `Kaufen ${title} ${color.name}`, exact: true });
      const colorRow = page.locator('.finish-option').filter({ has: colorPreview });
      await expect(colorRow.getByRole('button', { name: `Kaufen ${title} ${color.name}`, exact: true })).toBeEnabled();
      await colorPreview.click();
      await expect(model).toHaveAttribute(`data-${kind}`, color.value);
      expect(await saved(page)).toEqual(account);
      await colorBuy.click();
      const purchased = await saved(page);
      expect(purchased.coins).toBe(account.coins - color.price);
      expect(purchased[kind]).toBe(account[kind]);
      expect(purchased.ownedItems.filter((id) => id === `${kind}:${color.value}`)).toHaveLength(1);
      await expect(colorBuy).toHaveCount(0);
      await page.reload();
      await garage(page);
      await expect(model).toHaveAttribute(`data-${kind}`, account[kind]);
      await page.locator('summary').filter({ hasText: title }).click();
      await page.getByRole('button', { name: `Ausrüsten ${title} ${color.name}`, exact: true }).click();
      expect((await saved(page))[kind]).toBe(color.value);
      expect((await saved(page)).coins).toBe(purchased.coins);
      await page.locator('summary').filter({ hasText: title }).click();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(errors).toEqual([]);
  });
}

test('no-coin player can preview every paid option but cannot buy it', async ({ page }) => {
  const initial = { ...newPlayer(), coins: 0 };
  await page.addInitScript((player) => {
    localStorage.setItem('pfusch:player:v1', JSON.stringify(player));
  }, initial);
  await page.goto('/');
  await garage(page);
  const before = await saved(page);
  await page.getByRole('button', { name: 'Ansehen Sport', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Kaufen Sport', exact: true })).toBeDisabled();
  for (const kind of ['paint', 'rims'] as const) {
    const title = kind === 'paint' ? 'Lackfarbe' : 'Felgenfarbe';
    const color = visiblePalette(kind === 'paint' ? PAINTS : RIMS).find((entry) => entry.price > 0)!;
    await page.locator('summary').filter({ hasText: title }).click();
    await page.getByRole('button', { name: `${color.name} ${kind}`, exact: true }).click();
    await expect(page.getByRole('button', { name: `Kaufen ${title} ${color.name}`, exact: true })).toBeDisabled();
    await expect(page.getByTestId('garage-model')).toHaveAttribute(`data-${kind}`, color.value);
  }
  expect(await saved(page)).toEqual(before);
});
