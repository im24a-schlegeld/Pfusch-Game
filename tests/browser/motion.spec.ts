import { test, expect } from '@playwright/test';
import type * as THREE from 'three';
import { writeFileSync } from 'node:fs';

type Probe = {
  scenes: THREE.Scene[];
  renderer?: THREE.WebGLRenderer;
  camera?: THREE.PerspectiveCamera;
  side: boolean;
};
declare global {
  interface Window {
    __THREE_DEVTOOLS__: EventTarget;
    motionProbe: Probe;
  }
}

test('rider joints react independently, retain contacts and freeze while paused', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-09-12T10:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-12T10:00:01Z'));
  await page.addInitScript(() => {
    window.motionProbe = { scenes: [], side: false };
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', (event) => {
      const item = (event as CustomEvent).detail;
      if (item.isScene) window.motionProbe.scenes.push(item);
      if (item.isWebGLRenderer) {
        window.motionProbe.renderer = item;
        const render = item.render.bind(item);
        item.render = (scene: THREE.Scene, camera: THREE.PerspectiveCamera) => {
          if (scene.getObjectByName('full-face-helmet'))
            window.motionProbe.camera = camera;
          if (
            window.motionProbe.side &&
            scene.getObjectByName('full-face-helmet')
          ) {
            camera.position.set(5, 2.8, 2.6);
            camera.lookAt(0, 1.5, 0);
          }
          render(scene, camera);
        };
      }
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'LET’S RIDE', exact: true }).click();
  await page.getByRole('button', { name: 'GOT IT. LET’S RIDE' }).click();
  await page.locator('canvas').waitFor();
  await page.clock.runFor(2200);
  const ride = page.getByTestId('ride-screen');
  await expect(ride).toHaveAttribute('data-phase', 'playing', {
    timeout: 20000,
  });
  const pose = () =>
    page.evaluate(() => {
      const scene = window.motionProbe.scenes
        .filter((s) => s.getObjectByName('full-face-helmet'))
        .at(-1)!;
      const garment = scene.getObjectByName('tailored-garment')!;
      const joints: number[][] = [];
      const geometries = new Set<string>();
      scene.getObjectByName('full-face-helmet')!.parent!.traverse((o) => {
        if ((o as THREE.Mesh).isMesh)
          geometries.add((o as THREE.Mesh).geometry.uuid);
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
          const bone = (o as THREE.SkinnedMesh).skeleton.bones[0];
          joints.push(bone.position.toArray());
        }
      });
      return {
        hip: garment.parent!.position.toArray(),
        joints,
        geometries: [...geometries],
      };
    });
  const before = await pose();
  await page.keyboard.down('s');
  await expect.poll(async () => {
    await page.clock.runFor(100);
    return ride.getAttribute('data-wheelie');
  }).toBe('true');
  await expect
    .poll(async () => {
      await page.clock.runFor(100);
      return (await pose()).hip[2];
    })
    .toBeGreaterThan(before.hip[2] + 0.02);
  const wheelie = await pose();
  expect(wheelie.joints).not.toEqual(before.joints);
  expect(wheelie.geometries).toEqual(before.geometries);
  await page.keyboard.press('Escape');
  await expect(ride).toHaveAttribute('data-phase', 'paused');
  const paused = await pose();
  await page.clock.runFor(200);
  expect(await pose()).toEqual(paused);
  await page.evaluate(() => {
    window.motionProbe.side = true;
  });
  const capture = async (path: string) => {
    const data = await page.evaluate(() => {
      const p = window.motionProbe;
      const scene = p.scenes
        .filter((s) => s.getObjectByName('full-face-helmet'))
        .at(-1)!;
      p.renderer!.render(scene, p.camera!);
      return p.renderer!.domElement.toDataURL('image/png').split(',')[1];
    });
    writeFileSync(path, Buffer.from(data, 'base64'));
  };
  await capture('outputs/rider-wheelie-side.png');
  await page.keyboard.up('s');
  await page.keyboard.press('Escape');
  await page.clock.runFor(250);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => {
    await page.clock.runFor(100);
    return (await pose()).hip[0];
  }).toBeGreaterThan(0.0005);
  await page.keyboard.press('Escape');
  await capture('outputs/rider-lane-response.png');
  expect(errors).toEqual([]);
});
