import { expect, test, type Page } from '@playwright/test';
import type * as THREE from 'three';
import { newPlayer } from '../../app/domain/progression';
import type { Engine } from '../../app/game/engine';
import type { WorldKind, WorldLighting } from '../../app/game/world';

type WorldViewTarget = { kind: WorldKind; lighting?: WorldLighting; tunnelStyle?: 'modern' | 'weathered' };

declare global {
  interface Window {
    cartoonProbe: {
      engine?: Engine;
      renderer?: THREE.WebGLRenderer;
      scene?: THREE.Scene;
      camera?: THREE.Camera;
      inspectionCamera?: THREE.Camera;
      frames: number;
    };
  }
}

async function startCartoonRide(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // This build server deliberately returns 401 for Shopify endpoints. Shader
    // failures must still fail the test instead of hiding in those HTTP logs.
    if ((message.type() === 'error' && /THREE\.|WebGL|shader/i.test(message.text())) ||
        /Shader Error|VALIDATE_STATUS|GL_INVALID|WebGL.*(?:error|failed)/i.test(message.text()))
      errors.push(message.text());
  });
  const player = newPlayer();
  player.settings.tutorialSeen = true;
  player.settings.tutorialHintsSeen = ['controls', 'ramp', 'police', 'radar', 'traffic', 'signs'];
  player.bike = '450';
  player.paint = '#7461a5';
  player.ownedItems.push('bike:450', 'paint:#7461a5');
  await page.addInitScript((saved) => {
    localStorage.setItem('pfusch:player:v1', JSON.stringify(saved));
    Math.random = () => 5489 / 0xffffffff;
    window.cartoonProbe = { frames: 0 };
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', (event) => {
      const renderer = (event as CustomEvent).detail as THREE.WebGLRenderer & { isWebGLRenderer?: boolean };
      if (!renderer.isWebGLRenderer) return;
      const render = renderer.render.bind(renderer);
      renderer.render = (scene, camera) => {
        const actualCamera = window.cartoonProbe.inspectionCamera ?? camera;
        render(scene, actualCamera);
        if (scene.getObjectByName('streamed-world')) {
          window.cartoonProbe.renderer = renderer;
          window.cartoonProbe.scene = scene as THREE.Scene;
          window.cartoonProbe.camera = actualCamera;
          window.cartoonProbe.frames++;
        }
      };
    });
  }, player);
  await page.goto('/', { waitUntil: 'load' });
  await page.getByRole('button', { name: /^Fahrt starten/i }).first().click();
  await expect(page.getByTestId('ride-screen')).toHaveAttribute('data-phase', 'playing');
  await expect.poll(() => page.evaluate(() => window.cartoonProbe.frames)).toBeGreaterThan(0);
  await page.evaluate(() => {
    // Observe the real mounted hook, without shipping a game/debug API.
    type Hook = { memoizedState: unknown; next: Hook | null };
    type Fiber = { memoizedState: Hook | null; return: Fiber | null };
    const element = document.querySelector('[data-testid="ride-screen"]')! as unknown as Record<string, unknown>;
    let fiber = element[Object.keys(element).find((key) => key.startsWith('__reactFiber$'))!] as Fiber | null;
    while (fiber) {
      for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const candidate = Array.isArray(hook.memoizedState) ? hook.memoizedState[0] as Engine : undefined;
        if (candidate?.world && typeof candidate.advance === 'function') {
          window.cartoonProbe.engine = candidate;
          candidate.clearInput();
          candidate.phase = 'ready';
          return;
        }
      }
      fiber = fiber.return;
    }
    throw new Error('The mounted cartoon ride engine was not found');
  });
  return errors;
}

async function showWorldLighting(page: Page, lighting: 'day' | 'night') {
  return showWorldView(page, { kind: lighting === 'day' ? 'city' : 'open', lighting });
}

async function showWorldView(page: Page, target: WorldViewTarget) {
  const frame = await page.evaluate((target) => {
    const probe = window.cartoonProbe;
    const engine = probe.engine!;
    // Use authored seeded segments: lighting, sky and scenery all follow the
    // normal production renderer. Only freeze simulation for visual inspection.
    const matches = (segment: Engine['environment']) => segment.end > engine.distance + 80 &&
      segment.kind === target.kind && (!target.lighting || segment.lighting === target.lighting) &&
      (!target.tunnelStyle || segment.tunnel?.style === target.tunnelStyle);
    let segment = engine.world.segments.find(matches);
    for (let i = 0; !segment && i < 2400; i++) {
      engine.distance = engine.world.segments.at(-1)!.end - 1;
      engine.world.advance(engine.distance);
      segment = engine.world.segments.find(matches);
    }
    if (!segment) throw new Error(`No ${JSON.stringify(target)} segment in the seeded world`);
    engine.distance = Math.max(engine.distance, segment.start + Math.min(60, (segment.end - segment.start) * 0.45));
    engine.world.advance(engine.distance);
    engine.clearInput();
    engine.phase = 'ready';
    for (const obstacle of engine.obstacles) obstacle.active = false;
    engine.spawn('car', -1, 28, 0, 6);
    engine.spawn('van', 1, 49, 0, 6);
    engine.spawn('towtruck', 0, 72, 0, 6);
    // Idle rendering intentionally sleeps; a normal focus invalidation requests
    // one fresh frame without restarting the simulation or adding a debug hook.
    window.dispatchEvent(new Event('focus'));
    return probe.frames;
  }, target);
  await expect.poll(() => page.evaluate(() => window.cartoonProbe.frames)).toBeGreaterThan(frame);
  return page.evaluate(() => {
    const { scene, renderer } = window.cartoonProbe;
    if (!scene || !renderer) throw new Error('Cartoon scene was not rendered');
    let meshes = 0, instances = 0, styledMaterials = 0, heroOutlines = 0, skinnedOutlines = 0;
    let sharedOutlineGeometry = true;
    const materials = new Set<THREE.Material>();
    scene.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      meshes++;
      if (object.userData.cartoonOutline) {
        heroOutlines++;
        sharedOutlineGeometry &&= (object as THREE.Mesh).geometry === (object.parent as THREE.Mesh)?.geometry;
        if ((object as THREE.SkinnedMesh).isSkinnedMesh) skinnedOutlines++;
      }
      if ((object as THREE.InstancedMesh).isInstancedMesh)
        instances += (object as THREE.InstancedMesh).count;
      const material = (object as THREE.Mesh).material;
      for (const entry of Array.isArray(material) ? material : [material]) {
        if (materials.has(entry)) continue;
        materials.add(entry);
        if (entry.userData.pfuschCartoon === true) styledMaterials++;
      }
    });
    const gl = renderer.getContext();
    const programs = renderer.info.programs as unknown as { cacheKey?: string; program: WebGLProgram }[];
    const sky = scene.getObjectByName('cartoon-sky');
    const clouds = scene.getObjectByName('cartoon-clouds') as THREE.InstancedMesh | undefined;
    return {
      style: scene.userData.visualStyle,
      environment: window.cartoonProbe.engine!.environment.kind,
      lighting: window.cartoonProbe.engine!.environment.lighting,
      tunnelStyle: window.cartoonProbe.engine!.environment.tunnel?.style,
      meshes, instances, styledMaterials, heroOutlines, skinnedOutlines, sharedOutlineGeometry,
      toonPrograms: programs.filter((program) => program.cacheKey?.includes(':pfusch-cartoon-v1:')).length,
      allProgramsLinked: programs.every((program) => gl.getProgramParameter(program.program, gl.LINK_STATUS)),
      contextLost: gl.isContextLost(),
      fog: (scene.fog as THREE.Fog).color.getHexString(),
      headlight: (scene.getObjectByName('road-headlight') as THREE.SpotLight).intensity,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      sky: {
        visible: sky?.visible === true,
        cloudCount: clouds?.count ?? 0,
        cloudsVisible: clouds?.visible === true,
        sunVisible: scene.getObjectByName('cartoon-sun')?.visible === true,
        moonVisible: scene.getObjectByName('cartoon-moon')?.visible === true,
        starsVisible: scene.getObjectByName('cartoon-stars')?.visible === true,
      },
    };
  });
}

for (const device of ['mobile', 'desktop'] as const) {
  test.describe(`cartoon ${device}`, () => {
    test.use({
      viewport: device === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      isMobile: device === 'mobile',
      hasTouch: device === 'mobile',
    });
    test('built ride renders cel shading and bounded scenery without shader errors', async ({ page }, info) => {
      const errors = await startCartoonRide(page);
      const samples = [];
      for (const lighting of device === 'mobile' ? ['day', 'night'] as const : ['day'] as const) {
        const sample = await showWorldLighting(page, lighting);
        samples.push(sample);
        expect(sample.style).toBe('cartoon');
        expect(sample.styledMaterials).toBeGreaterThan(15);
        expect(sample.toonPrograms).toBeGreaterThan(0);
        expect(sample.heroOutlines).toBeGreaterThan(0);
        expect(sample.heroOutlines).toBeLessThanOrEqual(32);
        expect(sample.skinnedOutlines).toBeGreaterThan(0);
        expect(sample.sharedOutlineGeometry).toBe(true);
        expect(sample.allProgramsLinked).toBe(true);
        expect(sample.contextLost).toBe(false);
        expect(sample.meshes).toBeLessThan(1900);
        expect(sample.instances).toBeLessThan(18000);
        expect(sample.drawCalls).toBeGreaterThan(20);
        expect(sample.triangles).toBeGreaterThan(1000);
        expect(sample.sky.visible).toBe(true);
        expect(sample.sky.cloudsVisible).toBe(true);
        expect(sample.sky.cloudCount).toBeGreaterThan(0);
        // Seven irregular clouds now share one bounded instanced puff mesh.
        expect(sample.sky.cloudCount).toBeLessThanOrEqual(56);
        if (lighting === 'night') {
          expect(sample.headlight).toBeGreaterThan(50);
          expect(sample.sky.moonVisible).toBe(true);
          expect(sample.sky.starsVisible).toBe(true);
        } else {
          expect(sample.headlight).toBe(0);
          expect(sample.sky.sunVisible).toBe(true);
        }
        await expect(page.locator('.graphics-error')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `outputs/browser-pwa/cartoon-${lighting}-${device}.png` });
      }
      if (samples.length > 1) expect(samples[0].fog).not.toBe(samples[1].fog);
      await info.attach('cartoon-render-measurements', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
      expect(errors).toEqual([]);
    });
  });
}

type GalleryImage = { label: string; dataUrl: string };

async function contactSheet(page: Page, title: string, description: string, images: GalleryImage[], columns: number, path: string) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.setContent(`<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; } body { margin: 0; padding: 28px; background: #24282d; color: #fff; font-family: Arial, sans-serif; }
    h1 { margin: 0 0 8px; font-size: 29px; } p { margin: 0 0 24px; color: #c5ccd4; font-size: 17px; }
    main { display: grid; grid-template-columns: repeat(${columns}, minmax(0, 1fr)); gap: 18px; }
    figure { margin: 0; background: #111820; border: 1px solid #4b5662; overflow: hidden; }
    img { display: block; width: 100%; height: auto; } figcaption { padding: 13px 15px; font-size: 18px; font-weight: 700; }
  </style></head><body><h1>${title}</h1><p>${description}</p><main>${images.map((image) =>
    `<figure><img src="${image.dataUrl}" alt="${image.label}"><figcaption>${image.label}</figcaption></figure>`).join('')}</main></body></html>`);
  await page.evaluate(() => Promise.all(Array.from(document.images, (image) => image.decode())));
  await page.screenshot({ path, fullPage: true });
}

test.describe('cartoon visual gallery', () => {
  test.use({ viewport: { width: 960, height: 600 }, isMobile: false, hasTouch: false });
  test('captures every authored environment and all four sky states from the real game', async ({ page, context }, info) => {
    test.setTimeout(240000);
    const errors = await startCartoonRide(page);
    const environments: { label: string; slug: string; target: WorldViewTarget }[] = [
      { label: 'Stadt', slug: 'city', target: { kind: 'city' } },
      { label: 'Industrie', slug: 'industrial', target: { kind: 'industrial' } },
      { label: 'Baustelle', slug: 'construction', target: { kind: 'construction' } },
      { label: 'Landstrasse', slug: 'open', target: { kind: 'open' } },
      { label: 'Am Wasser', slug: 'waterfront', target: { kind: 'waterfront' } },
      { label: 'Tunneleinfahrt', slug: 'tunnel-approach', target: { kind: 'tunnel-approach' } },
      { label: 'Tunnel · modern', slug: 'tunnel-modern', target: { kind: 'tunnel', tunnelStyle: 'modern' } },
      { label: 'Tunnel · verwittert', slug: 'tunnel-weathered', target: { kind: 'tunnel', tunnelStyle: 'weathered' } },
      { label: 'Tunnelausfahrt', slug: 'tunnel-exit', target: { kind: 'tunnel-exit' } },
      { label: 'Brückenauffahrt', slug: 'bridge-approach', target: { kind: 'bridge-approach' } },
      { label: 'Brücke', slug: 'bridge', target: { kind: 'bridge' } },
      { label: 'Brückenabfahrt', slug: 'bridge-exit', target: { kind: 'bridge-exit' } },
    ];
    const sceneryImages: GalleryImage[] = [];
    const skyImages: GalleryImage[] = [];
    const samples = [];
    for (const entry of environments) {
      const sample = await showWorldView(page, { ...entry.target, lighting: 'day' });
      expect(sample.environment).toBe(entry.target.kind);
      if (entry.target.tunnelStyle) expect(sample.tunnelStyle).toBe(entry.target.tunnelStyle);
      expect(sample.allProgramsLinked).toBe(true);
      expect(sample.contextLost).toBe(false);
      await expect(page.locator('.graphics-error')).toHaveCount(0);
      const screenshot = await page.screenshot({ path: `outputs/browser-pwa/environment-${entry.slug}.png` });
      sceneryImages.push({ label: entry.label, dataUrl: `data:image/png;base64,${screenshot.toString('base64')}` });
      samples.push({ label: entry.label, ...sample });
    }
    await showWorldView(page, { kind: 'city', lighting: 'day' });
    const heroFrame = await page.evaluate(() => {
      const probe = window.cartoonProbe;
      const camera = (probe.camera as THREE.PerspectiveCamera).clone();
      // Only the test's observer substitutes this camera for a detail shot.
      // The actual vehicle, immutable skeleton, materials and pose are intact.
      camera.position.set(3.8, 2.7, -5.0);
      camera.lookAt(0, 1.45, 0);
      camera.fov = 36;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      probe.inspectionCamera = camera;
      window.dispatchEvent(new Event('focus'));
      return probe.frames;
    });
    await expect.poll(() => page.evaluate(() => window.cartoonProbe.frames)).toBeGreaterThan(heroFrame);
    await page.screenshot({ path: 'outputs/browser-pwa/hero-cartoon-closeup.png' });
    await page.evaluate(() => { window.cartoonProbe.inspectionCamera = undefined; });
    const skies: { lighting: WorldLighting; label: string }[] = [
      { lighting: 'day', label: 'Tag · Sonne und Wolken' },
      { lighting: 'golden', label: 'Abend · warmes Licht' },
      { lighting: 'night', label: 'Nacht · Mond und Sterne' },
      { lighting: 'dawn', label: 'Morgendämmerung' },
    ];
    for (const entry of skies) {
      const sample = await showWorldView(page, { kind: 'open', lighting: entry.lighting });
      expect(sample.lighting).toBe(entry.lighting);
      expect(sample.sky.visible).toBe(true);
      expect(sample.allProgramsLinked).toBe(true);
      const screenshot = await page.screenshot({ path: `outputs/browser-pwa/sky-${entry.lighting}.png` });
      skyImages.push({ label: entry.label, dataUrl: `data:image/png;base64,${screenshot.toString('base64')}` });
      samples.push({ label: entry.label, ...sample });
    }
    // This is a labelled layout of actual screenshots, not replacement artwork.
    // The mounted game remains unchanged; no extra WebGL context is required.
    const gallery = await context.newPage();
    await contactSheet(gallery, 'PFUSCH · alle Streckenabschnitte',
      'Echte Spielansichten · 11 Umgebungen, mit beiden Tunnelvarianten',
      sceneryImages, 3, 'outputs/browser-pwa/overview-environments.png');
    await contactSheet(gallery, 'PFUSCH · Himmel und Tageszeiten',
      'Alle vier vorhandenen Lichtstimmungen · Regen und Schnee sind derzeit nicht im Spiel',
      skyImages, 2, 'outputs/browser-pwa/overview-sky.png');
    await gallery.close();
    await info.attach('environment-gallery-measurements', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
    expect(errors).toEqual([]);
  });
});
