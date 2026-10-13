import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const artwork = JSON.parse(readFileSync(new URL('../../app/ui/loadingArtwork.json', import.meta.url), 'utf8')) as {
  desktop: string;
  portrait: string;
};

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test.describe(`current loading art ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, isMobile: viewport.width < 760, hasTouch: viewport.width < 760 });
    test('shows the matching current crop with the brand and caption inside the screen', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      // Hold the real pre-React shell. A blank module keeps the recovery/boot
      // surface available without loading another WebGL scene for this test.
      await page.route(/\/assets\/[^?]+\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
      await page.goto('/', { waitUntil: 'load' });
      const boot = page.locator('#boot-fallback');
      const image = boot.locator('.boot-art');
      await expect(boot).toBeVisible();
      await image.evaluate(async element => { await (element as HTMLImageElement).decode(); });
      const current = await image.evaluate(element => new URL((element as HTMLImageElement).currentSrc).pathname);
      expect(current).toBe(viewport.width / viewport.height <= 0.75 ? artwork.portrait : artwork.desktop);
      await boot.locator('.boot-brand img').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
      for (const selector of ['.boot-brand', '.boot-caption', 'button']) {
        const element = boot.locator(selector), bounds = (await element.boundingBox())!;
        await expect(element).toBeVisible();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await page.screenshot({ path: `outputs/browser-pwa/loading-boot-${viewport.width}x${viewport.height}.png` });
    });
  });
}
