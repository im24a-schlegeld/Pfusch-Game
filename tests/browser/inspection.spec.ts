import { test, expect } from '@playwright/test';
import type * as THREE from 'three';
declare global {
  interface Window {
    garageScenes: THREE.Scene[];
  }
}

test('all bike inspection views render, and repeating a preset restores it after dragging', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.garageScenes = [];
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', (event) => {
      const item = (event as CustomEvent).detail;
      if (item.isScene) window.garageScenes.push(item);
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'OPEN GARAGE' }).click();
  await page.getByRole('tab', { name: 'BIKE', exact: true }).click();
  for (const [name, id] of [
    ['Töffli', '125'],
    ['Supermoto', '450'],
    ['Sport', '701'],
  ]) {
    await page
      .getByRole('button', { name: `Preview ${name}`, exact: true })
      .click();
    if (id === '450')
      await page
        .getByRole('button', { name: 'Burnt orange paint', exact: true })
        .click();
    if (id === '701')
      await page
        .getByRole('button', { name: 'Asphalt paint', exact: true })
        .click();
    const visor = await page.evaluate(() => {
      const scene = window.garageScenes
        .filter((s) => s.getObjectByName('full-face-helmet'))
        .at(-1)!;
      const helmet = scene.getObjectByName('full-face-helmet') as THREE.Mesh;
      const vertices = helmet.geometry.getAttribute('position');
      const section: { y: number; z: number }[] = [];
      for (let i = 0; i < vertices.count; i++) {
        const x = vertices.getX(i),
          y = vertices.getY(i),
          z = vertices.getZ(i);
        if (Math.abs(x) < 1e-6 && z < 0 && y >= -0.049001 && y <= 0.045001)
          section.push({ y, z });
      }
      section.sort((a, b) => a.y - b.y);
      const low = section[0],
        high = section.at(-1)!;
      const outward = section.map(
        (p) =>
          low.z + ((high.z - low.z) * (p.y - low.y)) / (high.y - low.y) - p.z,
      );
      return {
        count: section.length,
        min: Math.min(...outward),
        max: Math.max(...outward),
      };
    });
    expect(visor.count).toBeGreaterThan(20);
    expect(visor.min).toBeGreaterThanOrEqual(-1e-6);
    expect(visor.max).toBeGreaterThan(0.001);
    expect(visor.max).toBeLessThan(0.003);
    for (const [angle, label] of [
      ['FRONT ¾', 'three-quarter'],
      ['SIDE', 'side'],
      ['REAR ¾', 'rear'],
      ['FRONT', 'front'],
    ]) {
      await page
        .getByRole('button', { name: `Inspect ${angle}`, exact: true })
        .click();
      await page.locator('canvas').waitFor();
      await page.waitForTimeout(450);
      await page
        .getByTestId('garage-model')
        .screenshot({ path: `outputs/final-${id}-${label}.png` });
    }
  }
  await page.getByRole('button', { name: 'Inspect SIDE', exact: true }).click();
  await page.waitForTimeout(500);
  const canvas = page.locator('canvas');
  const before = await canvas.screenshot();
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width * 0.75,
    box!.y + box!.height * 0.5,
    { steps: 6 },
  );
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  await page.getByRole('button', { name: 'Inspect SIDE', exact: true }).click();
  await page.waitForTimeout(500);
  expect((await canvas.screenshot()).equals(before)).toBe(true);
  expect(errors).toEqual([]);
});
