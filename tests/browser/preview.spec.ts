import { test, expect } from '@playwright/test';
import { newPlayer } from '../../app/domain/progression';
import type { Product } from '../../app/domain/types';
import { shadeClothingCatalog } from '../../app/domain/appearanceColors';
import { chooseArea, chooseBike, choosePaletteValue, choosePart, chooseProduct, discardPreview, primaryAction } from './garage-helpers';

test('locked previews cover the catalog, discard on part changes and never change a zero-coin save', async ({
  page,
  request,
}) => {
  // Keep every real article/color and image covered, including hidden palette colors.
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  const player = { ...newPlayer(), coins: 0 };
  await page.addInitScript((p) => {
    if (!localStorage.getItem('pfusch:player:v1'))
      localStorage.setItem('pfusch:player:v1', JSON.stringify(p));
  }, player);
  const products: Product[] = shadeClothingCatalog(await (
    await request.get('/catalog/products.json')
  ).json());
  await page.goto('/');
  await expect(primaryAction(page)).toBeEnabled({ timeout: 90000 });
  const original = await page.evaluate(() =>
    localStorage.getItem('pfusch:player:v1'),
  );
  await chooseArea(page, 'Motorrad');
  for (const [name, id] of [
    ['Töffli', '125'],
    ['Roller', 'scooter'],
    ['Supermoto', '450'],
    ['Sport', '701'],
  ]) {
    await chooseBike(page, name);
    await expect(page.getByTestId('garage-model')).toHaveAttribute(
      'data-bike',
      id,
    );
    await page.locator('canvas').waitFor();
    // Preset rendering and screenshots are covered in inspection.spec.ts.
  }
  await choosePart(page, 'Lack');
  await choosePaletteValue(page, 'Lackfarbe', '#323638');
  await expect(page.getByTestId('garage-model')).toHaveAttribute('data-bike', player.bike);

  await expect(
    primaryAction(page),
  ).toBeDisabled();
  await choosePart(page, 'Felgen');
  await choosePaletteValue(page, 'Felgenfarbe', '#24282b');
  await expect(page.getByTestId('garage-model')).toHaveAttribute('data-paint', player.paint);
  await expect(page.getByTestId('garage-model')).toHaveAttribute(
    'data-rims',
    '#24282b',
  );
  for (const product of products.filter((p) => p.category !== 'collectible')) {
    await chooseProduct(page, product);
    await expect(page.getByTestId('garage-model')).toHaveAttribute(
      'data-product',
      product.id,
    );
    for (const color of product.preview!.colors) {
      if (product.preview!.colors.length > 1) await choosePaletteValue(page, 'Artikelfarbe', color.baseColor);
      const photo = page.locator('.gc-reference img');
      await expect(photo).toHaveAttribute('src', color.front!.localImage);
      await expect
        .poll(() =>
          photo.evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
        )
        .toBe(true);
      if (color.back) {
        await page.getByRole('button', { name: 'Rückseite zeigen', exact: true }).click();
        await expect(photo).toHaveAttribute('src', color.back.localImage);
        await page.getByRole('button', { name: 'Vorderseite zeigen', exact: true }).click();
      }
    }
    if (product.preview?.numberCustomization) {
      await page.getByRole('combobox', { name: `${product.title} Nummer`, exact: true }).selectOption('17');
      await expect(page.getByTestId('garage-model')).toHaveAttribute(
        'data-number',
        '17',
      );
      await page.getByRole('button', { name: 'Hinten ¾', exact: true }).click();
      await page.waitForTimeout(350);
      await page.screenshot({ path: 'outputs/zipper-preview.png' });
    }
    await expect(
      primaryAction(page),
    ).toBeDisabled();
    expect(
      await page.evaluate(() => localStorage.getItem('pfusch:player:v1')),
    ).toBe(original);
  }
  await discardPreview(page);
  await expect(page.getByTestId('garage-model')).toHaveAttribute(
    'data-bike',
    '125',
  );
  await expect(page.getByTestId('garage-model')).toHaveAttribute(
    'data-paint',
    player.paint,
  );
  await page.reload();
  expect(
    await page.evaluate(() => localStorage.getItem('pfusch:player:v1')),
  ).toBe(original);
  expect(errors).toEqual([]);
});

test('number and variant save only on explicit Equip and survive reload on mobile', async ({
  page,
  request,
}) => {
  const products: Product[] = await (
    await request.get('/catalog/products.json')
  ).json();
  const product = products.find((p) => p.handle === 'racing-zipper')!;
  const player = newPlayer();
  player.ownedItems.push(product.id);
  await page.addInitScript((p) => {
    if (!localStorage.getItem('pfusch:player:v1'))
      localStorage.setItem('pfusch:player:v1', JSON.stringify(p));
  }, player);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(primaryAction(page)).toBeEnabled({ timeout: 90000 });
  await chooseProduct(page, product);
  await page.getByRole('combobox', { name: `${product.title} Nummer`, exact: true }).selectOption('8');
  await expect(primaryAction(page)).toHaveText('Ausrüsten');
  await primaryAction(page).click();
  await expect(primaryAction(page)).toHaveText('Fahrt starten');
  await page.reload();
  await expect(primaryAction(page)).toBeEnabled({ timeout: 90000 });
  await chooseProduct(page, product);
  await expect(
    page.getByRole('combobox', { name: `${product.title} Nummer`, exact: true }),
  ).toHaveValue('8');
  await page.getByRole('button', { name: 'Rückseite zeigen', exact: true }).click();
  await page.screenshot({ path: 'outputs/preview-mobile.png' });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('pfusch:player:v1')!),
  );
  expect(saved.equipped.upper).toBe(product.id);
  expect(saved.customizations[product.id].customNumber).toBe('8');
});
