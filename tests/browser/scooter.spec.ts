import { test, expect } from '@playwright/test';
import type * as THREE from 'three';
import { newPlayer } from '../../app/domain/progression';
import type { Player } from '../../app/domain/types';

declare global {
  interface Window {
    scooterScenes: THREE.Scene[];
  }
}

test('Roller previews freely, unlocks for 250 at level 2, equips explicitly and rides after reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const player = { ...newPlayer(), xp: 200, level: 2, coins: 250 };
  player.settings.tutorialSeen = true;
  await page.addInitScript((initial) => {
    if (!localStorage.getItem('pfusch:player:v1'))
      localStorage.setItem('pfusch:player:v1', JSON.stringify(initial));
    window.scooterScenes = [];
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', (event) => {
      const item = (event as CustomEvent).detail;
      if (item.isScene) window.scooterScenes.push(item);
    });
  }, player);
  const saved = () =>
    page.evaluate(
      () => JSON.parse(localStorage.getItem('pfusch:player:v1')!) as Player,
    );
  await page.goto('/');
  await page.getByRole('button', { name: 'OPEN GARAGE', exact: true }).click();
  await page.getByRole('tab', { name: 'BIKE', exact: true }).click();
  const before = await saved();
  expect(before).toMatchObject({ bike: '125', xp: 200, level: 2, coins: 250 });
  expect(before.ownedItems).not.toContain('bike:scooter');
  const model = page.getByTestId('garage-model');
  const preview = page.getByRole('button', {
    name: 'Preview Roller',
    exact: true,
  });
  const equip = page.getByRole('button', {
    name: 'EQUIP BIKE SETUP',
    exact: true,
  });
  await preview.click();
  await expect(model).toHaveAttribute('data-bike', 'scooter');
  await expect(equip).toBeDisabled();
  expect(await saved()).toEqual(before);
  await page
    .getByRole('button', { name: 'RESET PREVIEW', exact: true })
    .click();
  await expect(model).toHaveAttribute('data-bike', '125');
  expect(await saved()).toEqual(before);

  await preview.click();
  const unlock = page.getByRole('button', { name: /UNLOCK ROLLER/ });
  await expect(unlock).toContainText('250');
  await expect(unlock).toBeEnabled();
  await unlock.click();
  const purchased = {
    ...before,
    coins: 0,
    ownedItems: [...before.ownedItems, 'bike:scooter'],
  };
  await expect.poll(saved).toEqual(purchased);
  await expect(equip).toBeEnabled();
  // A reload also discards the preview after purchase: ownership is not Equip.
  await page.reload();
  await page.getByRole('button', { name: 'OPEN GARAGE', exact: true }).click();
  await expect(model).toHaveAttribute('data-bike', '125');
  await page.getByRole('tab', { name: 'BIKE', exact: true }).click();
  await preview.click();
  expect(await saved()).toEqual(purchased);
  await expect(unlock).toHaveCount(0);
  await equip.click();
  const equipped = { ...purchased, bike: 'scooter' };
  await expect.poll(saved).toEqual(equipped);
  await page.reload();
  await page.getByRole('button', { name: 'OPEN GARAGE', exact: true }).click();
  await expect(model).toHaveAttribute('data-bike', 'scooter');
  expect(await saved()).toEqual(equipped);
  // Read-only Three.js observation proves the new ride builds the scooter,
  // rather than merely retaining its selection while falling back to a bike.
  await page.evaluate(() => {
    window.scooterScenes = [];
  });
  await page
    .getByRole('button', { name: 'RIDE EQUIPPED SETUP', exact: true })
    .click();
  const ride = page.getByTestId('ride-screen');
  await expect(ride).toHaveAttribute('data-phase', 'playing');
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.scooterScenes.some(
          (scene) =>
            !!scene.getObjectByName('scooter-chassis') &&
            !!scene.getObjectByName('scooter-floorboard'),
        ),
      ),
    )
    .toBe(true);
  await expect
    .poll(async () => Number(await ride.getAttribute('data-distance')))
    .toBeGreaterThan(0);
  await page.keyboard.press('ArrowLeft');
  await expect(ride).toHaveAttribute('data-lane', '-1');
  await page.keyboard.press('p');
  await expect(ride).toHaveAttribute('data-phase', 'paused');
  expect(await saved()).toEqual(equipped);
  expect(errors).toEqual([]);
});
