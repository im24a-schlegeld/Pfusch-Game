import { expect, test, type Page } from '@playwright/test';
import type * as THREE from 'three';
import { newPlayer } from '../../app/domain/progression';
import { getPantsColor, getShoesColor } from '../../app/domain/riderColors';

declare global {
  interface Window {
    wardrobeProbe: { scene?: THREE.Scene; camera?: THREE.Camera };
  }
}

async function savedWardrobe(page: Page) {
  return page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('pfusch:player:v1')!) as { pantsColor?: string; shoesColor?: string; coins: number };
    return { pantsColor: saved.pantsColor, shoesColor: saved.shoesColor, coins: saved.coins };
  });
}

async function renderedWardrobe(page: Page) {
  return page.evaluate(() => {
    const pants = new Set<string>(), shoes = new Set<string>();
    window.wardrobeProbe.scene?.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      const entries = (object as THREE.Mesh).material;
      for (const entry of Array.isArray(entries) ? entries : [entries]) {
        const material = entry as THREE.MeshStandardMaterial;
        if (material.userData.appearanceColorSlot === 'pantsColor') pants.add(material.color.getHexString());
        if (material.userData.appearanceColorSlot === 'shoesColor') shoes.add(material.color.getHexString());
      }
    });
    return { pants: [...pants], shoes: [...shoes] };
  });
}

async function selectPart(page: Page, name: 'Hose' | 'Schuhe') {
  await page.getByRole('navigation', { name: 'Ausrüstungsteil', exact: true })
    .getByRole('button', { name, exact: true }).click();
}

async function previewColor(page: Page, title: 'Hosenfarbe' | 'Schuhfarbe', name: string) {
  const radio = page.getByRole('radio', { name: `${title}: ${name} · Kostenlos`, exact: true });
  const value = await radio.inputValue();
  await radio.check();
  await expect(page.getByTestId('garage-model')).toHaveAttribute(title === 'Hosenfarbe' ? 'data-pants-color' : 'data-shoes-color', value);
  return value;
}

test('phone and short-phone wardrobe previews save only after Equip and persist after reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /THREE\.|WebGL|shader/i.test(message.text())) errors.push(message.text());
  });
  const player = newPlayer();
  player.settings.tutorialSeen = true;
  player.bike = '450';
  player.ownedItems.push('bike:450');
  player.pantsColor = getPantsColor(player);
  player.shoesColor = getShoesColor(player);
  await page.addInitScript((saved) => {
    // Preserve the result on reload: initialization must never mask a failed save.
    if (!localStorage.getItem('pfusch:player:v1')) localStorage.setItem('pfusch:player:v1', JSON.stringify(saved));
    window.wardrobeProbe = {};
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', (event) => {
      const renderer = (event as CustomEvent).detail as THREE.WebGLRenderer & { isWebGLRenderer?: boolean };
      if (!renderer.isWebGLRenderer) return;
      const render = renderer.render.bind(renderer);
      renderer.render = (scene, camera) => {
        render(scene, camera);
        if (scene.getObjectByName('player-bike') && !scene.getObjectByName('streamed-world')) {
          window.wardrobeProbe.scene = scene as THREE.Scene;
          window.wardrobeProbe.camera = camera;
        }
      };
    });
  }, player);
  await page.goto('/', { waitUntil: 'load' });
  const model = page.getByTestId('garage-model');
  await expect(model).toBeVisible();
  await page.getByRole('navigation', { name: 'Garage-Bereiche', exact: true })
    .getByRole('button', { name: 'Fahrer', exact: true }).click();
  const before = await savedWardrobe(page);
  await selectPart(page, 'Hose');
  await expect(page.getByRole('radio', { name: /^Hosenfarbe:/ })).toHaveCount(5);
  await expect(page.getByRole('radio', { name: /Hosenfarbe: (Violett|Rot|Oliv|Orange|Gelb|Sand|Weiss)/ })).toHaveCount(0);
  const blue = await previewColor(page, 'Hosenfarbe', 'Blau');
  expect(await savedWardrobe(page)).toEqual(before);
  await page.getByRole('button', { name: 'Verwerfen', exact: true }).click();
  await expect(model).toHaveAttribute('data-pants-color', before.pantsColor!);
  await previewColor(page, 'Hosenfarbe', 'Blau');
  await page.getByRole('button', { name: 'Ausrüsten', exact: true }).click();
  await expect.poll(() => savedWardrobe(page)).toEqual({ ...before, pantsColor: blue });
  await selectPart(page, 'Schuhe');
  await expect(page.getByRole('radio', { name: 'Schuhfarbe: Violett · Kostenlos', exact: true })).toBeVisible();
  const red = await previewColor(page, 'Schuhfarbe', 'Rot');
  expect(await savedWardrobe(page)).toEqual({ ...before, pantsColor: blue });
  await expect.poll(() => renderedWardrobe(page)).toEqual({ pants: [blue.slice(1)], shoes: [red.slice(1)] });
  await page.getByRole('button', { name: 'Ausrüsten', exact: true }).click();
  await expect.poll(() => savedWardrobe(page)).toEqual({ ...before, pantsColor: blue, shoesColor: red });
  await model.scrollIntoViewIfNeeded();
  await expect(model.locator('.scene')).toHaveAttribute('data-inspection-focus', 'feet');
  // Wait for the actual focus interpolation to finish before the detail image.
  let previousCamera = '';
  await expect.poll(async () => {
    const current = await page.evaluate(() => window.wardrobeProbe.camera?.position.toArray().map((value) => value.toFixed(4)).join(','));
    const stable = !!current && current === previousCamera;
    previousCamera = current ?? '';
    return stable;
  }, { intervals: [150, 200, 300] }).toBe(true);
  await page.screenshot({ path: 'outputs/browser-pwa/wardrobe-shoes-390x844.png' });
  await page.locator('.gc-preview').screenshot({ path: 'outputs/browser-pwa/shoe-closeup.png' });

  await page.setViewportSize({ width: 320, height: 568 });
  await page.reload({ waitUntil: 'load' });
  await expect(model).toHaveAttribute('data-pants-color', blue);
  await expect(model).toHaveAttribute('data-shoes-color', red);
  await page.getByRole('navigation', { name: 'Garage-Bereiche', exact: true })
    .getByRole('button', { name: 'Fahrer', exact: true }).click();
  await selectPart(page, 'Hose');
  await previewColor(page, 'Hosenfarbe', 'Dunkelblau');
  expect(await savedWardrobe(page)).toEqual({ ...before, pantsColor: blue, shoesColor: red });
  await selectPart(page, 'Schuhe');
  await expect(model).toHaveAttribute('data-pants-color', blue);
  const orange = await previewColor(page, 'Schuhfarbe', 'Orange');
  expect(await savedWardrobe(page)).toEqual({ ...before, pantsColor: blue, shoesColor: red });
  await page.getByRole('button', { name: 'Ausrüsten', exact: true }).click();
  await expect.poll(() => savedWardrobe(page)).toEqual({ ...before, pantsColor: blue, shoesColor: orange });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'outputs/browser-pwa/wardrobe-shoes-320x568.png' });
  await page.reload({ waitUntil: 'load' });
  await expect(model).toHaveAttribute('data-pants-color', blue);
  await expect(model).toHaveAttribute('data-shoes-color', orange);
  await expect.poll(() => renderedWardrobe(page)).toEqual({ pants: [blue.slice(1)], shoes: [orange.slice(1)] });
  expect(await savedWardrobe(page)).toEqual({ ...before, pantsColor: blue, shoesColor: orange });
  await expect(page.locator('.graphics-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});
