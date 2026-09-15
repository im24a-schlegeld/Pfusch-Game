import { test, expect, type Page, type CDPSession } from '@playwright/test';
import { newPlayer } from '../../app/domain/progression';
test.use({ hasTouch: true });
const startupDiagnostics = new WeakMap<
  Page,
  {
    started: number;
    events: string[];
    pending: Set<string>;
  }
>();
test.beforeEach(async ({ page }) => {
  const diagnostic = {
    started: Date.now(),
    events: [] as string[],
    pending: new Set<string>(),
  };
  startupDiagnostics.set(page, diagnostic);
  page.on('pageerror', (error) =>
    diagnostic.events.push(`pageerror: ${error.message}`),
  );
  page.on('console', (message) => {
    if (message.type() === 'error')
      diagnostic.events.push(`console: ${message.text()}`);
  });
  page.on('request', (request) => diagnostic.pending.add(request.url()));
  page.on('requestfinished', (request) =>
    diagnostic.pending.delete(request.url()),
  );
  page.on('requestfailed', (request) => {
    diagnostic.pending.delete(request.url());
    diagnostic.events.push(
      `requestfailed: ${request.url()} ${request.failure()?.errorText}`,
    );
  });
});
test.afterEach(async ({ page }, testInfo) => {
  const diagnostic = startupDiagnostics.get(page)!;
  if (testInfo.status !== testInfo.expectedStatus)
    await testInfo.attach('startup-diagnostics', {
      body: JSON.stringify(
        {
          elapsedMs: Date.now() - diagnostic.started,
          events: diagnostic.events,
          pending: [...diagnostic.pending],
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
});
async function start(page: Page) {
  const diagnostic = startupDiagnostics.get(page)!;
  const mark = (event: string) =>
    diagnostic.events.push(`${Date.now() - diagnostic.started}ms: ${event}`);
  await page.clock.install({ time: new Date('2026-09-11T10:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-11T10:00:01Z'));
  await page.addInitScript(() => {
    Math.random = () => 5489 / 0xffffffff;
  });
  await page.goto('/');
  mark('menu loaded');
  await page.getByRole('button', { name: 'LET’S RIDE', exact: true }).click();
  await page.getByRole('button', { name: 'GOT IT. LET’S RIDE' }).click();
  mark('tutorial dismissed');
  // Mounting the scene and compiling its first GPU programs can block the page
  // thread. Do not include that work inside a short, repeatedly evaluated clock
  // predicate: the canvas may already exist while that predicate is still busy.
  await expect(page.locator('canvas')).toHaveCount(1, { timeout: 60000 });
  mark('canvas mounted');
  await page.clock.runFor(100);
  mark('first frame complete');
  await page.clock.runFor(2200);
  mark('countdown advanced');
  await expect(page.getByTestId('ride-screen')).toHaveAttribute(
    'data-phase',
    'playing',
  );
}
type Point = { id: number; x: number; y: number };
async function touch(
  cdp: CDPSession,
  type: 'touchStart' | 'touchEnd' | 'touchMove' | 'touchCancel',
  points: Point[],
) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}
async function weight(page: Page, throttle: number, forward: number) {
  await expect
    .poll(async () => {
      await page.clock.runFor(80);
      const ride = page.getByTestId('ride-screen');
      return [
        await ride.getAttribute('data-throttle-input'),
        await ride.getAttribute('data-forward-input'),
      ];
    })
    .toEqual([throttle.toFixed(3), forward.toFixed(3)]);
}
async function pairTap(cdp: CDPSession, x: number, y: number) {
  await touch(cdp, 'touchStart', [{ id: 1, x, y }]);
  await touch(cdp, 'touchStart', [
    { id: 1, x, y },
    { id: 2, x: x + 45, y },
  ]);
  await touch(cdp, 'touchEnd', []);
}
async function expectLane(page: Page, value: string) {
  await expect
    .poll(async () => {
      await page.clock.runFor(80);
      return page.getByTestId('ride-screen').getAttribute('data-lane');
    })
    .toBe(value);
}
for (const bike of ['125', 'scooter', '450', '701'])
  test(
    bike + ': neutral touch, analog slide and unchanged keyboard',
    async ({ page, context }) => {
      const player = newPlayer();
      player.bike = bike;
      await page.addInitScript(
        (p) => localStorage.setItem('pfusch:player:v1', JSON.stringify(p)),
        player,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await start(page);
      const ride = page.getByTestId('ride-screen'),
        cdp = await context.newCDPSession(page);
      await expect(ride.getByRole('button')).toHaveCount(0);
      await touch(cdp, 'touchStart', [{ id: 1, x: 195, y: 420 }]);
      await page.clock.runFor(350);
      await expect(ride).toHaveAttribute('data-angle', '0.000');
      await touch(cdp, 'touchMove', [{ id: 1, x: 195, y: 500 }]);
      await page.clock.runFor(350);
      expect(Number(await ride.getAttribute('data-angle'))).toBeGreaterThan(
        0.04,
      );
      await touch(cdp, 'touchMove', [{ id: 1, x: 195, y: 340 }]);
      await page.clock.runFor(1400);
      await expect(ride).toHaveAttribute('data-angle', '0.000');
      await touch(cdp, 'touchEnd', []);
      await weight(page, 0, 0);
      await page.clock.runFor(300);
      for (const [rear, front] of [
        ['s', 'w'],
        ['ArrowDown', 'ArrowUp'],
      ]) {
        await page.keyboard.down(rear);
        await page
          .locator('.gesture-zone')
          .dispatchEvent('pointercancel', { pointerId: 99 });
        await page.clock.runFor(350);
        expect(Number(await ride.getAttribute('data-angle'))).toBeGreaterThan(
          0.04,
        );
        await expect(ride).toHaveAttribute('data-throttle-input', '1.000');
        await page.keyboard.up(rear);
        await page.keyboard.down(front);
        await page.clock.runFor(1400);
        await page.keyboard.up(front);
        await expect(ride).toHaveAttribute('data-angle', '0.000');
        await page.clock.runFor(300);
      }
      await page.keyboard.press(' ');
      await page.clock.runFor(100);
      await expect(ride).toHaveAttribute('data-height', '0.00');
      await expect(ride).toHaveAttribute('data-angle', '0.000');
    },
  );
for (const [width, height] of [
  [320, 568],
  [390, 844],
  [820, 1180],
  [667, 360],
])
  test(
    'one finger steers and meters without buttons at ' + width + 'x' + height,
    async ({ page, context }) => {
      await page.setViewportSize({ width, height });
      await start(page);
      const ride = page.getByTestId('ride-screen'),
        cdp = await context.newCDPSession(page);
      const x = width / 2,
        y = height / 2;
      await expect(ride.getByRole('button')).toHaveCount(0);
      await touch(cdp, 'touchStart', [{ id: 1, x, y }]);
      await touch(cdp, 'touchMove', [{ id: 1, x, y: y + 44 }]);
      await weight(page, 0.5, 0);
      await touch(cdp, 'touchMove', [{ id: 1, x: x - 55, y: y + 44 }]);
      await weight(page, 0.5, 0);
      await expectLane(page, '-1');
      await touch(cdp, 'touchMove', [{ id: 1, x: x + 5, y: y + 44 }]);
      await weight(page, 0.5, 0);
      await expectLane(page, '0');
      await touch(cdp, 'touchMove', [{ id: 1, x: x + 5, y }]);
      await weight(page, 0, 0);
      await touch(cdp, 'touchMove', [{ id: 1, x: x + 5, y: y - 80 }]);
      await weight(page, 0, 1);
      await touch(cdp, 'touchCancel', []);
      await weight(page, 0, 0);
      expect(
        await page.evaluate(() => [
          scrollX,
          scrollY,
          document.documentElement.scrollWidth <= innerWidth,
        ]),
      ).toEqual([0, 0, true]);
      await expect(page.locator('.sign-progress')).toBeVisible();
      await page.screenshot({
        path: 'outputs/gesture-controls-' + width + 'x' + height + '.png',
      });
    },
  );
test('two-finger tap pauses and resumes; blur clears input without a phantom dialog click', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const ride = page.getByTestId('ride-screen'),
    cdp = await context.newCDPSession(page);
  await pairTap(cdp, 160, 420);
  await page.clock.runFor(100);
  await expect(ride).toHaveAttribute('data-phase', 'paused');
  const distance = await ride.getAttribute('data-distance');
  await page.clock.runFor(500);
  await expect(ride).toHaveAttribute('data-distance', distance!);
  await expect(ride).toHaveAttribute('data-throttle-input', '0.000');
  const dialog = (await page.getByRole('dialog').boundingBox())!;
  await pairTap(cdp, dialog.x + 40, dialog.y + 45);
  await page.clock.runFor(100);
  await expect(ride).toHaveAttribute('data-phase', 'playing');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(ride.getByRole('button')).toHaveCount(0);
  await touch(cdp, 'touchStart', [{ id: 3, x: 190, y: 420 }]);
  await touch(cdp, 'touchMove', [{ id: 3, x: 190, y: 500 }]);
  await weight(page, 1, 0);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.clock.runFor(100);
  await expect(ride).toHaveAttribute('data-phase', 'paused');
  await expect(ride).toHaveAttribute('data-throttle-input', '0.000');
  await touch(cdp, 'touchCancel', []);
});
