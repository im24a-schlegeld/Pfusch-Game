import { test, expect } from '@playwright/test';
import type * as THREE from 'three';
import { newPlayer } from '../../app/domain/progression';
import { BIKES } from '../../app/domain/config';
import { chooseArea, chooseBike, choosePaletteValue, choosePart, discardPreview, primaryAction } from './garage-helpers';

declare global {
  interface Window {
    helmetScenes: THREE.Scene[];
  }
}

test('helmet styles and colors preview freely and only Equip persists them', async ({
  page,
}) => {
  // Every owned motorcycle, temporary helmet edits, persistence and a ride.
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const initial = newPlayer();
  initial.settings.tutorialSeen = true;
  initial.settings.tutorialHintsSeen = ['controls', 'ramp', 'police', 'radar', 'traffic', 'signs'];
  initial.xp = 8750; initial.level = 10;
  initial.ownedItems = [...new Set([...initial.ownedItems, ...BIKES.map(bike => `bike:${bike.id}`)])];
  await page.addInitScript((player) => {
    if (!localStorage.getItem('pfusch:player:v1'))
      localStorage.setItem('pfusch:player:v1', JSON.stringify(player));
  }, initial);
  await page.addInitScript(() => {
    window.helmetScenes = [];
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', (event) => {
      const item = (event as CustomEvent).detail;
      if (item.isScene) window.helmetScenes.push(item);
    });
  });
  await page.goto('/');
  await expect(primaryAction(page)).toBeEnabled({ timeout: 90000 });
  await chooseArea(page, 'Fahrer');
  await choosePart(page, 'Kopf');
  const model = page.getByTestId('garage-model');
  await expect(model).toHaveAttribute('data-helmet', 'fullface');
  const saved = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('pfusch:player:v1')!));
  const before = await saved();
  await page.getByRole('button', { name: 'Motocross', exact: true }).click();
  await choosePaletteValue(page, 'Helmfarbe', '#366bc0');
  await expect(model).toHaveAttribute('data-helmet', 'motocross');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const helmet = window.helmetScenes
          .map((s) => s.getObjectByName('motocross-helmet'))
          .filter(Boolean)
          .at(-1) as THREE.Mesh | undefined;
        return helmet
          ? {
              scale: helmet.scale.toArray(),
              color: (
                helmet.material as THREE.MeshStandardMaterial[]
              )[0].color.getHexString(),
              peak: !!helmet.getObjectByName('motocross-peak'),
              source: helmet.userData.geometryRevision,
            }
          : null;
      }),
    )
    .toEqual({
      scale: [1.065, 1.065, 1.065],
      color: '366bc0',
      peak: true,
      source: 'thor-source-shell-v1',
    });
  expect(await saved()).toEqual(before);
  await discardPreview(page);
  await expect(model).toHaveAttribute('data-helmet', 'fullface');
  for (const bike of ['Töffli', 'Roller', 'Supermoto', 'Sport']) {
    await chooseArea(page, 'Motorrad');
    await chooseBike(page, bike);
    if (await primaryAction(page).textContent() === 'Ausrüsten') await primaryAction(page).click();
    await expect(primaryAction(page)).toHaveText('Fahrt starten');
    await chooseArea(page, 'Fahrer');
    await choosePart(page, 'Kopf');
    await page
      .getByRole('button', { name: 'Motocross', exact: true })
      .click();
    await choosePaletteValue(page, 'Helmfarbe', '#d7dbd7');
    const bikeId = BIKES.find(item => item.name === bike)!.id;
    await expect(model).toHaveAttribute('data-bike', bikeId);
    await expect.poll(() => page.evaluate(() => {
      const root = window.helmetScenes.at(-1)?.getObjectByName('player-bike');
      return root?.getObjectByName('motocross-helmet')
        ? root.getObjectByName('imported-motorcycle')?.userData.importedBike ?? '125' : null;
    }), { timeout: 60000 }).toBe(bikeId);
    for (const angle of ['Seite', 'Vorne ¾', 'Hinten ¾']) {
      await page
        .getByRole('button', { name: angle, exact: true })
        .click();
      await page.waitForTimeout(300);
      await model.screenshot({
        path: `outputs/helmet-${bike}-${angle.replace(' ¾', '-quarter')}.png`,
      });
    }
  }
  await chooseArea(page, 'Motorrad');
  await chooseBike(page, 'Töffli');
  await primaryAction(page).click();
  await expect(primaryAction(page)).toHaveText('Fahrt starten');
  await chooseArea(page, 'Fahrer');
  await choosePart(page, 'Kopf');
  await page.getByRole('button', { name: 'Motocross', exact: true }).click();
  await choosePaletteValue(page, 'Helmfarbe', '#7461a5');
  await primaryAction(page).click();
  const equipped = await saved();
  expect(equipped).toEqual({
    ...before,
    helmet: 'motocross',
    helmetColor: '#7461a5',
  });
  await expect(model).toHaveAttribute('data-bike', '125');
  await page.reload();
  await expect(primaryAction(page)).toBeEnabled({ timeout: 90000 });
  await expect(model).toHaveAttribute('data-helmet', 'motocross');
  await expect(model).toHaveAttribute('data-helmet-color', '#7461a5');
  await page.setViewportSize({ width: 390, height: 844 });
  await chooseArea(page, 'Fahrer');
  await choosePart(page, 'Kopf');
  await page.getByRole('button', { name: 'Integralhelm', exact: true }).click();
  await choosePaletteValue(page, 'Helmfarbe', '#dc632e');
  await expect(model).toHaveAttribute('data-helmet-color', '#dc632e');
  await page.waitForTimeout(300);
  await model.screenshot({ path: 'outputs/helmet-mobile-fullface.png' });
  expect(await saved()).toEqual(equipped);
  await discardPreview(page);
  await expect(model).toHaveAttribute('data-helmet', 'motocross');
  await expect(model).toHaveAttribute('data-helmet-color', '#7461a5');
  await primaryAction(page).click();
  await expect(page.getByTestId('ride-screen')).toHaveAttribute(
    'data-phase',
    'playing',
    { timeout: 20000 },
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        !!window.helmetScenes.at(-1)?.getObjectByName('motocross-helmet'),
      ),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});
