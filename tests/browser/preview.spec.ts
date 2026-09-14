import { test, expect } from '@playwright/test';
import { newPlayer } from '../../app/domain/progression';
import type { Product } from '../../app/domain/types';

test('locked previews combine freely, never change a zero-coin save, and reset', async ({
  page,
  request,
}) => {
  // This catalog-wide flow visits 43 colors, each rebuilding the full 3D setup.
  // Budget the complete scenario, without extending individual click timeouts.
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
  const products: Product[] = await (
    await request.get('/catalog/products.json')
  ).json();
  await page.goto('/');
  await page.getByRole('button', { name: 'OPEN GARAGE' }).click();
  const original = await page.evaluate(() =>
    localStorage.getItem('pfusch:player:v1'),
  );
  await page.getByRole('tab', { name: 'BIKE', exact: true }).click();
  for (const [name, id] of [
    ['Töffli', '125'],
    ['Roller', 'scooter'],
    ['Supermoto', '450'],
    ['Sport', '701'],
  ]) {
    await page
      .getByRole('button', { name: `Preview ${name}`, exact: true })
      .click();
    await expect(page.getByTestId('garage-model')).toHaveAttribute(
      'data-bike',
      id,
    );
    await page.locator('canvas').waitFor();
    // Preset rendering and screenshots are covered in inspection.spec.ts.
  }
  await page
    .getByRole('button', { name: 'Asphalt paint', exact: true })
    .click();

  await expect(
    page.getByRole('button', { name: 'EQUIP BIKE SETUP', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Black rims', exact: true }).click();
  await expect(page.getByTestId('garage-model')).toHaveAttribute(
    'data-rims',
    '#24282b',
  );
  await page.getByRole('tab', { name: 'RIDER', exact: true }).click();
  for (const product of products.filter((p) => p.category !== 'collectible')) {
    await page
      .getByRole('button', { name: `Preview ${product.title}`, exact: true })
      .click();
    await expect(page.getByTestId('garage-model')).toHaveAttribute(
      'data-product',
      product.id,
    );
    for (const color of product.preview!.colors) {
      await page
        .getByRole('button', { name: `Color ${color.label}`, exact: true })
        .click();
      const photo = page.getByTestId('preview-product-image');
      await expect(photo).toHaveAttribute('src', color.front!.localImage);
      await expect
        .poll(() =>
          photo.evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
        )
        .toBe(true);
      if (color.back) {
        await page.getByRole('button', { name: 'BACK', exact: true }).click();
        await expect(photo).toHaveAttribute('src', color.back.localImage);
        await page.getByRole('button', { name: 'FRONT', exact: true }).click();
      }
    }
    if (product.preview?.numberCustomization) {
      await page.getByRole('textbox', { name: 'Zipper number' }).fill('17');
      await expect(page.getByTestId('garage-model')).toHaveAttribute(
        'data-number',
        '17',
      );
      await page.getByRole('button', { name: 'Inspect REAR ¾', exact: true }).click();
      await page.waitForTimeout(350);
      await page.screenshot({ path: 'outputs/zipper-preview.png' });
    }
    await expect(
      page.getByRole('button', { name: /UNLOCK DIGITAL/ }),
    ).toBeDisabled();
    await page
      .getByRole('button', { name: 'KEEP IN TRY-ON SETUP', exact: true })
      .click();
    expect(
      await page.evaluate(() => localStorage.getItem('pfusch:player:v1')),
    ).toBe(original);
  }
  await page
    .getByRole('button', { name: 'RETURN TO EQUIPPED', exact: true })
    .click();
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
  await page.getByRole('button', { name: 'OPEN GARAGE' }).click();
  await page
    .getByRole('button', { name: `Preview ${product.title}`, exact: true })
    .click();
  await page.getByRole('textbox', { name: 'Zipper number' }).fill('8');
  await page
    .getByRole('button', { name: 'EQUIP FOR GAMEPLAY', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'LEAVE PREVIEW', exact: true })
    .click();
  await page.reload();
  await page.getByRole('button', { name: 'OPEN GARAGE' }).click();
  await page
    .getByRole('button', { name: `Preview ${product.title}`, exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Zipper number' }),
  ).toHaveValue('8');
  await page.getByRole('button', { name: 'BACK', exact: true }).click();
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
