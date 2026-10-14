import { expect, test } from '@playwright/test';

test('installed app shell and playable ride survive a genuinely offline reload', async ({ page, context }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  });
  await page.goto('/', { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await expect(page.getByTestId('offline-ready')).toHaveAttribute('data-state', 'ready', { timeout: 120000 });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const manifest = await page.evaluate(async () => {
    const href = (document.querySelector('link[rel="manifest"]') as HTMLLinkElement).href;
    const response = await fetch(href);
    if (!response.ok) throw new Error(`Install manifest is unavailable: ${response.status}`);
    const data = await response.json() as { icons: { src: string; sizes: string }[] };
    return { icons: data.icons, dimensions: await Promise.all(data.icons.map(async (icon) => {
      const image = new Image(); image.src = new URL(icon.src, href).href;
      await image.decode();
      return `${image.naturalWidth}x${image.naturalHeight}`;
    })) };
  });
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(['192x192', '512x512']);
  expect(manifest.dimensions).toEqual(['192x192', '512x512']);
  const chrome = await context.newCDPSession(page);
  const parsed = await chrome.send('Page.getAppManifest');
  expect(parsed.errors).toEqual([]);
  expect(new URL(parsed.url).pathname).toBe('/manifest.json');
  await chrome.detach();
  await page.evaluate(async () => {
    await fetch('/api/player'); await fetch('/api/referral'); await fetch('/auth/login');
  });
  const cachedUrls = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith('pfusch-offline-'));
    const urls = [];
    for (const name of names) for (const request of await (await caches.open(name)).keys()) urls.push(new URL(request.url).pathname);
    return urls;
  });
  expect(cachedUrls).toContain('/offline.html');
  expect(cachedUrls).toContain('/models/ciao/model.bin');
  expect(cachedUrls.some((url) => url.startsWith('/api/') || url.startsWith('/auth/'))).toBe(false);

  await page.getByRole('navigation', { name: 'Spielnavigation' }).getByRole('button', { name: 'RANG', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Freunde einladen.', exact: true })).toBeVisible();
  await page.locator('.game-share-section').scrollIntoViewIfNeeded();
  const invite = page.locator('.game-invite-section').getByRole('link', { name: 'Über WhatsApp teilen', exact: true });
  await expect(invite).toBeEnabled();
  await expect(invite).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=/);
  await expect(invite).toHaveAttribute('target', '_blank');
  const draft = new URL((await invite.getAttribute('href'))!);
  expect([...draft.searchParams.keys()]).toEqual(['text']);
  const [message, gameUrl] = draft.searchParams.get('text')!.split('\n');
  expect(message).toContain('PFUSCH Wheelie Escape');
  const destination = new URL(gameUrl);
  expect(destination.origin).toBe('https://game.pfusch-clothing.ch');
  expect(destination.searchParams.get('share')).toBe('invite');
  expect(destination.searchParams.has('points')).toBe(false);
  expect(destination.searchParams.has('ref')).toBe(false);
  await expect(page.getByRole('button', { name: 'FREUND EINLADEN', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Link zum Teilen', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'outputs/browser-pwa/sharing-390x844.png' });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.locator('.game-share-section').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'outputs/browser-pwa/sharing-320x568.png' });
  await page.setViewportSize({ width: 390, height: 844 });

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: /^Fahrt starten/i }).first()).toBeVisible();
  await page.getByRole('button', { name: /^Fahrt starten/i }).first().click();
  const ride = page.getByTestId('ride-screen');
  await expect(ride).toBeVisible();
  await expect(ride.locator('canvas').first()).toBeVisible();
  await page.getByRole('button', { name: 'Hinweise überspringen', exact: true }).click();
  await expect(ride).toHaveAttribute('data-phase', 'playing');
  await page.keyboard.press('ArrowLeft');
  await expect(ride).toHaveAttribute('data-lane', '-1');
  await expect.poll(async () => Number(await ride.getAttribute('data-distance')), { timeout: 45000 }).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Fahrt pausieren', exact: true })).toBeVisible();
  await page.screenshot({ path: 'outputs/browser-pwa/offline-390x844.png' });
});
