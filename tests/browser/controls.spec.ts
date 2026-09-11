import { test, expect, type Page } from '@playwright/test';
test.use({ hasTouch: true });
async function start(page: Page) {
  await page.clock.install({ time: new Date('2026-09-11T10:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-11T10:00:01Z'));
  await page.addInitScript(() => {
    Math.random = () => 5489 / 0xffffffff;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'LET’S RIDE', exact: true }).click();
  await page.getByRole('button', { name: 'GOT IT. LET’S RIDE' }).click();
  await page.locator('canvas').waitFor();
  await page.clock.runFor(2200);
  await expect(page.getByTestId('ride-screen')).toHaveAttribute(
    'data-phase',
    'playing',
  );
}
async function rise(page: Page) {
  const ride = page.getByTestId('ride-screen');
  for (
    let i = 0;
    i < 30 && Number(await ride.getAttribute('data-angle')) < 0.3;
    i++
  )
    await page.clock.runFor(100);
  expect(Number(await ride.getAttribute('data-angle'))).toBeGreaterThan(0.3);
  await expect(ride).toHaveAttribute('data-wheelie', 'true');
  await expect(ride).toHaveAttribute('data-height', '0.00');
}
async function settle(page: Page) {
  const ride = page.getByTestId('ride-screen');
  await page.clock.runFor(1300);
  await expect(ride).toHaveAttribute('data-angle', '0.000');
  await expect(ride).toHaveAttribute('data-height', '0.00');
}
test('S and Down raise; W and Up correct; Space and upward swipe never launch', async ({
  page,
}) => {
  await start(page);
  const ride = page.getByTestId('ride-screen');
  for (const [rear, front] of [
    ['s', 'w'],
    ['ArrowDown', 'ArrowUp'],
  ]) {
    await page.keyboard.down(rear);
    await rise(page);
    const raised = Number(await ride.getAttribute('data-angle'));
    await page.keyboard.up(rear);
    await page.keyboard.down(front);
    await expect
      .poll(async () => {
        await page.clock.runFor(100);
        return Number(await ride.getAttribute('data-angular-velocity'));
      })
      .toBeLessThan(0);
    expect(Number(await ride.getAttribute('data-angle'))).toBeLessThan(
      raised + 0.15,
    );
    await settle(page);
    await page.keyboard.up(front);
  }
  await page.keyboard.press(' ');
  await page.keyboard.down('ArrowUp');
  await page.clock.runFor(100);
  await expect(ride).toHaveAttribute('data-height', '0.00');
  await expect(ride).toHaveAttribute('data-angle', '0.000');
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('ArrowLeft');
  await page.clock.runFor(80);
  await expect(ride).toHaveAttribute('data-lane', '-1');
  await page.keyboard.press('ArrowRight');
  await page.clock.runFor(80);
  await expect(ride).toHaveAttribute('data-lane', '0');
  await expect(
    page.getByRole('button', { name: /jump|lift front/i }),
  ).toHaveCount(0);
});
test('mobile hold, release and forward correction use the same balance state', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const cdp = await context.newCDPSession(page);
  const touch = async (name: string, down: boolean) => {
    const b = (await page
      .getByRole('button', { name, exact: true })
      .boundingBox())!;
    await cdp.send('Input.dispatchTouchEvent', {
      type: down ? 'touchStart' : 'touchEnd',
      touchPoints: down
        ? [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }]
        : [],
    });
  };
  await touch('Hold wheelie', true);
  await rise(page);
  await touch('Hold wheelie', false);
  await touch('Hold forward weight', true);
  await settle(page);
  await touch('Hold forward weight', false);
  const ride = page.getByTestId('ride-screen');
  await page.clock.runFor(100);
  await expect(ride).toHaveAttribute('data-forward', 'false');
  // Vertical ride gestures have no launch action.
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 190, y: 460 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 190, y: 320 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await page.clock.runFor(100);
  await expect(ride).toHaveAttribute('data-height', '0.00');
  await page.getByRole('button', { name: 'Dodge left', exact: true }).tap();
  await page.clock.runFor(100);
  await expect(ride).toHaveAttribute('data-lane', '-1');
  await page.screenshot({ path: 'outputs/balance-mobile.png' });
});
