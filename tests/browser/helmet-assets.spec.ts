import { expect, test } from '@playwright/test';
import type { Mesh } from 'three';
import { newPlayer } from '../../app/domain/progression';
import { chooseArea, choosePaletteValue, choosePart, discardPreview, primaryAction } from './garage-helpers';

test('new helmet materials preview, purchase and persist on desktop and mobile', async ({ page }) => {
  test.setTimeout(240000);
  const initial = newPlayer();
  initial.bike = '450'; initial.coins = 10000; initial.xp = 8750; initial.level = 10;
  initial.ownedItems.push('bike:450');
  initial.settings.quality = 'low'; initial.settings.reducedMotion = true;
  initial.settings.tutorialSeen = true;
  initial.settings.tutorialHintsSeen = ['controls', 'ramp', 'police', 'radar', 'traffic', 'signs'];
  await page.addInitScript(player => {
    if (!localStorage.getItem('pfusch:player:v1')) localStorage.setItem('pfusch:player:v1', JSON.stringify(player));
    window.helmetScenes = [];
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', event => {
      const item = (event as CustomEvent).detail;
      if (item.isScene) window.helmetScenes.push(item);
    });
  }, initial);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => {
    if (message.type() === 'error' && /THREE|shader|WebGL/i.test(message.text())) errors.push(message.text());
  });
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('pfusch:player:v1')!));
  const model = page.getByTestId('garage-model');
  const rendered = async (style: 'fullface' | 'motocross') => {
    await expect.poll(() => page.evaluate(style => {
      const scene = window.helmetScenes.at(-1);
      const helmet = scene?.getObjectByName(style === 'fullface' ? 'full-face-helmet' : 'motocross-helmet') as Mesh | undefined;
      if (!helmet) return false;
      const parts = [helmet];
      if (style === 'motocross') parts.push(helmet.getObjectByName('motocross-peak') as Mesh);
      return parts.every(part => !!part && part.geometry.groups.length > 0 &&
        part.geometry.groups.every(group => Number.isFinite(group.count) && group.count > 0) &&
        part.geometry.groups.reduce((sum, group) => sum + group.count, 0) === part.geometry.index?.count);
    }, style), { timeout: 90000 }).toBe(true);
    await expect(page.getByText('Vorschau wird geladen', { exact: true })).toHaveCount(0);
  };
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(primaryAction(page)).toBeEnabled({ timeout: 90000 });
  await chooseArea(page, 'Fahrer'); await choosePart(page, 'Kopf');
  await choosePaletteValue(page, 'Helmfarbe', 'carbon-dark');
  await choosePaletteValue(page, 'Visier / Brillenglas', '#9b792f');
  await expect(model).toHaveAttribute('data-helmet-color', 'carbon-dark');
  await rendered('fullface');
  expect((await saved()).coins).toBe(10000);
  expect((await saved()).helmetColor).toBe(initial.helmetColor);
  await model.screenshot({ path: 'outputs/helmet-assets-fullface-carbon.png' });
  await primaryAction(page).click();
  await expect.poll(async () => (await saved()).coins).toBe(9000);
  expect((await saved()).ownedItems).toContain('helmetColor:carbon-dark');
  await page.getByRole('button', { name: 'Motocross', exact: true }).click();
  await choosePaletteValue(page, 'Helmfarbe', '#7461a5');
  await choosePaletteValue(page, 'Visier / Brillenglas', '#287a9d');
  await expect(model).toHaveAttribute('data-helmet', 'motocross');
  await rendered('motocross');
  await model.screenshot({ path: 'outputs/helmet-assets-cross-paint.png' });
  expect((await saved()).helmet).toBe('fullface');
  await discardPreview(page);
  await expect(model).toHaveAttribute('data-helmet', 'fullface');
  await page.getByRole('button', { name: 'Motocross', exact: true }).click();
  await primaryAction(page).click();
  await expect.poll(async () => (await saved()).helmet).toBe('motocross');
  expect((await saved()).coins).toBe(9000);
  await chooseArea(page, 'Motorrad'); await choosePart(page, 'Lack');
  await choosePaletteValue(page, 'Lackfarbe', 'carbon-dark');
  await primaryAction(page).click();
  await expect.poll(async () => (await saved()).coins).toBe(6000);
  await choosePart(page, 'Felgen');
  await choosePaletteValue(page, 'Felgenfarbe', 'carbon-dark');
  await primaryAction(page).click();
  await expect.poll(async () => (await saved()).coins).toBe(5500);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(primaryAction(page)).toBeEnabled({ timeout: 90000 });
  await expect(model).toHaveAttribute('data-helmet', 'motocross');
  await expect(model).toHaveAttribute('data-helmet-color', 'carbon-dark');
  await rendered('motocross');
  expect((await saved()).paint).toBe('carbon-dark');
  expect((await saved()).rims).toBe('carbon-dark');
  await page.screenshot({ path: 'outputs/helmet-assets-mobile.png' });
  await primaryAction(page).click();
  await expect(page.getByTestId('ride-screen')).toHaveAttribute('data-phase', 'playing', { timeout: 30000 });
  expect(errors).toEqual([]);
});
