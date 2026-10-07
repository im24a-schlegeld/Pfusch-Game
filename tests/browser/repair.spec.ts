import { test, expect } from '@playwright/test';
import { PAINTS } from '../../app/domain/config';
import { visiblePalette } from '../../app/domain/paletteView';
import { chooseArea, choosePart, choosePaletteValue, primaryAction } from './garage-helpers';

test('Escape pauses and resumes without double handling', async ({ page }) => {
  await page.goto('/');
  await primaryAction(page).click();
  await expect(page.getByTestId('ride-tutorial-overlay')).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: 'Hinweise überspringen', exact: true }).click();
  const ride = page.getByTestId('ride-screen');
  await expect(ride).toHaveAttribute('data-phase', 'playing');
  await page.keyboard.press('Escape');
  await expect(ride).toHaveAttribute('data-phase', 'paused');
  await page.keyboard.press('Escape');
  await expect(ride).toHaveAttribute('data-phase', 'playing');
});

test('production assets, console, narrow screens and saved customization', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  page.on('requestfailed', (r) => failedRequests.push(r.url()));
  const catalogResponse = await request.get('/catalog/products.json');
  expect(catalogResponse.ok()).toBe(true);
  const products = (await catalogResponse.json()) as { localImage: string }[];
  for (const product of products) {
    const response = await request.get(`/${product.localImage}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/');
  }
  await page.goto('/');
  await page.locator('canvas').waitFor();
  for (const size of [
    { width: 360, height: 640 },
    { width: 390, height: 844 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(size);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      primaryAction(page),
    ).toBeVisible();
  }
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'BELOHNUNGEN', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'ABHOLEN', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'ERHALTEN', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'GARAGE', exact: true })
    .click();
  await chooseArea(page, 'Motorrad');
  await choosePart(page, 'Lack');
  const color = visiblePalette(PAINTS).find((entry) => entry.price > 0)!;
  await choosePaletteValue(page, 'Lackfarbe', color.value);
  await expect(primaryAction(page)).toHaveText(/Kaufen & ausrüsten/i);
  await primaryAction(page).click();
  await expect(page.getByTestId('garage-model')).toHaveAttribute('data-paint', color.value);
  await page.reload();
  await chooseArea(page, 'Motorrad');
  await choosePart(page, 'Lack');
  const preview = page.getByRole('group', { name: 'Lackfarbe', exact: true }).locator(`input[value="${color.value}"]`);
  await expect(preview).toBeChecked();
  await expect(page.getByTestId('garage-model')).toHaveAttribute('data-paint', color.value);
  expect(errors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
