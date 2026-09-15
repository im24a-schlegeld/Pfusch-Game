import { test, expect, type Page } from '@playwright/test';

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
  await expect(
    page.getByRole('button', { name: 'LET’S RIDE', exact: true }),
  ).toBeVisible();
  await page.locator('canvas').waitFor();
  await page.screenshot({ path: 'outputs/menu-desktop.png' });
  await page.getByRole('button', { name: 'LET’S RIDE', exact: true }).click();
  await page.getByRole('button', { name: 'GOT IT. LET’S RIDE' }).click();
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
  await expect(page.getByText('RIDE PAUSED.')).toBeVisible();
  await page.getByRole('button', { name: 'BACK TO THE STREETS' }).click();
  await page.keyboard.press('p');
  await page.getByRole('button', { name: 'END RIDE & COLLECT' }).click();
  await expect(page.getByRole('button', { name: 'RIDE AGAIN' })).toBeVisible();
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
  await page.getByRole('button', { name: 'OPEN GARAGE' }).click();
  await page.getByRole('tab', { name: 'RIDER' }).click();
  await expect(page.getByTestId('product-card')).toHaveCount(16);
  await page
    .getByTestId('product-card')
    .first()
    .getByRole('button', { name: 'PREVIEW / TRY ON', exact: true })
    .click();
  await page.getByRole('button', { name: /UNLOCK DIGITAL/ }).click();
  const afterUnlock = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('pfusch:player:v1')!),
  );
  expect(afterUnlock.equipped.upper).toBeUndefined();
  await page
    .getByRole('button', { name: 'EQUIP FOR GAMEPLAY', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'EQUIPPED', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'LEAVE PREVIEW', exact: true })
    .click();
  await page.getByRole('tab', { name: 'BIKE', exact: true }).click();
  await page.getByRole('button', { name: 'Asphalt paint' }).click();
  await page.screenshot({ path: 'outputs/garage-desktop.png' });
  await page.getByRole('tab', { name: 'PROGRESS', exact: true }).click();
  await expect(page.getByText('FROM NEW BLOOD TO CREW')).toBeVisible();
  for (const name of ['CHALLENGES', 'REWARDS', 'RANKING']) {
    await page
      .getByRole('navigation')
      .getByRole('button', { name, exact: true })
      .click();
    await expect(page.locator('main h1')).toBeVisible();
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByRole('switch', { name: 'Performance mode' }),
  ).toBeVisible();
  await page.getByRole('switch', { name: 'Performance mode' }).click();
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
    page.getByRole('button', { name: 'LET’S RIDE', exact: true }),
  ).toBeVisible();
  await page.locator('canvas').waitFor();
  await page.screenshot({ path: 'outputs/menu-mobile.png' });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'LET’S RIDE', exact: true }).tap();
  await page.getByRole('button', { name: 'GOT IT. LET’S RIDE' }).tap();
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
    page.getByRole('button', { name: 'RIDE AGAIN', exact: true }),
  ).toBeVisible({ timeout: 100000 });
  await page.getByRole('button', { name: 'RIDE AGAIN', exact: true }).tap();
  await expect(page.getByTestId('ride-screen')).toHaveAttribute(
    'data-phase',
    'playing',
  );
  await waitForFirstSimulation(page, errors);
  await page.keyboard.press('p');
  await page.getByRole('button', { name: 'END RIDE & COLLECT' }).tap();
  await page.getByRole('button', { name: 'BACK TO GARAGE' }).tap();
  await page.getByRole('tab', { name: 'RIDER' }).tap();
  await expect(page.getByTestId('product-card')).toHaveCount(16);
  await page.screenshot({ path: 'outputs/garage-mobile.png', fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});
