import { test, expect } from '@playwright/test';

test('Escape pauses and resumes without double handling', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'LET’S RIDE', exact: true }).click();
  await page.getByRole('button', { name: 'GOT IT. LET’S RIDE' }).click();
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
      page.getByRole('button', { name: 'LET’S RIDE', exact: true }),
    ).toBeVisible();
  }
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'REWARDS', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'COLLECT REWARD', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'COLLECTED', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'GARAGE', exact: true })
    .click();
  await page.getByRole('tab', { name: 'BIKE', exact: true }).click();
  await page
    .getByRole('button', { name: 'Asphalt paint', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Asphalt paint', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('button', { name: 'UNLOCK PAINT · 80 COINS', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'EQUIP BIKE SETUP', exact: true })
    .click();
  await page.reload();
  await page.getByRole('button', { name: 'OPEN GARAGE' }).click();
  await page.getByRole('tab', { name: 'BIKE', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Asphalt paint', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
