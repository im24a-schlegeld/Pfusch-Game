import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type * as THREE from 'three';
import { newPlayer } from '../../app/domain/progression';
import type { Engine } from '../../app/game/engine';
import type { WorldKind, WorldLighting } from '../../app/game/world';
import type { Product } from '../../app/domain/types';

type WorldViewTarget = { kind: WorldKind; lighting?: WorldLighting; tunnelStyle?: 'modern' | 'weathered' };

declare global {
  interface Window {
    cartoonProbe: {
      engine?: Engine;
      renderer?: THREE.WebGLRenderer;
      scene?: THREE.Scene;
      camera?: THREE.Camera;
      inspectionCamera?: THREE.Camera;
      afterRideFrame?: () => void;
      plainBackground?: boolean;
      plainBackgroundColor?: THREE.Color;
      isolatedBike?: THREE.Object3D;
      restoreWorld?: () => void;
      frames: number;
    };
  }
}

async function startCartoonRide(page: Page, gear?: { bike: string; upper: Product; variantId: string }) {
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
  player.bike = gear?.bike ?? '450';
  player.paint = '#7461a5';
  player.ownedItems.push(`bike:${player.bike}`, 'paint:#7461a5');
  if (gear) {
    player.ownedItems.push(gear.upper.id);
    player.equipped.upper = gear.upper.id;
    player.variants[gear.upper.id] = gear.variantId;
  }
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
        if (window.cartoonProbe.plainBackground) {
          (scene as THREE.Scene).background = window.cartoonProbe.plainBackgroundColor!;
          for (const child of scene.children)
            if (!(child as THREE.Light).isLight) child.visible = child === window.cartoonProbe.isolatedBike;
        }
        render(scene, actualCamera);
        if (scene.getObjectByName('streamed-world')) {
          window.cartoonProbe.renderer = renderer;
          window.cartoonProbe.scene = scene as THREE.Scene;
          window.cartoonProbe.camera = actualCamera;
          window.cartoonProbe.frames++;
          window.cartoonProbe.afterRideFrame?.();
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
    // The round now pins its owner/bike/seed with Engine in useState; the older
    // useMemo layout held Engine directly inside [value, dependencies].
    type Hook = { memoizedState: unknown; next: Hook | null };
    type Fiber = { memoizedState: Hook | null; return: Fiber | null };
    const element = document.querySelector('[data-testid="ride-screen"]')! as unknown as Record<string, unknown>;
    let fiber = element[Object.keys(element).find((key) => key.startsWith('__reactFiber$'))!] as Fiber | null;
    while (fiber) {
      for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const state = Array.isArray(hook.memoizedState) ? hook.memoizedState[0] : hook.memoizedState;
        const candidate = (state && typeof state === 'object' && 'engine' in state
          ? state.engine : state) as Engine | undefined;
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

async function captureMovingRide(page: Page, motion: 'left' | 'right' | 'wheelie', path: string) {
  const frame = await page.evaluate((motion) => new Promise<{
    dataUrl: string; ticks: number; distance: number; lane: number; x: number; wheelieAngle: number;
    productionCamera: boolean; cuffCount: number; treeForms: { name: string; count: number; shared: boolean; depthWrite: boolean }[];
    heroOutlines: number; hardContours: number; treeDraws: number; programsLinked: boolean; contextLost: boolean;
  }>((resolve, reject) => {
    const probe = window.cartoonProbe, engine = probe.engine!;
    const startTick = engine.fixedTicks, startDistance = engine.distance;
    const timeout = setTimeout(() => {
      probe.afterRideFrame = undefined;
      engine.pause();
      reject(new Error(`No moving ${motion} frame from the production camera`));
    }, 45000);
    probe.inspectionCamera = undefined;
    engine.clearInput();
    for (const obstacle of engine.obstacles) obstacle.active = false;
    engine.phase = 'playing';
    if (motion === 'wheelie') engine.hold(true);
    else engine.move(motion === 'left' ? -1 : 1);
    probe.afterRideFrame = () => {
      const moving = engine.phase === 'playing' && engine.fixedTicks > startTick + 2 && engine.distance > startDistance;
      const posed = motion === 'wheelie' ? engine.wheelieAngle > 0.5 : engine.laneChangeAge > 0.1 && engine.laneChangeAge < 0.5;
      if (!moving || !posed) return;
      const scene = probe.scene!;
      const treeForms = ['cone-foliage', 'canopy-foliage', 'round-trunk'].map(form => {
        const source = scene.getObjectByName(`world-${form}`) as THREE.InstancedMesh;
        const shell = source.children.find(child => child.userData.cartoonWorldFoliageOutline) as THREE.InstancedMesh;
        return { name: form, count: shell?.count ?? -1, depthWrite: (shell?.material as THREE.Material)?.depthWrite === true,
          shared: shell?.geometry === source.geometry && shell?.instanceMatrix === source.instanceMatrix && shell?.count === source.count };
      });
      const cuffs = scene.getObjectsByProperty('name', 'continuous-trouser-leg') as THREE.SkinnedMesh[];
      const cuffCount = cuffs.filter(leg => {
        const edge = leg.geometry.getAttribute('cartoonGarmentEdge');
        const shell = leg.children.find(child => child.userData.cartoonOutline) as THREE.SkinnedMesh;
        return edge && edge.getX(edge.count - 1) === 0 && shell?.skeleton === leg.skeleton;
      }).length;
      let heroOutlines = 0, hardContours = 0, treeDraws = 0;
      scene.traverse(object => {
        if (object.userData.cartoonOutline) heroOutlines++;
        if (object.userData.cartoonContour) hardContours++;
        if (object.userData.cartoonWorldFoliageOutline && object.visible && (object as THREE.InstancedMesh).count > 0) treeDraws++;
      });
      const gl = probe.renderer!.getContext();
      const programs = probe.renderer!.info.programs as unknown as { program: WebGLProgram }[];
      // Save the exact advancing production frame before pausing the fixture.
      // Canvas capture runs only in this test observer, never in game code.
      const dataUrl = probe.renderer!.domElement.toDataURL('image/png');
      const result = { dataUrl, ticks: engine.fixedTicks - startTick, distance: engine.distance - startDistance,
        lane: engine.lane, x: engine.x, wheelieAngle: engine.wheelieAngle,
        productionCamera: !probe.inspectionCamera, cuffCount, treeForms, heroOutlines, hardContours, treeDraws,
        programsLinked: programs.every(entry => gl.getProgramParameter(entry.program, gl.LINK_STATUS)), contextLost: gl.isContextLost() };
      probe.afterRideFrame = undefined;
      clearTimeout(timeout);
      engine.pause();
      resolve(result);
    };
    window.dispatchEvent(new Event('focus'));
  }), motion);
  await writeFile(path, Buffer.from(frame.dataUrl.split(',')[1], 'base64'));
  const { dataUrl: _image, ...measurements } = frame;
  expect(measurements.ticks).toBeGreaterThan(2);
  expect(measurements.distance).toBeGreaterThan(0);
  expect(measurements.productionCamera).toBe(true);
  expect(measurements.cuffCount).toBe(2);
  expect(measurements.treeForms.every(form => form.shared && form.count >= 0 && form.depthWrite)).toBe(true);
  expect(measurements.treeForms.some(form => form.count > 0)).toBe(true);
  expect(measurements.heroOutlines).toBeGreaterThan(0);
  expect(measurements.heroOutlines).toBeLessThanOrEqual(32);
  expect(measurements.hardContours).toBeLessThanOrEqual(10);
  expect(measurements.treeDraws).toBeLessThanOrEqual(3);
  expect(measurements.programsLinked).toBe(true);
  expect(measurements.contextLost).toBe(false);
  return measurements;
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
          expect(sample.headlight).toBeGreaterThan(30);
          const smoothRoad = await page.evaluate(() => {
            const road = window.cartoonProbe.scene?.getObjectByName('world-box-asphalt') as THREE.Mesh | undefined;
            return !!road && !Array.isArray(road.material) && road.material.userData.pfuschSmoothRoadLighting === true;
          });
          expect(smoothRoad, 'the rendered night asphalt must use a continuous spotlight gradient').toBe(true);
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
      await showWorldView(page, { kind: 'open', lighting: 'day' });
      const movingFrames = [];
      for (const motion of ['left', 'right', 'wheelie'] as const)
        movingFrames.push(await captureMovingRide(page, motion, `outputs/browser-pwa/cartoon-motion-${motion}-${device}.png`));
      await info.attach('cartoon-moving-camera-measurements', { body: JSON.stringify(movingFrames, null, 2), contentType: 'application/json' });
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
  test('captures the real Sport T-shirt from behind without camera-angle ink through the sleeves', async ({ page, request }, info) => {
    const products = await (await request.get('/catalog/products.json')).json() as Product[];
    const product = products.find((entry) => entry.handle === 'keep-up-t-shirt')!;
    expect(product).toBeDefined();
    const color = product.preview!.colors.find((entry) => entry.id === 'hellblau')!;
    expect(color).toBeDefined();
    const errors = await startCartoonRide(page, { bike: '701', upper: product, variantId: color.variantIds[0] });
    const sample = await showWorldLighting(page, 'day');
    expect(sample.allProgramsLinked).toBe(true);
    await expect.poll(() => page.evaluate(() => {
      const torso = window.cartoonProbe.scene!.getObjectByName('tailored-garment') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      return torso.material.map?.version ?? 0;
    })).toBeGreaterThan(1);
    const cloth = await page.evaluate(() => {
      const scene = window.cartoonProbe.scene!;
      return ['tailored-garment', 'garment-sleeve'].flatMap((name) => scene.getObjectsByProperty('name', name))
        .map((object) => {
          const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
          const shell = mesh.children.find((child) => child.userData.cartoonOutline) as THREE.Mesh | undefined;
          const edge = mesh.geometry.getAttribute('cartoonGarmentEdge');
          return {
            name: mesh.name,
            surfaceInkDisabled: mesh.material.customProgramCacheKey().includes(':0.0:hero'),
            cuffOrHemRetained: Array.from({ length: edge.count }, (_, i) => edge.getX(i)).some((value) => value === 0),
            artworkRetained: !!mesh.material.map,
            sharedOutlineGeometry: shell?.geometry === mesh.geometry,
            outlineNormalsRetained: shell?.geometry.getAttribute('cartoonOutlineNormal')?.count === mesh.geometry.attributes.position.count,
            hardInteriorLines: mesh.children.some((child) => child.userData.cartoonContour),
          };
        });
    });
    expect(cloth).toHaveLength(3);
    for (const surface of cloth) {
      expect(surface.surfaceInkDisabled).toBe(true);
      expect(surface.cuffOrHemRetained).toBe(true);
      expect(surface.artworkRetained).toBe(true);
      expect(surface.sharedOutlineGeometry).toBe(true);
      expect(surface.outlineNormalsRetained).toBe(true);
      expect(surface.hardInteriorLines).toBe(false);
    }
    for (const angle of [{ name: 'rear', x: 0 }, { name: 'rear-quarter', x: 2.0 }]) {
      const frame = await page.evaluate((x) => {
        const probe = window.cartoonProbe;
        const camera = (probe.camera as THREE.PerspectiveCamera).clone();
        camera.position.set(x, 2.5, 4.5);
        camera.lookAt(0, 1.5, 0);
        camera.fov = 30;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);
        probe.inspectionCamera = camera;
        window.dispatchEvent(new Event('focus'));
        return probe.frames;
      }, angle.x);
      await expect.poll(() => page.evaluate(() => window.cartoonProbe.frames)).toBeGreaterThan(frame);
      await page.screenshot({ path: `outputs/browser-pwa/sport-tshirt-${angle.name}.png` });
    }
    // Retain a close, plain-background reference so missing exterior ink cannot
    // be mistaken for a clothing print, scenery edge or later cloud overlay.
    const isolatedFrame = await page.evaluate(() => {
      const probe = window.cartoonProbe, scene = probe.scene!;
      let bike: THREE.Object3D = scene.getObjectByName('tailored-garment')!;
      while (bike.parent && bike.parent !== scene) bike = bike.parent;
      const states = scene.children.map(child => ({ child, visible: child.visible }));
      const background = scene.background;
      const light = scene.children.find(child => (child as THREE.Light).isLight) as THREE.Light;
      probe.plainBackgroundColor = light.color.clone().set('#ffffff');
      scene.background = probe.plainBackgroundColor;
      for (const { child } of states) child.visible = child === bike || (child as THREE.Light).isLight;
      probe.plainBackground = true;
      probe.isolatedBike = bike;
      probe.restoreWorld = () => {
        for (const { child, visible } of states) child.visible = visible;
        scene.background = background;
        probe.plainBackground = false;
        probe.plainBackgroundColor = undefined;
        probe.isolatedBike = undefined;
        window.dispatchEvent(new Event('focus'));
      };
      window.dispatchEvent(new Event('focus'));
      return probe.frames;
    });
    await expect.poll(() => page.evaluate(() => window.cartoonProbe.frames)).toBeGreaterThan(isolatedFrame);
    await page.screenshot({ path: 'outputs/browser-pwa/sport-tshirt-rear-quarter-isolated.png' });
    await page.evaluate(() => { window.cartoonProbe.restoreWorld!(); delete window.cartoonProbe.restoreWorld; });
    await page.evaluate(() => { window.cartoonProbe.inspectionCamera = undefined; });
    await showWorldView(page, { kind: 'open', lighting: 'day' });
    const movingFrames = [];
    for (const motion of ['left', 'right', 'wheelie'] as const)
      movingFrames.push(await captureMovingRide(page, motion, `outputs/browser-pwa/sport-tshirt-motion-${motion}.png`));
    await info.attach('sport-tshirt-moving-camera', { body: JSON.stringify(movingFrames, null, 2), contentType: 'application/json' });
    await info.attach('sport-tshirt-contours', { body: JSON.stringify(cloth, null, 2), contentType: 'application/json' });
    expect(errors).toEqual([]);
  });
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
