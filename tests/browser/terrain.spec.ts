import { test, expect, type Page } from '@playwright/test';
import type * as THREE from 'three';
import { newPlayer } from '../../app/domain/progression';
import type { Player } from '../../app/domain/types';
import type { Engine } from '../../app/game/engine';
import type { WorldSegment } from '../../app/game/world';

declare global {
  interface Window {
    terrainProbe: {
      scenes: THREE.Scene[];
      engine?: Engine;
      scene?: THREE.Scene;
      camera?: THREE.PerspectiveCamera;
      resources?: {
        mesh: THREE.InstancedMesh;
        geometry: THREE.BufferGeometry;
        material: THREE.Material | THREE.Material[];
        matrix: THREE.InstancedBufferAttribute;
        buffer: THREE.InstancedBufferAttribute['array'];
      }[];
    };
  }
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function start(page: Page, low: boolean) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.clock.install({ time: new Date('2026-09-15T10:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-15T10:00:01Z'));
  const player = newPlayer();
  player.settings.tutorialSeen = true;
  player.settings.quality = low ? 'low' : 'auto';
  await page.addInitScript((saved: Player) => {
    Math.random = () => 5489 / 0xffffffff;
    localStorage.setItem('pfusch:player:v1', JSON.stringify(saved));
    window.terrainProbe = { scenes: [] };
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', (event) => {
      const item = (event as CustomEvent).detail;
      if (item.isScene) window.terrainProbe.scenes.push(item);
      if (item.isWebGLRenderer) {
        const render = item.render.bind(item);
        item.render = (scene: THREE.Scene, camera: THREE.PerspectiveCamera) => {
          render(scene, camera);
          if (!scene.getObjectByName('streamed-world')) return;
          // Observe the actual production chase camera without overriding it.
          window.terrainProbe.scene = scene;
          window.terrainProbe.camera = camera;
        };
      }
    });
  }, player);
  await page.goto('/');
  await page.getByRole('button', { name: 'LET’S RIDE', exact: true }).click();
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

  // Match world.spec.ts: locate the real mounted engine for diagnostic seeks,
  // without adding an API to the product or replacing its world generator.
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
          window.terrainProbe.engine = candidate;
          return;
        }
      }
      fiber = fiber.return;
    }
    throw new Error('Mounted game engine was not found');
  });
  return errors;
}

async function nextTunnel(page: Page) {
  return page.evaluate(() => {
    const engine = window.terrainProbe.engine!;
    engine.clearInput();
    engine.phase = 'ready';
    let found: WorldSegment | undefined;
    for (let attempt = 0; attempt < 1200; attempt++) {
      found = engine.world.segments.find(
        (segment) =>
          segment.kind === 'tunnel' && segment.start >= engine.distance + 60,
      );
      if (found) break;
      engine.distance = Math.max(
        engine.distance + 80,
        engine.world.segments.at(-1)!.end - 1,
      );
      engine.world.advance(engine.distance);
    }
    if (!found)
      throw new Error('No tunnel with a visible approach in the seeded world');
    return { start: found.start, end: found.end, style: found.tunnel!.style };
  });
}

async function seekAndMove(page: Page, distance: number) {
  await page.evaluate((distance) => {
    const engine = window.terrainProbe.engine!;
    if (distance < engine.distance)
      throw new Error('Terrain QA cannot seek the world backward');
    engine.distance = distance;
    engine.world.advance(distance);
    engine.clearInput();
    for (const obstacle of engine.obstacles) obstacle.active = false;
    engine.phase = 'playing';
  }, distance);
  // Sample actual movement and cell recycling through the production fixed-step
  // engine; screenshots follow roughly 3.5 m after each stated seek marker.
  await page.clock.runFor(160);
  await expect(page.getByTestId('ride-screen')).toHaveAttribute(
    'data-phase',
    'playing',
  );
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const probe = window.terrainProbe;
    const scene = probe.scene!;
    const engine = probe.engine!;
    const root = scene.getObjectByName('streamed-world')!;
    const pools = root.children as THREE.InstancedMesh[];
    probe.resources ??= pools.map((mesh) => ({
      mesh,
      geometry: mesh.geometry,
      material: mesh.material,
      matrix: mesh.instanceMatrix,
      buffer: mesh.instanceMatrix.array,
    }));
    const resourcesStable =
      probe.resources.length === pools.length &&
      probe.resources.every(
        (resource, index) =>
          pools[index] === resource.mesh &&
          resource.mesh.geometry === resource.geometry &&
          resource.mesh.material === resource.material &&
          resource.mesh.instanceMatrix === resource.matrix &&
          resource.mesh.instanceMatrix.array === resource.buffer,
      );
    let meshes = 0;
    scene.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) meshes++;
    });
    const batches = pools.map((mesh) => ({
      name: mesh.name,
      count: mesh.count,
      capacity: mesh.instanceMatrix.count,
      finite: Array.from(
        mesh.instanceMatrix.array.slice(0, mesh.count * 16),
      ).every(Number.isFinite),
    }));
    const terrain = ['world-mountain-soil', 'world-berm-soil'].map((name) => {
      const mesh = root.getObjectByName(name) as
        | THREE.InstancedMesh
        | undefined;
      if (!mesh) throw new Error(`Missing terrain pool: ${name}`);
      mesh.geometry.computeBoundingBox();
      const matrix = mesh.matrix.clone();
      const bounds = Array.from({ length: mesh.count }, (_, index) => {
        mesh.getMatrixAt(index, matrix);
        const determinant = matrix.determinant();
        matrix.premultiply(mesh.matrixWorld);
        const box = mesh.geometry.boundingBox!.clone().applyMatrix4(matrix);
        return {
          min: box.min.toArray(),
          max: box.max.toArray(),
          determinant,
          start: engine.distance - box.max.z,
          end: engine.distance - box.min.z,
        };
      });
      return {
        name,
        count: mesh.count,
        bounds,
        geometryId: mesh.geometry.id,
        positionsVersion: (
          mesh.geometry.getAttribute('position') as THREE.BufferAttribute
        ).version,
        flatShading: (mesh.material as THREE.MeshStandardMaterial).flatShading,
      };
    });
    return {
      distance: engine.distance,
      kind: engine.environment.kind,
      tunnel: engine.world.tunnelExposure(engine.distance),
      segments: engine.world.segments.map(({ kind, start, end }) => ({
        kind,
        start,
        end,
      })),
      resourcesStable,
      meshes,
      batches,
      terrain,
      geometryCount: new Set(pools.map((mesh) => mesh.geometry)).size,
      materialCount: new Set(pools.map((mesh) => mesh.material)).size,
      rootZ: root.position.z,
      camera: {
        position: probe.camera!.position.toArray(),
        aspect: probe.camera!.aspect,
      },
      overflow:
        Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth,
        ) - window.innerWidth,
      canvasCount: document.querySelectorAll('canvas').length,
    };
  });
}

for (const low of [false, true]) {
  test(`tunnel mountain approach, open portals and exit remain bounded at ${low ? 'low' : 'normal'} quality`, async ({
    page,
  }, testInfo) => {
    const quality = low ? 'low' : 'normal';
    const errors = await start(page, low);
    const tunnel = await nextTunnel(page);
    const stages = [
      {
        name: 'approach-50m',
        distance: tunnel.start - 50,
        kind: 'tunnel-approach',
      },
      {
        name: 'approach-10m',
        distance: tunnel.start - 10,
        kind: 'tunnel-approach',
      },
      { name: 'entrance-plus5m', distance: tunnel.start + 5, kind: 'tunnel' },
      {
        name: 'interior',
        distance: (tunnel.start + tunnel.end) / 2,
        kind: 'tunnel',
      },
      { name: 'exit-minus10m', distance: tunnel.end - 10, kind: 'tunnel' },
      { name: 'exit-plus10m', distance: tunnel.end + 10, kind: 'tunnel-exit' },
    ];
    const samples: Awaited<ReturnType<typeof snapshot>>[] = [];
    for (const stage of stages) {
      await seekAndMove(page, stage.distance);
      const sample = await snapshot(page);
      samples.push(sample);
      expect(sample.distance).toBeGreaterThan(stage.distance);
      expect(sample.distance).toBeLessThan(stage.distance + 5);
      expect(sample.kind).toBe(stage.kind);
      expect(sample.segments.length).toBeLessThanOrEqual(8);
      expect(sample.resourcesStable).toBe(true);
      expect(sample.meshes).toBeLessThan(1800);
      expect(
        sample.batches.reduce((sum, batch) => sum + batch.count, 0),
      ).toBeLessThan(16000);
      expect(sample.geometryCount).toBe(7);
      expect(sample.materialCount).toBe(samples[0].materialCount);
      expect(sample.canvasCount).toBe(1);
      expect(sample.overflow).toBeLessThanOrEqual(1);
      expect(sample.camera.position[1]).toBeCloseTo(4.4, 5);
      expect(sample.camera.position[2]).toBeCloseTo(8.4, 5);
      expect(sample.camera.aspect).toBeCloseTo(390 / 844, 5);
      expect(sample.rootZ).toBeGreaterThanOrEqual(0);
      expect(sample.rootZ).toBeLessThan(12);
      for (const batch of sample.batches) {
        expect(batch.finite, batch.name).toBe(true);
        expect(batch.count, batch.name).toBeLessThanOrEqual(batch.capacity);
        expect(batch.capacity, batch.name).toBe(1024);
      }
      const mountain = sample.terrain[0];
      const berm = sample.terrain[1];
      expect(mountain.count).toBeGreaterThan(0);
      if (stage.name !== 'interior') expect(berm.count).toBeGreaterThan(0);
      for (const terrain of sample.terrain) {
        expect(terrain.flatShading).toBe(true);
        const original = samples[0].terrain.find(
          (item) => item.name === terrain.name,
        )!;
        expect(terrain.positionsVersion).toBe(original.positionsVersion);
        expect(terrain.geometryId).toBe(original.geometryId);
        for (const bound of terrain.bounds) {
          expect([...bound.min, ...bound.max].every(Number.isFinite)).toBe(
            true,
          );
          expect(bound.determinant).toBeGreaterThan(0);
          expect(bound.end).toBeGreaterThan(bound.start);
          const kinds =
            terrain.name === 'world-mountain-soil'
              ? ['tunnel']
              : ['tunnel-approach', 'tunnel-exit'];
          expect(
            sample.segments.some(
              (segment) =>
                kinds.includes(segment.kind) &&
                bound.start >= segment.start - 0.0001 &&
                bound.end <= segment.end + 0.0001,
            ),
            terrain.name,
          ).toBe(true);
        }
      }
      for (const bound of mountain.bounds) {
        expect(bound.min[0]).toBeCloseTo(-35, 5);
        expect(bound.max[0]).toBeCloseTo(35, 5);
        expect(bound.max[1]).toBeCloseTo(17.5, 5);
      }
      // Berm shear affects height, but its X extent must remain beyond both
      // portal supports and the full ±4.8 m asphalt corridor in either quality.
      for (const bound of berm.bounds)
        expect(bound.min[0] >= 7.229 || bound.max[0] <= -7.229).toBe(true);
      if (stage.name === 'interior') expect(sample.tunnel).toBe(1);
      if (stage.kind !== 'tunnel') expect(sample.tunnel).toBe(0);
      const path = testInfo.outputPath(
        `terrain-${quality}-${stage.name}-390x844.png`,
      );
      await page.screenshot({ path });
      await testInfo.attach(`${quality} ${stage.name}, production camera`, {
        path,
        contentType: 'image/png',
      });
    }
    await testInfo.attach(`terrain-${quality}-measurements`, {
      body: JSON.stringify({ quality, tunnel, samples }, null, 2),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
  });
}
