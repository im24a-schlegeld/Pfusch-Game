import { expect, test, type Page } from '@playwright/test';
import type * as THREE from 'three';
import { newPlayer } from '../../app/domain/progression';
import { TUTORIAL_HINTS } from '../../app/domain/tutorial';

const destinations = ['GARAGE', 'AUFGABEN', 'BELOHNUNGEN', 'RANG'] as const;

declare global {
  interface Window {
    menuPreviewProbe: {
      frames: number;
      capture: boolean;
      canvas?: HTMLCanvasElement;
      paint?: {
        frame: number;
        width: number;
        height: number;
        cssWidth: number;
        cssHeight: number;
        pixelRatio: number;
        colors: number;
        meshes: number;
        riderMeshes: number;
        visibleVertices: number;
        projectedBounds: number[];
      };
    };
  }
}

async function prepareMenu(page: Page) {
  const player = newPlayer();
  player.settings.tutorialSeen = true;
  player.settings.tutorialHintsSeen = [...TUTORIAL_HINTS];
  player.settings.quality = 'low';
  player.settings.reducedMotion = true;
  player.highScore = 7723;
  player.runsPlayed = 1;
  player.leaderboardName = 'Fahrer mit langem Namen';
  player.history = [{ score: 7723, date: new Date().toISOString().slice(0, 10) }];
  await page.addInitScript(saved => {
    if (!localStorage.getItem('pfusch:player:v1')) localStorage.setItem('pfusch:player:v1', JSON.stringify(saved));
    window.menuPreviewProbe = { frames: 0, capture: false };
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', event => {
      const renderer = (event as CustomEvent).detail as THREE.WebGLRenderer & { isWebGLRenderer?: boolean };
      if (!renderer.isWebGLRenderer) return;
      const render = renderer.render.bind(renderer);
      renderer.render = (scene, camera) => {
        render(scene, camera);
        const canvas = renderer.domElement;
        if (!canvas.closest('.scene-garage')) return;
        const probe = window.menuPreviewProbe;
        probe.frames++;
        probe.canvas = canvas;
        if (!probe.capture) return;
        const gl = renderer.getContext();
        const pixelRatio = renderer.getPixelRatio();
        const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
        // A footer becoming ready can resize the stage after its first render.
        // Only inspect a real frame drawn at the stage's current dimensions.
        if (Math.abs(width - canvas.clientWidth * pixelRatio) > 1 ||
            Math.abs(height - canvas.clientHeight * pixelRatio) > 1) return;
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const colors = new Set<number>();
        for (let row = 0; row < 32; row++) for (let column = 0; column < 32; column++) {
          const offset = (Math.floor((row + .5) * height / 32) * width + Math.floor((column + .5) * width / 32)) * 4;
          colors.add((pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2]);
        }
        let meshes = 0, riderMeshes = 0, visibleVertices = 0;
        const projectedBounds = [Infinity, Infinity, -Infinity, -Infinity];
        scene.getObjectByName('player-bike')?.traverse(object => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh || mesh.userData.cartoonOutline) return;
          const position = mesh.geometry.getAttribute('position');
          if (!position?.count) return;
          meshes++;
          for (let ancestor: THREE.Object3D | null = mesh; ancestor; ancestor = ancestor.parent) {
            if (ancestor.userData.skeleton) { riderMeshes++; break; }
          }
          for (const index of [0, Math.floor(position.count / 2), position.count - 1]) {
            const point = mesh.getVertexPosition(index, camera.position.clone()).applyMatrix4(mesh.matrixWorld).project(camera);
            if (![point.x, point.y, point.z].every(Number.isFinite)) continue;
            projectedBounds[0] = Math.min(projectedBounds[0], point.x);
            projectedBounds[1] = Math.min(projectedBounds[1], point.y);
            projectedBounds[2] = Math.max(projectedBounds[2], point.x);
            projectedBounds[3] = Math.max(projectedBounds[3], point.y);
            if (Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && Math.abs(point.z) <= 1) visibleVertices++;
          }
        });
        probe.paint = { frame: probe.frames, width, height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight,
          pixelRatio, colors: colors.size, meshes, riderMeshes, visibleVertices, projectedBounds };
        probe.capture = false;
      };
    });
  }, player);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    // The production-check server intentionally answers Shopify endpoints with 401.
    if (message.type() === 'error' && /THREE\.|WebGL|shader|same key|unique.*key/i.test(message.text())) errors.push(message.text());
  });
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.getByTestId('garage-model')).toBeVisible();
  return errors;
}

async function expectMenuFits(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const main = document.querySelector('main');
    return document.documentElement.scrollWidth <= innerWidth + 1 && !!main && main.scrollWidth <= main.clientWidth + 1;
  })).toBe(true);
  const navigation = page.getByRole('navigation', { name: 'Spielnavigation', exact: true });
  const buttons = await navigation.getByRole('button').all();
  expect(buttons).toHaveLength(4);
  for (const button of buttons) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  }
}

async function expectGaragePreviewFits(page: Page) {
  const preview = page.getByRole('region', { name: 'Motorrad- und Fahrervorschau', exact: true });
  await expect(preview.locator('canvas')).toBeVisible();
  await expect(preview.locator('.gc-preview-footer')).toBeVisible();
  await expect.poll(() => preview.evaluate(node => {
    const container = node.getBoundingClientRect();
    const header = node.querySelector('.gc-preview-heading')!.getBoundingClientRect();
    const model = node.querySelector('.gc-model')!.getBoundingClientRect();
    const canvas = node.querySelector('canvas')!.getBoundingClientRect();
    const footer = node.querySelector('.gc-preview-footer')!.getBoundingClientRect();
    return model.height >= 90 && header.bottom <= model.top + 1 && model.bottom <= footer.top + 1 &&
      canvas.top >= model.top - 1 && canvas.bottom <= model.bottom + 1 &&
      footer.bottom <= container.bottom + 1 && footer.left >= container.left - 1 && footer.right <= container.right + 1;
  })).toBe(true);
  await expect(preview.getByRole('heading', { name: 'Töffli', exact: true })).toBeVisible();
  await expect(page.locator('.gc-bike[aria-pressed="true"]')).toContainText('Ausgerüstet');
  await expect(page.getByRole('button', { name: 'Fahrt starten', exact: true })).toBeEnabled();
  const firstFrame = await page.evaluate(() => {
    const probe = window.menuPreviewProbe;
    probe.capture = true;
    // Request an ordinary idle redraw, without calling renderer.render in the test.
    window.dispatchEvent(new Event('focus'));
    return probe.frames;
  });
  await expect.poll(() => page.evaluate(firstFrame => {
    const { paint, canvas, frames } = window.menuPreviewProbe;
    if (!paint || !canvas) return { painted: false, frames, paint };
    const painted = paint.frame > firstFrame && paint.width === canvas.width && paint.height === canvas.height &&
      paint.cssWidth === canvas.clientWidth && paint.cssHeight === canvas.clientHeight &&
      paint.meshes > 0 && paint.riderMeshes > 0 && paint.visibleVertices > 0 && paint.colors >= 8;
    return { painted, frames, paint };
  }, firstFrame), { message: 'The garage must paint the bike and rider at its current canvas size' }).toMatchObject({ painted: true });
  // Check the composited canvas too: layout and a populated scene alone cannot
  // catch an entirely blank grey preview in the screenshots we review.
  const screenshot = await preview.locator('canvas').screenshot();
  const colors = await page.evaluate(async base64 => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const sample = document.createElement('canvas');
    sample.width = image.width; sample.height = image.height;
    const context = sample.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    const colors = new Set<number>();
    for (let row = 0; row < 32; row++) for (let column = 0; column < 32; column++) {
      const offset = (Math.floor((row + .5) * image.height / 32) * image.width + Math.floor((column + .5) * image.width / 32)) * 4;
      colors.add((data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2]);
    }
    return colors.size;
  }, screenshot.toString('base64'));
  expect(colors, `Composited garage canvas; render probe: ${JSON.stringify(await page.evaluate(() => window.menuPreviewProbe.paint))}`)
    .toBeGreaterThanOrEqual(8);
}

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 1440, height: 900 }]) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(`menu ${size}`, () => {
    test.use({ viewport, isMobile: viewport.width < 760, hasTouch: viewport.width < 760 });
    test('navigation, preview and account-free ranking remain usable without clipped content', async ({ page }) => {
      const errors = await prepareMenu(page);
      if (viewport.width === 390) {
        // Exercise the layout's inset contract even on CI without a phone notch.
        await page.locator('.app-shell').evaluate(node => (node as HTMLElement).style.setProperty('--menu-safe-top', '44px'));
        const header = await page.locator('.topbar').boundingBox();
        expect(header!.height).toBe(104);
        for (const action of [page.locator('.topbar > .brand'), page.getByRole('button', { name: 'Einstellungen', exact: true })]) {
          const box = await action.boundingBox();
          expect(box!.y).toBeGreaterThanOrEqual(header!.y + 44);
          expect(box!.y + box!.height).toBeLessThanOrEqual(header!.y + header!.height + 1);
        }
        await page.locator('.app-shell').evaluate(node => (node as HTMLElement).style.removeProperty('--menu-safe-top'));
      }
      const navigation = page.getByRole('navigation', { name: 'Spielnavigation', exact: true });
      for (const destination of destinations) {
        const button = navigation.getByRole('button', { name: destination, exact: true });
        await button.click();
        await expect(button).toHaveAttribute('aria-current', 'page');
        await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
        await expectMenuFits(page);
        if (destination === 'GARAGE') await expectGaragePreviewFits(page);
        if (destination === 'AUFGABEN') {
          const task = page.getByTestId('daily-pfusch-task');
          await expect(page.locator('.challenge-grid > article').first()).toHaveAttribute('data-testid', 'daily-pfusch-task');
          await expect(task.getByRole('heading', { name: 'PFUSCH sammeln', exact: true })).toBeVisible();
          await expect(task.locator('.sign-progress, .signs-lockup').first()).toBeVisible();
        }
        if (destination === 'BELOHNUNGEN') {
          await expect(page.locator('.reward-grid > article').first().getByRole('heading')).toBeVisible();
          await expect(page.locator('.reward-grid > article').first().getByRole('button')).toBeVisible();
        }
        if (destination === 'RANG') {
          const table = page.getByRole('table', { name: 'Deine Bestleistungen', exact: true });
          await expect(table).toBeVisible();
          await expect(table.locator('.you')).toContainText('Fahrer mit langem Namen');
          await expect(page.getByRole('button', { name: 'TEILEN', exact: true })).toBeEnabled();
          expect(await page.evaluate(() => {
            const table = document.querySelector('.ranking-list')!;
            const editor = document.querySelector('.ranking-name-editor')!;
            const invite = document.querySelector('.game-invite-section')!;
            return !!(table.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING) &&
              !!(editor.compareDocumentPosition(invite) & Node.DOCUMENT_POSITION_FOLLOWING);
          })).toBe(true);
          await page.locator('.ranking-name-editor > summary').click();
          await page.getByRole('textbox', { name: 'Anzeigename', exact: true }).fill('Alex');
          await page.getByRole('button', { name: 'NAMEN SPEICHERN', exact: true }).click();
          await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pfusch:player:v1')!).leaderboardName as string)).toBe('Alex');
          await expect(table.locator('.you')).toContainText('Alex');
          await page.locator('.ranking-name-editor > summary').click();
          if (viewport.width === 390) {
            // A browser without native sharing or clipboard access still exposes
            // the real result link for copying, rather than leaving a dead action.
            await page.evaluate(() => {
              Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
              Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
            });
            await page.getByRole('button', { name: 'TEILEN', exact: true }).click();
            const link = page.getByRole('textbox', { name: 'Link zum Teilen', exact: true });
            await expect(link).toBeVisible();
            const url = new URL(await link.inputValue());
            expect(url.origin).toBe('https://game.pfusch-clothing.ch');
            expect(url.searchParams.get('share')).toBe('score');
            expect(url.searchParams.get('points')).toBe('7723');
            expect(url.searchParams.get('name')).toBe('Alex');
          }
          await page.locator('.ranking-page').evaluate(node => { node.scrollTop = 0; });
        }
        await page.screenshot({ path: `outputs/browser-pwa/menu-${destination.toLowerCase()}-${size}.png` });
      }
      await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
      await expect(page.getByRole('switch', { name: /Performance-Modus/ })).toBeVisible();
      if (viewport.width < 760) await expect(page.getByRole('radio', { name: 'Tasten', exact: true })).toBeChecked();
      await expectMenuFits(page);
      await page.screenshot({ path: `outputs/browser-pwa/menu-settings-${size}.png` });
      expect(errors).toEqual([]);
    });
  });
}

test('phone pause settings scroll by touch, change preferences and return without advancing the ride', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await prepareMenu(page);
  await page.getByRole('button', { name: 'Fahrt starten', exact: true }).click();
  const ride = page.getByTestId('ride-screen');
  await expect(ride).toHaveAttribute('data-phase', 'playing');
  await page.getByRole('button', { name: 'Fahrt pausieren', exact: true }).click();
  await expect(ride).toHaveAttribute('data-phase', 'paused');
  const distance = await ride.getAttribute('data-distance');
  const touch = await context.newCDPSession(page);
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'EINSTELLUNGEN', exact: true }).click();
    const settings = page.getByRole('dialog');
    await expect(settings.getByRole('heading', { name: /Einstellungen\./i })).toBeVisible();
    expect(await settings.locator('.standard-page').evaluate(node => getComputedStyle(node).overflowY)).toBe('visible');
    const box = await settings.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.height).toBeLessThanOrEqual(viewport.height);
    const x = box!.x + box!.width / 2, startY = box!.y + box!.height * .8;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY }] });
    for (let step = 1; step <= 8; step++) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: startY - step * box!.height * .055 }] });
      await page.waitForTimeout(25);
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => settings.evaluate(node => node.scrollTop)).toBeGreaterThan(20);
    await expect(ride).toHaveAttribute('data-distance', distance!);
    await settings.getByRole('radio', { name: 'Wischen', exact: true }).check();
    await settings.getByRole('switch', { name: /Reduzierte Bewegung/ }).setChecked(viewport.width !== 390);
    await expect(ride).toHaveAttribute('data-phase', 'paused');
    await expect(ride).toHaveAttribute('data-distance', distance!);
    await page.screenshot({ path: `outputs/browser-pwa/menu-pause-settings-${viewport.width}x${viewport.height}.png` });
    await settings.getByRole('button', { name: 'Zurück zur Pause', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'PAUSE.', exact: true })).toBeVisible();
    await expect(ride).toHaveAttribute('data-phase', 'paused');
    await expect(ride).toHaveAttribute('data-distance', distance!);
  }
  await touch.detach();
  expect(errors).toEqual([]);
});
