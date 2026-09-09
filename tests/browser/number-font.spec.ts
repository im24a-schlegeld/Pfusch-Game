import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';

type NumberDraw = {
  number: string;
  font: string;
  descent2: number;
  descent3: number;
  image: string;
};
declare global {
  interface Window {
    numberDraws: NumberDraw[];
  }
}

test('real Merriweather oldstyle numbers reach the garment texture and Garage preview', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  // Observe the actual garment canvas, rather than a separate imitation of its text renderer.
  await page.addInitScript(() => {
    window.numberDraws = [];
    // The original is deliberately invoked with the intercepted context via call below.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (
      text,
      x,
      y,
      maxWidth,
    ) {
      if (maxWidth === undefined) original.call(this, text, x, y);
      else original.call(this, text, x, y, maxWidth);
      if (
        this.canvas.width === 1024 &&
        /^\d{1,2}$/.test(text) &&
        this.font.includes('Merriweather')
      ) {
        const saved = this.textBaseline;
        this.textBaseline = 'alphabetic';
        window.numberDraws.push({
          number: text,
          font: this.font,
          descent2: this.measureText('2').actualBoundingBoxDescent,
          descent3: this.measureText('3').actualBoundingBoxDescent,
          image: this.canvas.toDataURL(),
        });
        this.textBaseline = saved;
      }
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'OPEN GARAGE' }).click();
  const garageCanvas = await page.locator('canvas').elementHandle();
  expect(garageCanvas).toBeTruthy();
  await page
    .getByRole('button', { name: 'Preview Racing Zipper', exact: true })
    .click();
  await page.getByRole('button', { name: 'BACK', exact: true }).click();
  const proof = page.getByLabel('Number customization preview');
  for (const number of ['23', '32', '37']) {
    await page.getByRole('textbox', { name: 'Zipper number' }).fill(number);
    await expect
      .poll(() =>
        page.evaluate(
          (n) => window.numberDraws.some((d) => d.number === n),
          number,
        ),
      )
      .toBe(true);
    const draw = await page.evaluate(
      (n) => window.numberDraws.findLast((d) => d.number === n)!,
      number,
    );
    expect(draw.descent3 - draw.descent2).toBeGreaterThan(20);
    expect(draw.font).toContain('Merriweather');
    const style = await proof.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        family: s.fontFamily,
        numeric: s.fontVariantNumeric,
        features: s.fontFeatureSettings,
        loaded: [...document.fonts].some(
          (f) =>
            f.family.replaceAll('"', '') === 'Merriweather' &&
            f.status === 'loaded',
        ),
      };
    });
    expect(style.loaded).toBe(true);
    expect(style.family).toBe('Merriweather, serif');
    expect(style.numeric).toContain('oldstyle-nums');
    expect(style.numeric).toContain('proportional-nums');
    expect(style.features).toContain('"onum"');
    expect(style.features).toContain('"pnum"');
    expect(
      await garageCanvas!.evaluate(
        (el) => el === document.querySelector('canvas'),
      ),
    ).toBe(true);
    await page.waitForTimeout(350);
    await page
      .getByTestId('garage-model')
      .screenshot({ path: `outputs/oldstyle-${number}-garage.png` });
    await proof.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(250);
    await proof.screenshot({ path: `outputs/oldstyle-${number}-proof.png` });
    writeFileSync(
      `outputs/oldstyle-${number}-texture.png`,
      Buffer.from(draw.image.split(',')[1], 'base64'),
    );
  }
  expect(errors).toEqual([]);
});
