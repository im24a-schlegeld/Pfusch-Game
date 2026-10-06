import { test, expect } from '@playwright/test';
import { PAINTS } from '../../app/domain/config';
import { visiblePalette } from '../../app/domain/paletteView';

test('Escape pauses and resumes without double handling', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'FAHRT STARTEN', exact: true }).click();
  await page.getByTestId('first-ride-start').click();
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
      page.getByRole('button', { name: 'FAHRT STARTEN', exact: true }),
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
  await page.getByRole('tab', { name: 'MOTORRAD', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Lackfarbe' }).click();
  const color = visiblePalette(PAINTS).find((entry) => entry.price > 0)!;
  const preview = page.getByRole('button', { name: `${color.name} paint`, exact: true });
  await preview.click();
  await expect(
    preview,
  ).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('button', { name: `Kaufen Lackfarbe ${color.name}`, exact: true })
    .click();
  await page
    .getByRole('button', { name: `Ausrüsten Lackfarbe ${color.name}`, exact: true })
    .click();
  await page.reload();
  await page.getByRole('tab', { name: 'MOTORRAD', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Lackfarbe' }).click();
  await expect(
    preview,
  ).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
