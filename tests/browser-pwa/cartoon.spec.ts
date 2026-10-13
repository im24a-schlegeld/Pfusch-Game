import { expect, test, type Page } from '@playwright/test';
import type * as THREE from 'three';
import { newPlayer } from '../../app/domain/progression';
import type { Engine } from '../../app/game/engine';

declare global {
  interface Window {
    cartoonProbe: {
      engine?: Engine;
      renderer?: THREE.WebGLRenderer;
      scene?: THREE.Scene;
      camera?: THREE.Camera;
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
      const renderer = (event as CustomEvent).detail as THREE.WebGLRenderer;
      if (!renderer.isWebGLRenderer) return;
      const render = renderer.render.bind(renderer);
      renderer.render = (scene, camera) => {
        render(scene, camera);
        if (scene.getObjectByName('streamed-world')) {
          window.cartoonProbe.renderer = renderer;
          window.cartoonProbe.scene = scene as THREE.Scene;
          window.cartoonProbe.camera = camera;
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

async function showWorldLighting(page: Page, target: 'day' | 'night') {
  const frame = await page.evaluate((target) => {
    const probe = window.cartoonProbe;
    const engine = probe.engine!;
    // Use authored seeded segments: lighting, sky and scenery all follow the
    // normal production renderer. Only freeze simulation for visual inspection.
    const matches = (segment: Engine['environment']) => segment.end > engine.distance + 80 &&
      segment.lighting === target && segment.kind === (target === 'day' ? 'city' : 'open');
    let segment = engine.world.segments.find(matches);
    for (let i = 0; !segment && i < 1200; i++) {
      engine.distance = engine.world.segments.at(-1)!.end - 1;
      engine.world.advance(engine.distance);
      segment = engine.world.segments.find(matches);
    }
    if (!segment) throw new Error(`No ${target} segment in the seeded world`);
    engine.distance = Math.max(engine.distance, segment.start + 60);
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
    let meshes = 0, instances = 0, styledMaterials = 0;
    const materials = new Set<THREE.Material>();
    scene.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      meshes++;
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
      meshes, instances, styledMaterials,
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
        samples.push({ lighting, ...sample });
        expect(sample.style).toBe('cartoon');
        expect(sample.styledMaterials).toBeGreaterThan(15);
        expect(sample.toonPrograms).toBeGreaterThan(0);
        expect(sample.allProgramsLinked).toBe(true);
        expect(sample.contextLost).toBe(false);
        expect(sample.meshes).toBeLessThan(1900);
        expect(sample.instances).toBeLessThan(18000);
        expect(sample.drawCalls).toBeGreaterThan(20);
        expect(sample.triangles).toBeGreaterThan(1000);
        expect(sample.sky.visible).toBe(true);
        expect(sample.sky.cloudsVisible).toBe(true);
        expect(sample.sky.cloudCount).toBeGreaterThan(0);
        expect(sample.sky.cloudCount).toBeLessThanOrEqual(12);
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
