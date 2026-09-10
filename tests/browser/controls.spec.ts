import { test, expect, type Page } from '@playwright/test';
import { Engine, STEP } from '../../app/game/engine';
import { BIKES } from '../../app/domain/config';
test.use({ hasTouch: true });

// Choose an ordinary seeded roadwork wave, reached through real gameplay.
function rampRoute() {
  for (let seed = 1; seed < 100; seed++) {
    const engine = new Engine(BIKES[0], seed);
    engine.start();
    for (let i = 0; i < 120; i++) engine.advance(STEP);
    const ramp = engine.obstacles.find((o) => o.active && o.kind === 'ramp');
    const traffic = engine.obstacles.find((o) => o.active && o.kind !== 'ramp');
    if (!ramp || !traffic) continue;
    const safe = [-1, 0, 1].find((l) => l !== ramp.lane && l !== traffic.lane)!;
    if (Math.abs(safe - ramp.lane) === 1)
      return {
        seed,
        lane: ramp.lane,
        safe,
        distance: engine.distance + ramp.z,
      };
  }
  throw Error('No seeded adjacent safe ramp route');
}
const route = rampRoute();
async function start(page: Page) {
  await page.clock.install({ time: new Date('2026-09-10T10:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-10T10:00:01Z'));
  await page.addInitScript((seed) => {
    Math.random = () => seed / 0xffffffff;
  }, route.seed);
  await page.goto('/');
  await page.getByRole('button', { name: 'LET’S RIDE', exact: true }).click();
  await page.getByRole('button', { name: 'GOT IT. LET’S RIDE' }).click();
  await page.locator('canvas').waitFor();
  await page.clock.runFor(100);
  await page.clock.runFor(2100);
  await expect(page.getByTestId('ride-screen')).toHaveAttribute(
    'data-phase',
    'playing',
  );
}
async function airLaneTest(page: Page, mobile: boolean) {
  const ride = page.getByTestId('ride-screen');
  const move = async (direction: number) => {
    if (mobile)
      await page
        .getByRole('button', {
          name: direction < 0 ? 'Dodge left' : 'Dodge right',
          exact: true,
        })
        .tap();
    else await page.keyboard.press(direction < 0 ? 'ArrowLeft' : 'ArrowRight');
  };
  if (route.lane !== 0) await move(route.lane);
  while (Number(await ride.getAttribute('data-distance')) < route.distance - 3)
    await page.clock.runFor(100);
  for (
    let i = 0;
    i < 20 && Number(await ride.getAttribute('data-height')) === 0;
    i++
  )
    await page.clock.runFor(16);
  expect(Number(await ride.getAttribute('data-height'))).toBeGreaterThan(0);
  const direction = route.safe - route.lane;
  await move(direction);
  await page.clock.runFor(80);
  await expect(ride).toHaveAttribute('data-lane', String(route.safe));
  await move(-direction);
  await page.clock.runFor(80);
  await expect(ride).toHaveAttribute('data-lane', String(route.safe));
  expect(Number(await ride.getAttribute('data-height'))).toBeGreaterThan(0);
  await page.clock.runFor(650);
  await expect(ride).toHaveAttribute('data-height', '0.00');
  await move(-direction);
  await page.clock.runFor(80);
  await expect(ride).toHaveAttribute('data-lane', String(route.lane));
  await expect(ride).toHaveAttribute('data-phase', 'playing');
}
test('keyboard wheelie, grounded lift and exactly one steering input on a real ramp', async ({
  page,
}) => {
  await start(page);
  const ride = page.getByTestId('ride-screen');
  for (const key of ['s', 'ArrowDown']) {
    await page.keyboard.down(key);
    await page.clock.runFor(100);
    await expect(ride).toHaveAttribute('data-wheelie', 'true');
    await page.keyboard.up(key);
    await page.clock.runFor(100);
    await expect(ride).toHaveAttribute('data-wheelie', 'false');
  }
  await page.keyboard.press('ArrowUp');
  await page.clock.runFor(100);
  await expect(ride).toHaveAttribute('data-lift', 'true');
  await expect(ride).toHaveAttribute('data-height', '0.00');
  await airLaneTest(page, false);
});
test('mobile wheelie, lift and airborne steering use the same rules', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context
    .newCDPSession(page)
    .then((cdp) =>
      cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true }),
    );
  await start(page);
  const ride = page.getByTestId('ride-screen');
  const box = (await page
    .getByRole('button', { name: 'Hold wheelie' })
    .boundingBox())!;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
  });
  await page.clock.runFor(100);
  await expect(ride).toHaveAttribute('data-wheelie', 'true');
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await page.clock.runFor(100);
  await expect(ride).toHaveAttribute('data-wheelie', 'false');
  await page
    .getByRole('button', { name: 'Lift front wheel', exact: true })
    .tap();
  await page.clock.runFor(100);
  await expect(ride).toHaveAttribute('data-lift', 'true');
  await expect(ride).toHaveAttribute('data-height', '0.00');
  await airLaneTest(page, true);
});
