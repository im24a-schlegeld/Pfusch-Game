import { expect, test } from '@playwright/test';
import type * as THREE from 'three';
import { newPlayer } from '../../app/domain/progression';
import type { Product } from '../../app/domain/types';

declare global {
  interface Window { artworkProbe: { renderers: number; printVersion: number; flagFrames: number; flagMoved: boolean; edgeProgram: boolean } }
}

test('mobile ride recovers a failed clothing image and renders the outlined flag in wind', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /THREE|WebGL|shader|garment artwork/i.test(message.text())) errors.push(message.text());
  });
  const products = await (await request.get('/catalog/products.json')).json() as Product[];
  const artwork = await (await request.get('/catalog/garment-textures.json')).json() as {
    products: Record<string, { front: { sourcesByColor: { localImage: string }[] } }>;
  };
  const upper = products.find(product => product.handle === 'signs-hoodie')!;
  const flag = products.find(product => product.category === 'cape')!;
  const player = newPlayer();
  player.settings.tutorialSeen = true;
  player.settings.tutorialHintsSeen = ['controls', 'ramp', 'police', 'radar', 'traffic', 'signs'];
  player.equipped.upper = upper.id; player.equipped.cape = flag.id;
  player.variants[upper.id] = upper.preview!.colors[0].variantIds[0];
  player.variants[flag.id] = flag.preview!.colors[0].variantIds[0];
  player.ownedItems.push(upper.id, flag.id);
  await page.addInitScript(saved => {
    localStorage.setItem('pfusch:player:v1', JSON.stringify(saved));
    window.artworkProbe = { renderers: 0, printVersion: 0, flagFrames: 0, flagMoved: false, edgeProgram: false };
    window.__THREE_DEVTOOLS__ = new EventTarget();
    let firstEdge: number | undefined;
    window.__THREE_DEVTOOLS__.addEventListener('observe', event => {
      const renderer = (event as CustomEvent).detail as THREE.WebGLRenderer & { isWebGLRenderer?: boolean };
      if (!renderer.isWebGLRenderer) return;
      window.artworkProbe.renderers++;
      const render = renderer.render.bind(renderer);
      renderer.render = (scene, camera) => {
        render(scene, camera);
        const garment = scene.getObjectByName('tailored-garment') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | undefined;
        window.artworkProbe.printVersion = Math.max(window.artworkProbe.printVersion, garment?.material.map?.version ?? 0);
        if (!scene.getObjectByName('streamed-world')) return;
        const cape = scene.getObjectByName('pfusch-flag-cape') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | undefined;
        if (!cape) return;
        window.artworkProbe.flagFrames++;
        window.artworkProbe.edgeProgram = cape.material.customProgramCacheKey().includes('pfusch-flag-cape-outline-v1');
        const positions = cape.geometry.getAttribute('position'), edge = positions.getZ(positions.count - 1);
        firstEdge ??= edge;
        if (Math.abs(edge - firstEdge) > .001) window.artworkProbe.flagMoved = true;
      };
    });
  }, player);
  let imageRequests = 0;
  const failedPath = artwork.products['signs-hoodie'].front.sourcesByColor[0].localImage;
  await page.route('**' + failedPath, route => ++imageRequests === 1 ? route.abort('failed') : route.continue());
  await page.goto('/');
  await expect(page.getByText('VORSCHAU WIRD GELADEN', { exact: true })).toBeHidden({ timeout: 45000 });
  await expect.poll(() => page.evaluate(() => window.artworkProbe.renderers)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.artworkProbe.printVersion)).toBeGreaterThanOrEqual(4);
  expect(imageRequests).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: /^Fahrt starten/i }).first().click();
  await expect(page.getByTestId('ride-screen')).toHaveAttribute('data-phase', 'playing');
  await expect.poll(() => page.evaluate(() => window.artworkProbe.flagFrames)).toBeGreaterThan(3);
  await expect.poll(() => page.evaluate(() => window.artworkProbe.flagMoved)).toBe(true);
  expect(await page.evaluate(() => window.artworkProbe.edgeProgram)).toBe(true);
  await page.screenshot({ path: 'outputs/browser/artwork-flag-mobile.png' });
  expect(errors).toEqual([]);
});
