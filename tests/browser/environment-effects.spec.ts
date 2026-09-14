import { test, expect, type Page } from '@playwright/test';
import type * as THREE from 'three';
import { newPlayer } from '../../app/domain/progression';
import type { Player, Product } from '../../app/domain/types';
import type { Engine } from '../../app/game/engine';

declare global {
  interface Window {
    environmentEffectsProbe: {
      scenes: THREE.Scene[];
      engine?: Engine;
      numberCanvas?: HTMLCanvasElement;
      audio?: {
        context: AudioContext;
        analyser: AnalyserNode;
        oscillators: OscillatorNode[];
        edges: { from: AudioNode; to: AudioNode | AudioParam }[];
        send?: GainNode;
        reflection?: AnalyserNode;
      };
    };
  }
}

const keepUp = [
  {
    id: '10237102096713',
    handle: 'keep-up-zipper',
    color: 'original',
    blank: [255, 452],
    ink: [283, 393],
  },
  {
    id: '10237099737417',
    handle: 'keep-up-t-shirt',
    color: 'hellblau',
    blank: [257, 453],
    ink: [283, 406],
  },
  {
    id: '10237061759305',
    handle: 'keep-up-hoodie',
    color: 'blau',
    blank: [252, 447],
    ink: [278, 394],
  },
] as const;

async function installProbe(page: Page, player = newPlayer()) {
  await page.addInitScript((saved: Player) => {
    Math.random = () => 5489 / 0xffffffff;
    localStorage.setItem('pfusch:player:v1', JSON.stringify(saved));
    window.environmentEffectsProbe = { scenes: [] };
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', (event) => {
      const item = (event as CustomEvent).detail;
      if (item.isScene) window.environmentEffectsProbe.scenes.push(item);
    });
    const fillText = Object.getOwnPropertyDescriptor(
      CanvasRenderingContext2D.prototype,
      'fillText',
    )!.value as CanvasRenderingContext2D['fillText'];
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'fillText', {
      value: function (
        this: CanvasRenderingContext2D,
        ...args: Parameters<CanvasRenderingContext2D['fillText']>
      ) {
        Reflect.apply(fillText, this, args);
        if (
          this.canvas.width === 1024 &&
          this.font.includes('Merriweather') &&
          args[0] === '23'
        )
          window.environmentEffectsProbe.numberCanvas = this.canvas;
      },
    });
  }, player);
}

async function startRide(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'LET’S RIDE', exact: true }).click();
  // React's lazy-scene reveal also uses timers. Advance the paused test clock
  // while waiting so a cold bundle load cannot strand its Suspense fallback.
  await expect
    .poll(
      async () => {
        await page.clock.runFor(100);
        return page.locator('canvas').count();
      },
      { timeout: 20000 },
    )
    .toBe(1);
  await page.clock.runFor(2200);
  await expect(page.getByTestId('ride-screen')).toHaveAttribute(
    'data-phase',
    'playing',
  );
  // Find the real mounted Ride hook, without a production debug entry point.
  await page.evaluate(() => {
    type Hook = { memoizedState: unknown; next: Hook | null };
    type Fiber = { memoizedState: Hook | null; return: Fiber | null };
    const element = document.querySelector(
      '[data-testid="ride-screen"]',
    )! as unknown as Record<string, unknown>;
    let fiber = element[
      Object.keys(element).find((key) => key.startsWith('__reactFiber$'))!
    ] as Fiber | null;
    while (fiber) {
      for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const candidate = Array.isArray(hook.memoizedState)
          ? (hook.memoizedState[0] as Engine)
          : undefined;
        if (candidate?.world && typeof candidate.advance === 'function') {
          window.environmentEffectsProbe.engine = candidate;
          return;
        }
      }
      fiber = fiber.return;
    }
    throw new Error('Mounted game engine was not found');
  });
}

async function positionInWorld(
  page: Page,
  target: 'day' | 'night' | 'tunnel',
  playing = false,
) {
  const segment = await page.evaluate(
    ({ target, playing }) => {
      const engine = window.environmentEffectsProbe.engine!;
      const matches = (s: Engine['environment']) =>
        s.end > engine.distance + 80 &&
        (target === 'tunnel'
          ? s.kind === 'tunnel'
          : s.lighting === target && !s.kind.startsWith('tunnel'));
      let found = engine.world.segments.find(matches);
      for (let i = 0; !found && i < 1200; i++) {
        engine.distance = engine.world.segments.at(-1)!.end - 1;
        engine.world.advance(engine.distance);
        found = engine.world.segments.find(matches);
      }
      if (!found) throw new Error(`Seeded world did not provide ${target}`);
      engine.distance = Math.max(
        engine.distance,
        found.start + Math.min(60, (found.end - found.start) / 2),
      );
      engine.world.advance(engine.distance);
      engine.clearInput();
      engine.phase = playing ? 'playing' : 'ready';
      // Audio comparisons use the same capped speed and released throttle at every location.
      if (playing) engine.elapsed = 10000;
      for (const obstacle of engine.obstacles) obstacle.active = false;
      return { start: found.start, end: found.end };
    },
    { target, playing },
  );
  await page.clock.runFor(160);
  return segment;
}

async function garmentState(page: Page) {
  return page.evaluate(() => {
    const scene = window.environmentEffectsProbe.scenes
      .filter((scene) => scene.getObjectByName('tailored-garment'))
      .at(-1)!;
    const garment = scene.getObjectByName('tailored-garment') as THREE.Mesh;
    const material = garment.material as THREE.MeshStandardMaterial;
    const emissionMaterials = new Set<number>();
    scene.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      const materials = (object as THREE.Mesh).material;
      for (const m of Array.isArray(materials) ? materials : [materials])
        if (
          (m as THREE.MeshStandardMaterial).emissiveMap?.name ===
          'keep-up-ink-emission'
        )
          emissionMaterials.add((m as THREE.Material & { id: number }).id);
    });
    return {
      map: material.emissiveMap?.name ?? null,
      version: material.emissiveMap?.version ?? 0,
      intensity: material.emissiveIntensity,
      color: material.emissive.getHexString(),
      emissionMaterials: [...emissionMaterials],
      material: (material as THREE.MeshStandardMaterial & { id: number }).id,
      actualNumber:
        material.map?.image === window.environmentEffectsProbe.numberCanvas,
    };
  });
}

for (const item of keepUp) {
  test(`${item.handle}: actual photographed ink alone emits blue in tunnel/night and returns to daylight`, async ({
    page,
    request,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const products: Product[] = await (
      await request.get('/catalog/products.json')
    ).json();
    const product = products.find((product) => product.id === item.id)!;
    expect(product.handle).toBe(item.handle);
    const player = newPlayer();
    player.settings.tutorialSeen = true;
    player.ownedItems.push(item.id);
    player.equipped.upper = item.id;
    player.variants[item.id] = product.preview!.colors.find(
      (color) => color.id === item.color,
    )!.variantIds[0];
    await page.clock.install({ time: new Date('2026-09-13T10:00:00Z') });
    await page.clock.pauseAt(new Date('2026-09-13T10:00:01Z'));
    await installProbe(page, player);
    await startRide(page);
    await expect
      .poll(async () => (await garmentState(page)).version)
      .toBeGreaterThanOrEqual(3);
    const state = await garmentState(page);
    expect(state.map).toBe('keep-up-ink-emission');
    expect(state.color).toBe('1d6bff');
    // Sleeves, cuffs, hood and every other blank garment piece retain no ink emission map.
    expect(state.emissionMaterials).toEqual([state.material]);
    const mask = await page.evaluate(
      ({ blank, ink }) => {
        const scene = window.environmentEffectsProbe.scenes
          .filter((scene) => scene.getObjectByName('road-headlight'))
          .at(-1)!;
        const material = (
          scene.getObjectByName('tailored-garment') as THREE.Mesh
        ).material as THREE.MeshStandardMaterial;
        const canvas = material.emissiveMap!.image as HTMLCanvasElement;
        const ctx = canvas.getContext('2d')!;
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let frontInk = 0,
          backInk = 0,
          colored = 0,
          transparent = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 128) {
            if ((i / 4) % canvas.width < canvas.width / 2) backInk++;
            else frontInk++;
          }
          if (data[i] !== data[i + 1] || data[i] !== data[i + 2]) colored++;
          if (data[i + 3] !== 255) transparent++;
        }
        const maxAt = (x: number, y: number, radius: number) => {
          const pixels = ctx.getImageData(
            x - radius,
            y - radius,
            radius * 2 + 1,
            radius * 2 + 1,
          ).data;
          let max = 0;
          for (let i = 0; i < pixels.length; i += 4)
            max = Math.max(max, pixels[i]);
          return max;
        };
        return {
          frontInk,
          backInk,
          colored,
          transparent,
          // These source-photo reference swatches are between slogan lines and on the Y ink.
          blank: maxAt(blank[0], blank[1], 2),
          ink: maxAt(ink[0], ink[1], 4),
          fabric: [maxAt(20, 20, 10), maxAt(512, 800, 10), maxAt(900, 900, 10)],
          image: canvas.toDataURL('image/png'),
        };
      },
      { blank: item.blank, ink: item.ink },
    );
    expect(mask.frontInk).toBeGreaterThan(20);
    expect(mask.backInk).toBeGreaterThan(500);
    expect(mask.frontInk + mask.backInk).toBeLessThan(1024 * 1024 * 0.1);
    expect(mask.colored).toBe(0);
    expect(mask.transparent).toBe(0);
    expect(mask.blank).toBe(0);
    expect(mask.fabric).toEqual([0, 0, 0]);
    expect(mask.ink).toBeGreaterThan(200);
    await testInfo.attach(`${item.handle}-actual-emission-map`, {
      body: Buffer.from(mask.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
    for (const lighting of ['day', 'tunnel', 'night', 'day'] as const) {
      await positionInWorld(page, lighting);
      expect((await garmentState(page)).intensity).toBe(
        lighting === 'day' ? 0 : 0.95,
      );
      if (lighting === 'tunnel')
        await page.screenshot({
          path: testInfo.outputPath(`${item.handle}-dark-ride.png`),
        });
    }
    expect(errors).toEqual([]);
  });
}

test('all other catalog tops and the actual custom-number canvas have no garment emission', async ({
  page,
  request,
}) => {
  const products: Product[] = await (
    await request.get('/catalog/products.json')
  ).json();
  const player = newPlayer();
  player.settings.tutorialSeen = true;
  await installProbe(page, player);
  await page.goto('/');
  await page.getByRole('button', { name: 'OPEN GARAGE' }).click();
  await page.waitForFunction(() =>
    window.environmentEffectsProbe.scenes.some((scene) =>
      scene.getObjectByName('tailored-garment'),
    ),
  );
  const others = products.filter(
    (product) =>
      product.category === 'upper' &&
      !keepUp.some((item) => item.id === product.id),
  );
  expect(others.length).toBeGreaterThan(0);
  let numbersChecked = 0;
  for (const product of others) {
    const previousMaterial = (await garmentState(page)).material;
    await page
      .getByRole('button', { name: `Preview ${product.title}`, exact: true })
      .click();
    await expect(page.getByTestId('garage-model')).toHaveAttribute(
      'data-product',
      product.id,
    );
    await expect
      .poll(async () => (await garmentState(page)).material)
      .not.toBe(previousMaterial);
    if (product.preview?.numberCustomization) {
      await page.getByRole('textbox', { name: 'Zipper number' }).fill('23');
      await expect
        .poll(async () => (await garmentState(page)).actualNumber)
        .toBe(true);
      numbersChecked++;
    }
    await expect.poll(async () => (await garmentState(page)).map).toBeNull();
    const state = await garmentState(page);
    expect(state.color).toBe('000000');
    expect(state.emissionMaterials).toEqual([]);
    await page
      .getByRole('button', { name: 'LEAVE PREVIEW', exact: true })
      .click();
  }
  expect(numbersChecked).toBeGreaterThan(0);
});

test('real tunnel entry and exit change reflection output without changing capped-speed firing frequency; pause silences output', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-09-13T10:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-13T10:00:01Z'));
  const player = newPlayer();
  player.settings.muted = false;
  player.settings.tutorialSeen = true;
  await installProbe(page, player);
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        const analyser = this.createAnalyser();
        analyser.fftSize = 8192;
        analyser.smoothingTimeConstant = 0;
        window.environmentEffectsProbe.audio = {
          context: this,
          analyser,
          oscillators: [],
          edges: [],
        };
      }
      createOscillator() {
        const oscillator = super.createOscillator();
        window.environmentEffectsProbe.audio?.oscillators.push(oscillator);
        return oscillator;
      }
    };
    const connect = Object.getOwnPropertyDescriptor(
      AudioNode.prototype,
      'connect',
    )!.value as AudioNode['connect'];
    Object.defineProperty(AudioNode.prototype, 'connect', {
      value: function (
        this: AudioNode,
        destination: AudioNode | AudioParam,
        ...ports: number[]
      ) {
        const result = Reflect.apply(connect, this, [destination, ...ports]);
        const probe = window.environmentEffectsProbe.audio;
        if (probe?.context === this.context) {
          probe.edges.push({ from: this, to: destination });
          if (destination instanceof AudioDestinationNode)
            Reflect.apply(connect, this, [probe.analyser]);
        }
        return result;
      },
    });
  });
  await startRide(page);
  await positionInWorld(page, 'day', true);
  await page.evaluate(() => {
    const probe = window.environmentEffectsProbe.audio!;
    const sends = probe.edges.filter(
      (edge) =>
        edge.from instanceof GainNode &&
        edge.to instanceof DelayNode &&
        probe.edges.some(
          (input) => input.to === edge.from && input.from instanceof GainNode,
        ),
    );
    if (sends.length !== 1)
      throw new Error('Expected one real bus-to-reflection send');
    probe.send = sends[0].from as GainNode;
    const filter = probe.edges.find(
      (edge) =>
        edge.from === sends[0].to && edge.to instanceof BiquadFilterNode,
    )!.to;
    const wet = probe.edges.find(
      (edge) =>
        edge.from === filter &&
        edge.to instanceof GainNode &&
        !probe.edges.some(
          (output) => output.from === edge.to && output.to instanceof DelayNode,
        ),
    )!.to as GainNode;
    probe.reflection = probe.context.createAnalyser();
    probe.reflection.fftSize = 8192;
    probe.reflection.smoothingTimeConstant = 0;
    wet.connect(probe.reflection);
  });
  const level = () =>
    page.evaluate(() => {
      const probe = window.environmentEffectsProbe.audio!;
      const engine = window.environmentEffectsProbe.engine!;
      const rms = (analyser: AnalyserNode) => {
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        return Math.sqrt(
          samples.reduce((sum, sample) => sum + sample * sample, 0) /
            samples.length,
        );
      };
      return {
        frequency: probe.oscillators
          .filter((oscillator) => oscillator.type === 'custom')
          .at(-1)!.frequency.value,
        send: probe.send!.gain.value,
        rms: rms(probe.analyser),
        reflectionRms: rms(probe.reflection!),
        speed: engine.speed,
        throttle: engine.throttleInput,
        forward: engine.forwardInput,
        tunnel: engine.world.tunnelExposure(engine.distance),
        edges: probe.edges.length,
      };
    });
  await expect.poll(async () => (await level()).rms).toBeGreaterThan(0.005);
  // AudioContext time continues while the deterministic simulation clock is held.
  await page.waitForTimeout(1200);
  const outside = await level();
  expect(outside.tunnel).toBe(0);
  expect(outside.send).toBeLessThan(0.002);
  expect(outside.reflectionRms).toBeLessThan(0.0001);
  const tunnel = await positionInWorld(page, 'tunnel', true);
  await expect.poll(async () => (await level()).send).toBeGreaterThan(0.44);
  await expect
    .poll(async () => (await level()).reflectionRms)
    .toBeGreaterThan(0.001);
  const inside = await level();
  expect(inside.tunnel).toBe(1);
  expect(inside.send).toBeLessThanOrEqual(0.451);
  await page.evaluate((end) => {
    const engine = window.environmentEffectsProbe.engine!;
    engine.distance = end + 45;
    engine.world.advance(engine.distance);
    for (const obstacle of engine.obstacles) obstacle.active = false;
  }, tunnel.end);
  await page.clock.runFor(160);
  await expect.poll(async () => (await level()).send).toBeLessThan(0.002);
  await expect
    .poll(async () => (await level()).reflectionRms)
    .toBeLessThan(0.0001);
  const exited = await level();
  expect(exited.tunnel).toBe(0);
  for (const sample of [inside, exited]) {
    expect(sample.speed).toBe(outside.speed);
    expect(sample.throttle).toBe(0);
    expect(sample.forward).toBe(0);
    expect(Math.abs(sample.frequency - outside.frequency)).toBeLessThan(0.25);
    expect(sample.edges).toBe(outside.edges);
    expect(sample.rms).toBeGreaterThan(0.005);
  }
  await page.keyboard.press('Escape');
  await page.clock.runFor(160);
  await expect(page.getByTestId('ride-screen')).toHaveAttribute(
    'data-phase',
    'paused',
  );
  await expect.poll(async () => (await level()).rms).toBeLessThan(0.001);
  await testInfo.attach('measured-tunnel-audio', {
    body: JSON.stringify(
      { outside, inside, exited, paused: await level() },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});
