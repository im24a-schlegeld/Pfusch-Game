import { test, expect, type Page } from '@playwright/test';
import { newPlayer } from '../../app/domain/progression';
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
  // A paused browser clock must also advance React's lazy-scene reveal timer.
  await expect
    .poll(
      async () => {
        await page.clock.runFor(100);
        return page.locator('canvas').count();
      },
      { timeout: 20000 },
    )
    .toBe(1);
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
async function expectWeight(page: Page, throttle: number, forward: number) {
  const ride = page.getByTestId('ride-screen');
  // Native pointer moves can arrive after the last throttled HUD frame.
  // Keep advancing the paused test clock until that input has been rendered.
  await expect
    .poll(async () => {
      await page.clock.runFor(80);
      return Promise.all([
        ride.getAttribute('data-throttle-input'),
        ride.getAttribute('data-forward-input'),
      ]);
    })
    .toEqual([throttle.toFixed(3), forward.toFixed(3)]);
}

for (const bike of ['125', 'scooter', '450', '701']) {
  test(`${bike} gives a finite initial tug with keyboard and touch`, async ({
    page,
    context,
  }) => {
    const player = newPlayer();
    player.bike = bike;
    await page.addInitScript(
      (p) => localStorage.setItem('pfusch:player:v1', JSON.stringify(p)),
      player,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await start(page);
    const ride = page.getByTestId('ride-screen');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.keyboard.down('s');
    // Canceling an unrelated swipe must not release the held key.
    await page
      .getByLabel('Swipe left or right to dodge')
      .dispatchEvent('pointercancel', { pointerId: 9 });
    await page.clock.runFor(350);
    const angle = Number(await ride.getAttribute('data-angle'));
    expect(angle).toBeGreaterThan(0.04);
    expect(angle).toBeLessThan(0.35);
    await expect(ride).toHaveAttribute('data-throttle-input', '1.000');
    await page.screenshot({ path: `outputs/initial-pull-${bike}.png` });
    await page.keyboard.up('s');
    await page.keyboard.down('w');
    await settle(page);
    await page.keyboard.up('w');
    await page.clock.runFor(250);
    const cdp = await context.newCDPSession(page);
    const b = (await page
      .getByRole('button', { name: 'Hold wheelie', exact: true })
      .boundingBox())!;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ id: 1, x: b.x + b.width / 2, y: b.y + b.height / 2 }],
    });
    await page.clock.runFor(350);
    expect(Number(await ride.getAttribute('data-angle'))).toBeGreaterThan(0.04);
    const pause = (await page
      .getByRole('button', { name: 'Pause ride' })
      .boundingBox())!;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { id: 1, x: b.x + b.width / 2, y: b.y + b.height / 2 },
        { id: 2, x: pause.x + pause.width / 2, y: pause.y + pause.height / 2 },
      ],
    });
    await expect(ride).toHaveAttribute('data-phase', 'paused');
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    // The pointer that opened the dialog must not dismiss it on release.
    await page.clock.runFor(350);
    await expect(ride).toHaveAttribute('data-phase', 'paused');
    await expect(ride).toHaveAttribute('data-throttle-input', '0.000');
    expect(errors).toEqual([]);
  });
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

for (const [width, height] of [
  [320, 568],
  [390, 844],
  [820, 1180],
  [667, 360],
]) {
  test(`one thumb meters throttle and correction at ${width}x${height}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height });
    await start(page);
    const ride = page.getByTestId('ride-screen');
    const rear = (await page
      .getByRole('button', { name: 'Hold wheelie', exact: true })
      .boundingBox())!;
    const front = (await page
      .getByRole('button', { name: 'Hold forward weight', exact: true })
      .boundingBox())!;
    const left = (await page
      .getByRole('button', { name: 'Dodge left', exact: true })
      .boundingBox())!;
    for (const b of [rear, front, left]) {
      expect(b.width).toBeGreaterThanOrEqual(45);
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height).toBeLessThanOrEqual(height);
      expect(b.x + b.width).toBeLessThanOrEqual(width);
    }
    expect(left.x + left.width).toBeLessThan(rear.x);
    const cdp = await context.newCDPSession(page);
    const x = rear.x + rear.width / 2,
      y = rear.y + rear.height / 2;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ id: 1, x, y }],
    });
    await rise(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ id: 1, x, y: y - 28 }],
    });
    await expectWeight(page, 0.5, 0);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ id: 1, x, y: y - 56 }],
    });
    await expectWeight(page, 0, 0);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ id: 1, x, y: y - 112 }],
    });
    await expectWeight(page, 0, 1);
    // A second thumb can still dodge while the first holds correction.
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { id: 1, x, y: y - 112 },
        { id: 2, x: left.x + left.width / 2, y: left.y + left.height / 2 },
      ],
    });
    await expectWeight(page, 0, 1);
    await expect(ride).toHaveAttribute('data-lane', '-1');
    await settle(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchCancel',
      touchPoints: [],
    });
    await expectWeight(page, 0, 0);
    await page.screenshot({ path: `outputs/controls-${width}x${height}.png` });
  });
}
