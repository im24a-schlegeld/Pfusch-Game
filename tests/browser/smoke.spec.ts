import { test, expect, type Page } from '@playwright/test';
import type { Player, Product } from '../../app/domain/types';

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pfusch:player:v1')!) as Player);

async function waitForFirstSimulation(page: Page, errors: string[]) {
  try {
    await expect
      .poll(
        async () => {
          expect(errors, 'startup console/runtime errors').toEqual([]);
          return Number(
            await page.getByTestId('ride-screen').getAttribute('data-frame'),
          );
        },
        { timeout: 60000 },
      )
      .toBeGreaterThan(0);
  } catch (error) {
    const state = await page.evaluate(() => ({
      focused: document.hasFocus(),
      visibility: document.visibilityState,
      readyState: document.readyState,
      canvasCount: document.querySelectorAll('canvas').length,
      ride: Object.fromEntries(
        ['frame', 'phase', 'distance', 'lane'].map((key) => [
          key,
          document
            .querySelector('[data-testid="ride-screen"]')
            ?.getAttribute(`data-${key}`),
        ]),
      ),
    }));
    throw new Error(
      `First simulation frame did not arrive: ${JSON.stringify({ state, errors })}`,
      { cause: error },
    );
  }
}
test('desktop complete ride, reward, save, garage and all screens', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByTestId('garage-model')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Spielnavigation' }).getByRole('button')).toHaveCount(4);
  await expect(page.getByRole('navigation', { name: 'Spielnavigation' }).getByRole('button', { name: 'FAHREN', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'FAHRT STARTEN', exact: true }),
  ).toBeVisible();
  await page.locator('canvas').waitFor();
  await page.screenshot({ path: 'outputs/garage-start-desktop.png' });
  await page.getByRole('button', { name: 'FAHRT STARTEN', exact: true }).click();
  await page.getByTestId('first-ride-start').click();
  await expect(page.getByTestId('ride-screen')).toHaveAttribute(
    'data-phase',
    'playing',
  );
  await waitForFirstSimulation(page, errors);
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('ride-screen')).toHaveAttribute(
    'data-lane',
    '-1',
  );
  await page.keyboard.press('ArrowRight');
  await page.keyboard.down('w');
  await expect(page.getByTestId('ride-screen')).toHaveAttribute(
    'data-forward',
    'true',
  );
  await page.keyboard.up('w');
  await page.keyboard.down('s');
  await expect(page.getByTestId('ride-screen')).toHaveAttribute(
    'data-wheelie',
    'true',
  );
  await page.waitForTimeout(200);
  await page.keyboard.up('s');
  await page.screenshot({ path: 'outputs/ride-desktop.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByText('PAUSE.')).toBeVisible();
  await page.getByRole('button', { name: 'WEITERFAHREN' }).click();
  await page.keyboard.press('p');
  await page.getByRole('button', { name: 'FAHRT BEENDEN' }).click();
  await expect(page.getByRole('button', { name: 'NOCHMAL FAHREN' })).toBeVisible();
  await page.screenshot({ path: 'outputs/results-desktop.png' });
  const save = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('pfusch:player:v1')!),
  );
  expect(save.runsPlayed).toBe(1);
  expect(save.xp).toBeGreaterThan(0);
  await page.reload();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('pfusch:player:v1')!).runsPlayed,
    ),
  ).toBe(1);
  await expect(page.getByTestId('garage-model')).toBeVisible();
  await page.getByRole('tab', { name: 'FAHRER', exact: true }).click();
  const products = await (await page.request.get('/catalog/products.json')).json() as Product[];
  const jacket = products.find((product) => product.handle === 'unisex-windbreaker')!;
  const card = page.getByTestId('product-card').filter({ has: page.getByRole('heading', { name: jacket.title, exact: true }) });
  const beforePreview = await saved(page);
  await card.getByRole('button', { name: 'ANSEHEN', exact: true }).click();
  expect(await saved(page)).toEqual(beforePreview);
  await card.getByRole('button', { name: /KAUFEN/ }).click();
  expect((await saved(page)).equipped.upper).toBeUndefined();
  await card.getByRole('button', { name: 'AUSRÜSTEN', exact: true }).click();
  await expect(card.getByRole('button', { name: 'ABLEGEN', exact: true })).toBeVisible();
  expect((await saved(page)).equipped.upper).toBe(jacket.id);
  await page.getByRole('tab', { name: 'MOTORRAD', exact: true }).click();
  await page.getByRole('button', { name: 'Ansehen Supermoto', exact: true }).click();
  expect((await saved(page)).bike).toBe('125');
  await page.screenshot({ path: 'outputs/garage-desktop.png' });
  await page.getByRole('tab', { name: 'FORTSCHRITT', exact: true }).click();
  await expect(page.getByText('DEIN FORTSCHRITT', { exact: true })).toBeVisible();
  for (const name of ['AUFGABEN', 'BELOHNUNGEN', 'RANG']) {
    await page
      .getByRole('navigation')
      .getByRole('button', { name, exact: true })
      .click();
    await expect(page.locator('main h1')).toBeVisible();
  }
  await expect(page.getByText('DEMO-FAHRER', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await expect(
    page.getByRole('switch', { name: /Performance-Modus/ }),
  ).toBeVisible();
  await page.getByRole('switch', { name: /Performance-Modus/ }).click();
  expect(errors).toEqual([]);
});
test('mobile portrait touch controls, swipe, natural collision and restart', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'FAHRT STARTEN', exact: true }),
  ).toBeVisible();
  await page.locator('canvas').waitFor();
  await page.screenshot({ path: 'outputs/garage-start-mobile.png' });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'FAHRT STARTEN', exact: true }).tap();
  await page.getByTestId('first-ride-start').tap();
  await expect(page.getByTestId('ride-screen')).toHaveAttribute(
    'data-phase',
    'playing',
  );
  await waitForFirstSimulation(page, errors);
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('ride-screen')).toHaveAttribute(
    'data-lane',
    '-1',
  );
  await page.keyboard.press('w');
  await expect(page.getByTestId('ride-screen')).toHaveAttribute(
    'data-height',
    '0.00',
  );
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 130, y: 420 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 265, y: 420 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await expect(page.getByTestId('ride-screen')).toHaveAttribute(
    'data-lane',
    '0',
  );
  await page.screenshot({ path: 'outputs/ride-mobile.png' });
  await expect(
    page.getByRole('button', { name: 'NOCHMAL FAHREN', exact: true }),
  ).toBeVisible({ timeout: 100000 });
  await page.getByRole('button', { name: 'NOCHMAL FAHREN', exact: true }).tap();
  await expect(page.getByTestId('ride-screen')).toHaveAttribute(
    'data-phase',
    'playing',
  );
  await waitForFirstSimulation(page, errors);
  await page.keyboard.press('p');
  await page.getByRole('button', { name: 'FAHRT BEENDEN' }).tap();
  await page.getByRole('button', { name: 'ZUR GARAGE' }).tap();
  await page.getByRole('tab', { name: 'FAHRER' }).tap();
  await expect(page.getByTestId('product-card').first()).toBeVisible();
  await page.screenshot({ path: 'outputs/garage-mobile.png', fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});
