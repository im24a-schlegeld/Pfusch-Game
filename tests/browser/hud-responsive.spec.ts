import { expect, test } from '@playwright/test';
import type { Player } from '../../app/domain/types';

test('top instruments stay separate at desktop and narrow phone sizes', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-09-23T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-23T12:00:01Z'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(async () => {
    const modulePath = '/app/domain/progression.ts';
    const { newPlayer } = (await import(/* @vite-ignore */ modulePath)) as {
      newPlayer: () => Player;
    };
    const player = newPlayer();
    player.settings.tutorialSeen = true;
    localStorage.setItem('pfusch:player:v1', JSON.stringify(player));
  });
  await page.reload();
  await page.getByRole('button', { name: 'LOSFAHREN', exact: true }).click();
  await expect
    .poll(
      async () => {
        await page.clock.runFor(100);
        return page.locator('.scene-ride canvas').count();
      },
      { timeout: 30000 },
    )
    .toBe(1);
  await expect
    .poll(
      async () => {
        await page.clock.fastForward(700);
        await page.clock.runFor(16);
        return page.getByTestId('ride-screen').getAttribute('data-phase');
      },
      { timeout: 30000 },
    )
    .toBe('playing');
  await expect(page.getByTestId('sign-progress')).toHaveAttribute(
    'data-ready',
    'true',
  );

  for (const [width, height] of [
    [2560, 1440],
    [1920, 1080],
    [844, 390],
    [390, 844],
    [320, 568],
  ]) {
    await page.setViewportSize({ width, height });
    await page.clock.runFor(100);
    const layout = await page.evaluate(() => {
      const selectors = [
        '.v42-score',
        '.v42-metrics',
        '.ride-balance',
        '.v42-sign-slot',
        '.v42-pause',
      ];
      const boxes = selectors.map((selector) => {
        const element = document.querySelector<HTMLElement>(selector)!;
        const rect = element.getBoundingClientRect();
        return {
          selector,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
          background: getComputedStyle(element).backgroundColor,
        };
      });
      return {
        boxes,
        screenWidth: innerWidth,
        signText: document.querySelector('[data-testid="sign-progress"]')!
          .textContent,
        score: document.querySelector('.v42-score strong')!.textContent,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    const balance = layout.boxes[2],
      sign = layout.boxes[3],
      pause = layout.boxes[4];
    expect(balance.x + balance.width / 2).toBeCloseTo(width / 2, 0);
    expect(balance.y).toBeLessThan(24);
    expect(sign.y).toBeLessThan(24);
    expect(pause.y).toBeLessThan(24);
    expect(pause.width).toBeGreaterThanOrEqual(44);
    expect(pause.height).toBeGreaterThanOrEqual(44);
    expect(pause.right).toBe(width - 10);
    for (const box of [balance, sign, pause])
      expect(box.background).toBe('rgba(0, 0, 0, 0)');
    for (const box of layout.boxes) {
      expect(box.x, box.selector).toBeGreaterThanOrEqual(0);
      expect(box.right, box.selector).toBeLessThanOrEqual(width);
      expect(box.bottom, box.selector).toBeLessThan(height);
    }
    for (let i = 0; i < layout.boxes.length; i++)
      for (let j = i + 1; j < layout.boxes.length; j++) {
        const a = layout.boxes[i],
          b = layout.boxes[j];
        const overlap =
          Math.min(a.right, b.right) - Math.max(a.x, b.x) > 0 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 0;
        expect(
          overlap,
          `${a.selector} overlaps ${b.selector} at ${width} × ${height}`,
        ).toBe(false);
      }
    expect(layout.signText).toBe('');
    expect(layout.overflow).toBe(false);
    await expect(page.locator('.score-gain[data-kind="ride"]')).toHaveCount(0);
    await expect(page.locator('.ride-balance')).toContainText('KIPPUNKT');
    await page.screenshot({
      path: info.outputPath(`hud-${width}x${height}.png`),
    });
  }
  await page.getByRole('button', { name: 'Fahrt pausieren' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(errors).toEqual([]);
});
