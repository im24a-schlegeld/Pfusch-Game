import { test, expect, type Page } from '@playwright/test';
import type * as THREE from 'three';
import { digitalPrice, newPlayer } from '../../app/domain/progression';
import type { Player, Product } from '../../app/domain/types';
import { chooseArea, choosePart, primaryAction } from './garage-helpers';

test.use({ hasTouch: true });

declare global {
  interface Window { stickerScenes: THREE.Scene[] }
}
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pfusch:player:v1')!) as Player);
const footerAction = (page: Page) => page.locator('.sticker-footer').getByRole('button');
const placedButtons = (page: Page) => page.locator('.sticker-items').getByRole('button', { name: /^STICKER \d+$/ });

async function checkWorkshopScroll(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  const workshop = page.getByRole('main', { name: 'Sticker-Werkstatt' });
  const size = page.getByRole('slider', { name: 'Stickergröße', exact: true });
  const rotation = page.getByRole('slider', { name: 'Stickerdrehung', exact: true });
  const beforeSize = await size.inputValue(), beforeRotation = await rotation.inputValue();
  // The garage wrapper clips overflow; the workshop must own its scrolling.
  await expect(workshop).toHaveCSS('position', 'fixed');
  await expect(workshop).toHaveCSS('overflow-y', 'auto');
  await expect(workshop).toHaveCSS('touch-action', 'pan-y');
  await expect(page.locator('.sticker-footer')).toHaveCSS('position', 'static');
  const metrics = await workshop.evaluate(element => ({
    client: element.clientHeight, content: element.scrollHeight,
    top: element.getBoundingClientRect().top,
  }));
  expect(metrics.client).toBeGreaterThan(200);
  expect(metrics.client + metrics.top).toBeLessThanOrEqual(viewport.height);
  expect(metrics.content).toBeGreaterThan(metrics.client + 20);
  await workshop.evaluate(element => { element.scrollTop = 0; });
  const box = (await workshop.boundingBox())!;
  // Start on a known noninteractive heading. A viewport-relative point at the
  // left edge can be touch-adjusted onto the size slider and set it to 4 cm.
  const panOrigin = workshop.getByRole('heading', { name: 'STICKER ANPASSEN', exact: true });
  await panOrigin.scrollIntoViewIfNeeded();
  const panBox = (await panOrigin.boundingBox())!;
  const x = panBox.x + panBox.width / 2, y = panBox.y + panBox.height / 2;
  expect(await panOrigin.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)), { x, y })).toBe(true);
  const beforePan = await workshop.evaluate(element => element.scrollTop);
  // Real touch panning must work outside the canvas whose gestures rotate/zoom.
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 8; step++) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 24 }] });
    await page.waitForTimeout(35);
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => workshop.evaluate(element => element.scrollTop)).toBeGreaterThan(beforePan + 20);
  await touch.detach();
  await expect(size).toHaveValue(beforeSize);
  await expect(rotation).toHaveValue(beforeRotation);
  // Wheel input also scrolls the workshop instead of its clipped parent.
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.wheel(0, 1600);
  await expect.poll(() => workshop.evaluate(element => element.scrollTop)).toBeGreaterThan(20);
  const tools = workshop.locator('.sticker-settings').locator('input, button');
  for (const control of await tools.all()) {
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeInViewport({ ratio: 1 });
    const bounds = (await control.boundingBox())!;
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThanOrEqual(38);
    const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    expect(await control.evaluate((element, p) => element.contains(document.elementFromPoint(p.x, p.y)), point)).toBe(true);
  }
  for (const name of [/Sticker 5 Grad/, /Stickergröße (6|12) Zentimeter/, /Stickergröße zurücksetzen/, /Ausgewählten Sticker duplizieren/]) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: /Sticker auf .* zentrieren/, exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Stickerposition auf andere Seite spiegeln', exact: true })).toHaveCount(1);
  const original = page.locator('.sticker-original');
  await original.scrollIntoViewIfNeeded();
  await expect(original).toBeInViewport();
  await expect(original.locator('img')).toBeVisible();
  await footerAction(page).scrollIntoViewIfNeeded();
  await expect(footerAction(page)).toBeInViewport();
  const actionBox = (await footerAction(page).boundingBox())!;
  expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(viewport.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: test.info().outputPath(`sticker-tools-${viewport.width}x${viewport.height}.png`) });
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.wheel(0, -1600);
  await expect.poll(() => workshop.evaluate(element => element.scrollTop)).toBe(0);
  await expect(size).toHaveValue(beforeSize);
  await expect(rotation).toHaveValue(beforeRotation);
}

async function openSticker(page: Page, target: 'Helm' | 'Motorrad', product: Product) {
  await expect(primaryAction(page)).toBeEnabled({ timeout: 90000 });
  await chooseArea(page, 'Motorrad');
  await choosePart(page, 'Extras');
  await page.getByTestId('product-card').filter({ has: page.getByText(product.title, { exact: true }) }).click();
  await page.locator('.gc-toggle[aria-label="Sticker-Ziel"]').getByRole('button', { name: target, exact: true }).click();
  await expect(primaryAction(page)).toHaveText('Platzieren');
  await primaryAction(page).click();
  await expect(page.locator('.sticker-views').getByRole('button', { name: 'RECHTS', exact: true })).toBeEnabled({ timeout: 90000 });
  await expect(page.getByTestId('sticker-stage').locator('canvas')).toBeVisible();
}

/** Use real pointer hit-testing. A small bounded grid handles the two very different target shapes. */
async function placeOnSurface(page: Page) {
  const stage = page.getByTestId('sticker-stage');
  const before = await placedButtons(page).count();
  for (const view of ['RECHTS', 'LINKS', 'HINTEN']) {
    await page.locator('.sticker-views').getByRole('button', { name: view, exact: true }).click();
    await stage.scrollIntoViewIfNeeded();
    const box = await stage.boundingBox();
    if (!box) throw new Error('Sticker stage has no rendered size');
    for (const [x, y] of [[.5, .42], [.5, .35], [.45, .4], [.55, .4], [.5, .5], [.5, .6], [.4, .5], [.6, .5], [.35, .55], [.65, .55], [.4, .65], [.6, .65], [.5, .7]]) {
      await stage.click({ position: { x: Math.round(box.width * x), y: Math.round(box.height * y) } });
      if (await placedButtons(page).count() > before) return;
    }
  }
  throw new Error(`No valid visible sticker surface found: ${await page.locator('.sticker-hint').textContent()}`);
}

test('mobile sticker placement previews freely, charges each new placement on save, persists and removes freely', async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 390, height: 844 });
  const catalog = await (await page.request.get('/catalog/products.json')).json() as Product[];
  const product = catalog.find(item => item.handle === 'chrome-sticker')!;
  const initial = newPlayer(); initial.settings.tutorialSeen = true; initial.settings.tutorialHintsSeen = ['controls', 'ramp', 'police', 'radar', 'traffic', 'signs'];
  initial.settings.quality = 'low'; initial.settings.reducedMotion = true;
  await page.addInitScript(player => {
    if (!localStorage.getItem('pfusch:player:v1')) localStorage.setItem('pfusch:player:v1', JSON.stringify(player));
    window.stickerScenes = [];
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', event => {
      const item = (event as CustomEvent).detail;
      if (item.isScene) window.stickerScenes.push(item);
    });
  }, initial);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openSticker(page, 'Helm', product);
  await expect(page.getByRole('slider', { name: 'Stickergröße', exact: true })).toHaveValue('0.09');
  await checkWorkshopScroll(page, { width: 390, height: 844 });
  await checkWorkshopScroll(page, { width: 320, height: 568 });
  await page.setViewportSize({ width: 390, height: 844 });
  const before = await saved(page);
  await expect(footerAction(page)).toHaveText('Sticker platzieren');
  await expect(footerAction(page)).toBeDisabled();
  // The controls are intentionally open in the restored workshop.
  await expect(page.locator('.sticker-settings')).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Stickergröße' })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Stickerdrehung' })).toBeVisible();
  const size = page.locator('input[aria-label="Stickergröße"]');
  await expect(size).toHaveValue('0.09');
  await expect(page.locator('.sticker-targets').getByRole('button', { name: 'HELM', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await placeOnSurface(page);
  await expect(placedButtons(page)).toHaveCount(1);
  await expect(footerAction(page)).toHaveText(`Für ${digitalPrice(product)} Coins kaufen & speichern`);
  expect(await saved(page)).toEqual(before);
  await expect(page.getByRole('button', { name: 'Sticker größer machen' })).toBeVisible();
  await size.press('ArrowRight');
  await size.press('ArrowRight');
  await size.press('ArrowRight');
  await expect(size).toHaveValue('0.12');
  await page.getByRole('button', { name: '+ WEITERER STICKER', exact: true }).click();
  await expect(size).toHaveValue('0.09');
  await placedButtons(page).first().click();
  await expect(size).toHaveValue('0.12');
  await page.getByRole('button', { name: '+ WEITERER STICKER', exact: true }).click();
  await placeOnSurface(page);
  await expect(placedButtons(page)).toHaveCount(2);
  await expect(footerAction(page)).toHaveText(`Für ${digitalPrice(product) * 2} Coins kaufen & speichern`);
  expect(await saved(page)).toEqual(before);

  await page.locator('.sticker-targets').getByRole('button', { name: 'MOTORRAD', exact: true }).click();
  await expect(size).toHaveValue('0.09');
  await expect(placedButtons(page)).toHaveCount(0);
  await placeOnSurface(page);
  await expect(placedButtons(page)).toHaveCount(1);
  await expect(footerAction(page)).toHaveText(`Für ${digitalPrice(product) * 3} Coins kaufen & speichern`);
  await page.locator('.sticker-targets').getByRole('button', { name: 'HELM', exact: true }).click();
  await expect(placedButtons(page)).toHaveCount(2);
  await page.locator('.sticker-targets').getByRole('button', { name: 'MOTORRAD', exact: true }).click();
  await expect(placedButtons(page)).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => {
    let decals = 0;
    window.stickerScenes.at(-1)?.traverse(object => { if (object.userData.bikeSticker) decals += 1; });
    return decals;
  })).toBeGreaterThanOrEqual(2);
  expect(await saved(page)).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await footerAction(page).scrollIntoViewIfNeeded();
  const actionBox = (await footerAction(page).boundingBox())!;
  expect(actionBox.height).toBeGreaterThanOrEqual(44);
  expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: test.info().outputPath('sticker-workshop-mobile.png') });
  // Two immediate events must still produce only one complete local transaction.
  await footerAction(page).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(page.locator('.sticker-workshop')).toHaveCount(0);
  const confirmed = await saved(page);
  expect(confirmed.coins).toBe(before.coins - digitalPrice(product) * 3);
  expect(confirmed.ownedItems.filter(id => id === product.id)).toHaveLength(1);
  expect(confirmed.stickers['125']).toHaveLength(1);
  expect(confirmed.stickers['helmet:fullface']).toHaveLength(2);
  const [original, second] = confirmed.stickers['helmet:fullface'];
  expect(second.id).not.toBe(original.id);
  expect(second.size).toBe(0.09);
  expect(confirmed.stickers['125'][0].size).toBe(0.09);
  expect(confirmed.stickers['helmet:fullface'][0].size).toBe(0.12);
  expect(confirmed.helmetColor).toBe(before.helmetColor);
  expect(confirmed.helmetVisor).toBe(before.helmetVisor);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await openSticker(page, 'Helm', product);
  expect((await saved(page)).stickers).toEqual(confirmed.stickers);
  await expect(placedButtons(page)).toHaveCount(2);
  await placedButtons(page).first().click();
  await expect(size).toHaveValue('0.12');
  // Editing paid copies, including their geometry, never buys them again.
  await size.press('ArrowRight');
  await page.getByRole('slider', { name: 'Stickerdrehung', exact: true }).press('ArrowRight');
  const editedRotation = Number(await page.getByRole('slider', { name: 'Stickerdrehung', exact: true }).inputValue());
  await expect(footerAction(page)).toHaveText('Speichern');
  await footerAction(page).click();
  const edited = await saved(page);
  expect(edited.coins).toBe(confirmed.coins);
  expect(edited.stickers['helmet:fullface'][0]).toMatchObject({ id: original.id, productId: original.productId, size: 0.13, rotation: editedRotation });
  await openSticker(page, 'Helm', product);
  await placedButtons(page).first().click();
  await expect(size).toHaveValue('0.13');
  await page.getByRole('button', { name: 'Ausgewählten Sticker entfernen', exact: true }).click();
  await expect(placedButtons(page)).toHaveCount(1);
  await placedButtons(page).first().click();
  await page.getByRole('button', { name: 'Ausgewählten Sticker entfernen', exact: true }).click();
  await expect(placedButtons(page)).toHaveCount(0);
  await expect(size).toHaveValue('0.09');
  await expect(footerAction(page)).toHaveText('Speichern');
  await footerAction(page).click();
  const removed = await saved(page);
  expect(removed.coins).toBe(confirmed.coins);
  expect(removed.stickers['helmet:fullface']).toEqual([]);
  expect(removed.stickers['125']).toEqual(confirmed.stickers['125']);
  expect(errors).toEqual([]);
});

for (const model of ['450', '701']) {
  test(`centering front, top and side stickers uses the entire ${model} motorcycle and saves existing edits freely`, async ({ page }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 390, height: 844 });
    const products = await (await page.request.get('/catalog/products.json')).json() as Product[];
    const product = products.find(item => item.handle === 'chrome-sticker')!;
    const initial = newPlayer(); initial.bike = model; initial.coins = 0;
    initial.settings.quality = 'low'; initial.settings.reducedMotion = true;
    initial.ownedItems.push(`bike:${model}`, product.id); initial.settings.tutorialSeen = true;
    await page.addInitScript(player => {
      if (!localStorage.getItem('pfusch:player:v1')) localStorage.setItem('pfusch:player:v1', JSON.stringify(player));
      window.stickerScenes = [];
      window.__THREE_DEVTOOLS__ = new EventTarget();
      window.__THREE_DEVTOOLS__.addEventListener('observe', event => {
        const item = (event as CustomEvent).detail;
        if (item.isScene) window.stickerScenes.push(item);
      });
    }, initial);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await openSticker(page, 'Motorrad', product);
    // Seed three already paid copies on real triangles with different facing
    // directions. Read the shipped scene, so no hand-written mesh coordinates
    // or dev-only imports can make this pass against the wrong bike geometry.
    const source = await page.evaluate(({ model, productId }) => {
      const body = window.stickerScenes.at(-1)!.getObjectByName('imported-motorcycle')!;
      body.updateWorldMatrix(true, true);
      const inverse = body.matrixWorld.clone().invert();
      const transforms: Record<string, number[]> = {};
      const meshes: Array<{ path: string; mesh: THREE.Mesh }> = [];
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      function visit(object: THREE.Object3D, path: string) {
        if (!object.visible || object.userData.bikeSticker) return;
        if (object instanceof Object && (object as THREE.Mesh).isMesh) {
          const mesh = object as THREE.Mesh;
          transforms[path] = inverse.clone().multiply(mesh.matrixWorld).toArray();
          mesh.geometry.computeBoundingBox();
          const box = mesh.geometry.boundingBox!;
          for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
            const point = body.worldToLocal(mesh.localToWorld(mesh.position.clone().set(x, y, z)));
            [point.x, point.y, point.z].forEach((value, axis) => { min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value); });
          }
          if (mesh.userData.bikePaintSurface) meshes.push({ path, mesh });
        }
        object.children.forEach((child, index) => visit(child, `${path}/${child.name || 'mesh'}:${index}`));
      }
      visit(body, 'body');
      const center = min.map((value, axis) => (value + max[axis]) / 2);
      const placements = ['front', 'top', 'side'].map((name, order) => {
        let best = -Infinity, result: Player['stickers'][string][number] | undefined;
        for (const { path, mesh } of meshes) {
          const positions = mesh.geometry.getAttribute('position'), indices = mesh.geometry.getIndex()!;
          for (let i = 0; i < indices.count; i += 3) {
            const a = mesh.position.clone().fromBufferAttribute(positions, indices.getX(i));
            const b = a.clone().fromBufferAttribute(positions, indices.getX(i + 1));
            const c = a.clone().fromBufferAttribute(positions, indices.getX(i + 2));
            const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
            const point = a.clone().add(b).add(c).multiplyScalar(1 / 3);
            const bodyPoint = body.worldToLocal(mesh.localToWorld(point.clone()));
            if (bodyPoint.x < 0.02 || (name === 'front' ? normal.z > -0.7 : name === 'top' ? normal.y < 0.7 : normal.x < 0.9)) continue;
            const score = Math.abs(bodyPoint.z - center[2]);
            if (score <= best) continue;
            best = score;
            result = { id: `paid-${name}`, productId, surface: path, point: point.toArray(), normal: normal.toArray(), size: 0.09 + order * 0.02, rotation: [0.42, -0.35, 0.8][order] };
          }
        }
        if (!result) throw new Error(`Missing ${name} painted triangle on ${model}`);
        return result;
      });
      const player = JSON.parse(localStorage.getItem('pfusch:player:v1')!) as Player;
      player.stickers[model] = placements;
      localStorage.setItem('pfusch:player:v1', JSON.stringify(player));
      return { placements, center, transforms };
    }, { model, productId: product.id });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openSticker(page, 'Motorrad', product);
    await expect(placedButtons(page)).toHaveCount(3);
    for (let index = 0; index < 3; index++) {
      await placedButtons(page).nth(index).click();
      await page.getByRole('button', { name: 'Sticker auf gesamtem Motorrad zentrieren', exact: true }).click();
      await expect(page.locator('.sticker-hint')).toContainText('am gesamten Motorrad zentriert');
      await expect(footerAction(page)).toHaveText('Speichern');
    }
    await page.getByRole('button', { name: 'Stickerposition auf andere Seite spiegeln', exact: true }).click();
    await expect(page.locator('.sticker-hint')).toContainText('Das Motiv bleibt unverändert');
    await expect(footerAction(page)).toHaveText('Speichern');
    await expect.poll(() => page.evaluate(() => {
      let decals = 0;
      window.stickerScenes.at(-1)?.traverse(object => {
        if (object.userData.bikeSticker && (object as THREE.Mesh).geometry.getIndex()!.count > 0) decals++;
      });
      return decals;
    })).toBeGreaterThanOrEqual(3);
    await page.screenshot({ path: test.info().outputPath(`sticker-centered-${model}-390x844.png`) });
    await footerAction(page).click();
    const confirmed = await saved(page);
    expect(confirmed.coins).toBe(0);
    for (const [index, placement] of confirmed.stickers[model].entries()) {
      const before = source.placements[index];
      expect(placement).toMatchObject({ id: before.id, productId: before.productId, size: before.size, rotation: before.rotation });
      const transform = source.transforms[placement.surface], [x, y, z] = placement.point;
      const actualX = transform[0] * x + transform[4] * y + transform[8] * z + transform[12];
      const actualZ = transform[2] * x + transform[6] * y + transform[10] * z + transform[14];
      expect(Math.abs(actualZ - source.center[2])).toBeLessThan(0.25);
      if (index === 2) expect(actualX).toBeLessThanOrEqual(0.001);
      else expect(actualX).toBeGreaterThanOrEqual(-0.001);
      expect({ surface: placement.surface, point: placement.point }).not.toEqual({ surface: before.surface, point: before.point });
    }
  });
}
