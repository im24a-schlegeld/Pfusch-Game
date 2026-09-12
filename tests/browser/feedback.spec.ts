import { test, expect } from '@playwright/test';

test.use({ hasTouch: true });

test('earned feedback sits below metrics without covering controls at four sizes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-09-12T10:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-12T10:00:01Z'));
  await page.addInitScript(() => {
    Math.random = () => 5489 / 0xffffffff;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'LET’S RIDE', exact: true }).click();
  await page.getByRole('button', { name: 'GOT IT. LET’S RIDE' }).click();
  await page.locator('canvas').waitFor();
  await page.clock.runFor(2200);
  const ride = page.getByTestId('ride-screen');
  for (
    let i = 0;
    i < 70 && !(await page.locator('.skill-event').count());
    i++
  ) {
    const angle = Number(await ride.getAttribute('data-angle'));
    const velocity = Number(await ride.getAttribute('data-angular-velocity'));
    const demand = (0.72 - angle) * 5 - velocity * 3;
    if (demand > 0.08) await page.keyboard.down('s');
    else await page.keyboard.up('s');
    if (demand < -0.12) await page.keyboard.down('w');
    else await page.keyboard.up('w');
    await page.clock.runFor(100);
  }
  await expect(page.locator('.skill-event')).toBeVisible();
  await page.keyboard.up('s');
  await page.keyboard.up('w');
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [820, 1180],
    [667, 360],
  ]) {
    await page.setViewportSize({ width, height });
    // Resize clears the WebGL drawing buffer; render the next real frame.
    await page.clock.runFor(100);
    const feedback = (await page.locator('.skill-event').boundingBox())!;
    const metrics = (await page.locator('.ride-metrics').boundingBox())!;
    const controls = (await page.locator('.ride-controls').boundingBox())!;
    expect(feedback.x).toBe(metrics.x);
    expect(feedback.y).toBeGreaterThanOrEqual(metrics.y + metrics.height);
    expect(feedback.y + feedback.height).toBeLessThan(controls.y);
    expect(feedback.x + feedback.width).toBeLessThan(width - 16);
    await page.screenshot({ path: `outputs/feedback-${width}x${height}.png` });
  }
  expect(errors).toEqual([]);
});
