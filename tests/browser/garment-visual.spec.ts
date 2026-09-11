import { test, expect } from '@playwright/test';
import type { Product } from '../../app/domain/types';

test('all nine tops render front/back with their actual product photographs', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const products: Product[] = await (
    await request.get('/catalog/products.json')
  ).json();
  await page.goto('/');
  await page.getByRole('button', { name: 'OPEN GARAGE' }).click();
  for (const p of products.filter((p) => p.category === 'upper')) {
    await page
      .getByRole('button', { name: `Preview ${p.title}`, exact: true })
      .click();
    const colors = p.preview!.colors;
    const selected =
      colors.find((c) => c.id === 'hellgrau') ??
      colors.find((c) => c.id === 'blau') ??
      colors[0];
    await page
      .getByRole('button', { name: `Color ${selected.label}`, exact: true })
      .click();
    if (p.preview?.numberCustomization)
      await page.getByRole('textbox', { name: 'Zipper number' }).fill('23');
    for (const side of ['FRONT', 'BACK']) {
      await page.getByRole('button', { name: side, exact: true }).click();
      await page.waitForTimeout(500);
      await page
        .getByTestId('garage-model')
        .screenshot({ path: `outputs/garment-${p.handle}-${side}.png` });
      await page
        .getByTestId('preview-product-image')
        .screenshot({ path: `outputs/source-${p.handle}-${side}.png` });
    }
    if (
      ['racing-zipper', 'keep-up-t-shirt', 'keep-up-hoodie'].includes(p.handle)
    ) {
      for (const angle of ['SIDE', 'FRONT ¾', 'REAR ¾']) {
        await page
          .getByRole('button', { name: `Inspect ${angle}`, exact: true })
          .click();
        await page.waitForTimeout(500);
        await page.getByTestId('garage-model').screenshot({
          path: `outputs/garment-detail-${p.handle}-${angle.replace(' ¾', '-quarter')}.png`,
        });
      }
    }
    if (p.handle === 'racing-zipper') {
      await page
        .getByRole('button', { name: 'Inspect SIDE', exact: true })
        .click();
      const bounds = (await page.locator('canvas').boundingBox())!;
      const x = bounds.x + bounds.width * 0.2,
        y = bounds.y + bounds.height * 0.45;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + Math.PI / 0.009, y, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      await page.getByTestId('garage-model').screenshot({
        path: 'outputs/garment-detail-racing-zipper-OPPOSITE-SIDE.png',
      });
    }
    await page
      .getByRole('button', { name: 'LEAVE PREVIEW', exact: true })
      .click();
  }
  expect(errors).toEqual([]);
});
