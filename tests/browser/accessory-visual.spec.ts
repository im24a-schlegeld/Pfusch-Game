import { test, expect } from '@playwright/test';
import type { Product } from '../../app/domain/types';
import { newPlayer } from '../../app/domain/progression';

test('carried caps and bag retain the riding helmet, real artwork and free preview', async ({
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
  await page.addInitScript(
    (player) =>
      localStorage.setItem('pfusch:player:v1', JSON.stringify(player)),
    newPlayer(),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'OPEN GARAGE' }).click();
  const initial = await page.evaluate(() =>
    localStorage.getItem('pfusch:player:v1'),
  );
  expect(initial).not.toBeNull();
  for (const product of products.filter(
    (p) => p.category === 'head' || p.handle === 'logo-crossbody-tasche',
  )) {
    await page
      .getByRole('button', { name: `Preview ${product.title}`, exact: true })
      .click();
    for (const view of ['SIDE', 'FRONT ¾', 'REAR ¾']) {
      await page
        .getByRole('button', { name: `Inspect ${view}`, exact: true })
        .click();
      await page.waitForTimeout(650);
      await page
        .getByTestId('garage-model')
        .screenshot({
          path: `outputs/accessory-${product.handle}-${view.replace(' ¾', '-quarter')}.png`,
        });
    }
    await expect(page.getByTestId('preview-product-image')).toBeVisible();
    await page
      .getByRole('button', { name: 'LEAVE PREVIEW', exact: true })
      .click();
  }
  expect(
    await page.evaluate(() => localStorage.getItem('pfusch:player:v1')),
  ).toEqual(initial);
  expect(errors).toEqual([]);
});
