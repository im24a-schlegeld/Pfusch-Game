import { test, expect } from '@playwright/test';
import type * as THREE from 'three';
import { newPlayer } from '../../app/domain/progression';

declare global {
  interface Window {
    helmetScenes: THREE.Scene[];
  }
}

test('helmet styles and colors preview freely and only Equip persists them', async ({
  page,
}) => {
  // Four complete vehicle rebuilds, preview/discard, persistence and a ride.
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((player) => {
    if (!localStorage.getItem('pfusch:player:v1'))
      localStorage.setItem('pfusch:player:v1', JSON.stringify(player));
  }, newPlayer());
  await page.addInitScript(() => {
    window.helmetScenes = [];
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', (event) => {
      const item = (event as CustomEvent).detail;
      if (item.isScene) window.helmetScenes.push(item);
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'OPEN GARAGE' }).click();
  const model = page.getByTestId('garage-model');
  await expect(model).toHaveAttribute('data-helmet', 'fullface');
  const saved = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('pfusch:player:v1')!));
  const before = await saved();
  await page.getByRole('button', { name: 'Preview Motocross helmet' }).click();
  await page.getByRole('button', { name: 'Cobalt helmet color' }).click();
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
              rearRidge: !!helmet.getObjectByName('motocross-rear-ridge'),
            }
          : null;
      }),
    )
    .toEqual({
      scale: [1.065, 1.065, 1.065],
      color: '366bc0',
      peak: true,
      rearRidge: true,
    });
  expect(await saved()).toEqual(before);
  await page
    .getByRole('region', { name: 'Helmet options' })
    .getByRole('button', { name: 'DISCARD PREVIEW', exact: true })
    .click();
  await expect(model).toHaveAttribute('data-helmet', 'fullface');
  for (const bike of ['Töffli', 'Roller', 'Supermoto', 'Sport']) {
    await page.getByRole('tab', { name: 'BIKE', exact: true }).click();
    await page
      .getByRole('button', { name: `Preview ${bike}`, exact: true })
      .click();
    await page.getByRole('tab', { name: 'RIDER', exact: true }).click();
    await page
      .getByRole('button', { name: 'Preview Motocross helmet' })
      .click();
    await page.getByRole('button', { name: 'Chalk helmet color' }).click();
    for (const angle of ['SIDE', 'FRONT', 'REAR ¾']) {
      await page
        .getByRole('button', { name: `Inspect ${angle}`, exact: true })
        .click();
      await page.waitForTimeout(160);
      await model.screenshot({
        path: `outputs/helmet-${bike}-${angle.replace(' ¾', '-quarter')}.png`,
      });
    }
  }
  await page.getByRole('button', { name: 'Signal helmet color' }).click();
  await page.getByRole('button', { name: 'EQUIP HELMET', exact: true }).click();
  const equipped = await saved();
  expect(equipped).toEqual({
    ...before,
    helmet: 'motocross',
    helmetColor: '#b8ce47',
  });
  await expect(model).toHaveAttribute('data-bike', '125');
  await page.reload();
  await page.getByRole('button', { name: 'OPEN GARAGE' }).click();
  await expect(model).toHaveAttribute('data-helmet', 'motocross');
  await expect(model).toHaveAttribute('data-helmet-color', '#b8ce47');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Preview Full-face helmet' }).click();
  await page.getByRole('button', { name: 'Burnt orange helmet color' }).click();
  await expect(model).toHaveAttribute('data-helmet-color', '#dc632e');
  await page.waitForTimeout(160);
  await model.screenshot({ path: 'outputs/helmet-mobile-fullface.png' });
  expect(await saved()).toEqual(equipped);
  await page
    .getByRole('button', { name: 'RIDE EQUIPPED SETUP', exact: true })
    .click();
  const tutorial = page.getByRole('button', { name: 'GOT IT. LET’S RIDE' });
  if (await tutorial.isVisible()) await tutorial.click();
  await expect(page.getByTestId('ride-screen')).toHaveAttribute(
    'data-phase',
    'playing',
    { timeout: 20000 },
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.helmetScenes.some(
          (s) => !!s.getObjectByName('motocross-helmet'),
        ),
      ),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});
