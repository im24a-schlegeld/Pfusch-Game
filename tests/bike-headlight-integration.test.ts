import { SPORT_LENS_FACES } from '../app/game/sportDesign';
import { describe, expect, it, vi } from 'vitest';
import {
  DirectionalLight,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Scene,
  SpotLight,
  Vector3,
} from 'three';
import { newPlayer } from '../app/domain/progression';
import { createBikeHeadlightRig } from '../app/game/bikeHeadlight';
import { makeBike } from '../app/game/vehicle';
import type { BikeModelId } from '../app/game/vehicleScale';
import {
  World,
  type WorldLighting,
  type WorldSegment,
} from '../app/game/world';
import { makeWorldLighting } from '../app/game/worldLighting';

// Keep the actual assembled vehicle and suspension; only canvas-backed clothing
// textures need an adapter in Node, as in motorcycle-scale.test.ts.
vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

type Point = readonly [number, number, number];
type Bike = ReturnType<typeof makeBike>;
const lensFaces: Readonly<Record<BikeModelId, readonly Point[]>> = {
  '125': [[0, 0.967, -0.604]],
  scooter: [[0, 0.611, -0.785]],
  '450': [[0, 0.99, -0.641]],
  // Shared S1 optical faces; the assertions below also verify the actual mesh vertices.
  '701': SPORT_LENS_FACES,
};

function lightingFixture() {
  const scene = new Scene();
  const renderer = { toneMappingExposure: 1, setClearColor: vi.fn() };
  const hemisphere = new HemisphereLight();
  const sun = new DirectionalLight();
  const fill = new DirectionalLight();
  const lighting = makeWorldLighting(scene, renderer, hemisphere, sun, fill);
  return { scene, lighting };
}

function controlledWorld() {
  const world = new World(523, { acceleration: 0.15, maxSpeed: 35 });
  const segment: WorldSegment = {
    id: 0,
    kind: 'city',
    start: 0,
    end: 1000,
    startTime: 0,
    endTime: 40,
    lighting: 'night',
    variant: 0,
  };
  const at = vi.spyOn(world, 'at').mockReturnValue(segment);
  const tunnel = vi.spyOn(world, 'tunnelExposure').mockReturnValue(0);
  return {
    world,
    set(lighting: WorldLighting, exposure = 0) {
      at.mockReturnValue({ ...segment, lighting });
      tunnel.mockReturnValue(exposure);
    },
  };
}

function expectVector(actual: Vector3, expected: Vector3) {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
  expect(actual.z).toBeCloseTo(expected.z, 10);
}

function expectSourceAndAim(
  bike: Bike,
  model: BikeModelId,
  lights: readonly SpotLight[],
) {
  lensFaces[model].forEach(([x, y, z], index) => {
    expectVector(
      lights[index].position,
      bike.body.localToWorld(new Vector3(x, y, z)),
    );
    expectVector(
      lights[index].target.position,
      bike.body.localToWorld(new Vector3(x, y - (20 * 1.22) / 23, z - 20)),
    );
  });
}

function expectAnchorsOnVisibleLenses(bike: Bike, model: BikeModelId) {
  bike.root.updateMatrixWorld(true);
  const toBody = new Matrix4().copy(bike.body.matrixWorld).invert();
  const nearest = lensFaces[model].map(() => Infinity);
  let count = 0;
  bike.body.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const color =
      object.material instanceof MeshStandardMaterial
        ? object.material.color.getHexString()
        : '';
    const isLens =
      model === '125'
        ? color === 'e7e4b8'
        : model === '450'
          ? color === '1c272a'
          : object.name ===
            (model === '701' ? 'sport-projector-lens' : 'scooter-headlight');
    if (!isLens) return;
    count++;
    const transform = new Matrix4().multiplyMatrices(
      toBody,
      object.matrixWorld,
    );
    const positions = object.geometry.getAttribute('position');
    const point = new Vector3();
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(transform);
      lensFaces[model].forEach(([x, y, z], index) => {
        nearest[index] = Math.min(
          nearest[index],
          Math.hypot(point.x - x, point.y - y, point.z - z),
        );
      });
    }
  });
  expect(count).toBe(lensFaces[model].length);
  for (const distance of nearest) expect(distance).toBeLessThan(2e-7);
}

describe('assembled motorcycle headlights and the world light pool', () => {
  it.each(['125', 'scooter', '450', '701'] as const)(
    '%s follows the real lens geometry through suspension, wheelies, jumps and lean',
    (model) => {
      const { scene, lighting } = lightingFixture();
      const { world } = controlledWorld();
      const bike = makeBike({ ...newPlayer(), bike: model }, []);
      const rig = createBikeHeadlightRig(model);
      scene.add(bike.root);
      expectAnchorsOnVisibleLenses(bike, model);
      expect(rig.count).toBe(lensFaces[model].length);

      bike.animateSuspension(0, 0);
      lighting.update(world, 100, 0, rig.count);
      rig.copyPose(bike.body, lighting.headlights);
      expectSourceAndAim(bike, model, lighting.headlights);
      const grounded = lighting.headlights.slice(0, rig.count).map((light) => ({
        source: light.position.clone(),
        target: light.target.position.clone(),
      }));
      for (let i = 0; i < rig.count; i++)
        expect(lighting.headlights[i].target.position.y).toBeLessThan(
          lighting.headlights[i].position.y,
        );

      // Leave the scene matrices stale: the light rig must consume this frame's
      // assembled pose before WebGLRenderer has had a chance to update them.
      bike.animateSuspension(0.7, 0);
      lighting.update(world, 100, 0, rig.count);
      rig.copyPose(bike.body, lighting.headlights);
      expectSourceAndAim(bike, model, lighting.headlights);
      for (let i = 0; i < rig.count; i++) {
        const light = lighting.headlights[i];
        expect(light.position.y).toBeGreaterThan(grounded[i].source.y + 0.4);
        expect(light.target.position.y).toBeGreaterThan(light.position.y + 8);
      }

      bike.animateSuspension(0, 0);
      bike.root.position.y = 1.2;
      lighting.update(world, 100, 0, rig.count);
      rig.copyPose(bike.body, lighting.headlights);
      expectSourceAndAim(bike, model, lighting.headlights);
      for (let i = 0; i < rig.count; i++) {
        expectVector(
          lighting.headlights[i].position,
          grounded[i].source.clone().add(new Vector3(0, 1.2, 0)),
        );
        expectVector(
          lighting.headlights[i].target.position,
          grounded[i].target.clone().add(new Vector3(0, 1.2, 0)),
        );
      }

      bike.root.position.set(0.7, 0.8, 0);
      bike.root.rotation.z = -0.19;
      bike.animateSuspension(0.4, 0.024);
      lighting.update(world, 100, 0.7, rig.count);
      rig.copyPose(bike.body, lighting.headlights);
      expectSourceAndAim(bike, model, lighting.headlights);
      expect(lighting.headlights[0].position.x).not.toBeCloseTo(0.7, 3);
    },
  );

  it('keeps two named scene lights and splits the existing total darkness budget', () => {
    const { scene, lighting } = lightingFixture();
    const route = controlledWorld();
    const pooled = [...lighting.headlights];
    expect(pooled.map((light) => light.name)).toEqual([
      'road-headlight',
      'road-headlight-secondary',
    ]);
    expect(
      scene.children.filter((child) => child instanceof SpotLight),
    ).toHaveLength(2);
    for (const light of pooled) {
      expect(light.parent).toBe(scene);
      expect(light.target.parent).toBe(scene);
    }
    for (const [palette, tunnel, expectedDark] of [
      ['night', 0, 1],
      ['day', 0, 0],
      ['day', 0.65, 0.65],
      ['day', 1, 1],
      ['golden', 0, 0.08],
      ['dawn', 0, 0.2],
    ] as const) {
      route.set(palette, tunnel);
      for (const count of [2, 1] as const) {
        const dark = lighting.update(route.world, 100, 0.4, count);
        expect(pooled[0].visible).toBe(true);
        expect(dark).toBeCloseTo(expectedDark, 12);
        expect(pooled[0].intensity + pooled[1].intensity).toBeCloseTo(
          55 * dark,
          12,
        );
        expect(pooled[0].intensity).toBeCloseTo((55 * dark) / count, 12);
        if (count === 2) {
          expect(pooled[1].intensity).toBeCloseTo(pooled[0].intensity, 12);
          expect(pooled[1].visible).toBe(true);
        } else {
          expect(pooled[1].intensity).toBe(0);
          expect(pooled[1].visible).toBe(false);
        }
        expect(lighting.headlights[0]).toBe(pooled[0]);
        expect(lighting.headlights[1]).toBe(pooled[1]);
      }
    }
    expect(
      scene.children.filter((child) => child instanceof SpotLight),
    ).toHaveLength(2);
  });

  it('reuses the scene pool with the current chassis and optics after Sport → Scooter → Sport', () => {
    const { scene, lighting } = lightingFixture();
    const { world } = controlledWorld();
    const sport = makeBike({ ...newPlayer(), bike: '701' }, []);
    const sportRig = createBikeHeadlightRig('701');
    scene.add(sport.root);
    sport.animateSuspension(0.7, 0.01);
    lighting.update(world, 100, 0, sportRig.count);
    sportRig.copyPose(sport.body, lighting.headlights);
    expectSourceAndAim(sport, '701', lighting.headlights);
    const previousSource = lighting.headlights[0].position.clone();
    const pooled = [...lighting.headlights];

    scene.remove(sport.root);
    const scooter = makeBike({ ...newPlayer(), bike: 'scooter' }, []);
    const scooterRig = createBikeHeadlightRig('scooter');
    scene.add(scooter.root);
    scooter.root.position.set(-1.1, 1.2, 0);
    scooter.root.rotation.z = 0.15;
    scooter.animateSuspension(0, -0.008);
    // A removed previous chassis may continue to change; it must have no say in
    // the rebuilt bike's light source or target.
    sport.root.position.set(70, 80, 90);
    lighting.update(world, 100, -1.1, scooterRig.count);
    scooterRig.copyPose(scooter.body, lighting.headlights);
    expectSourceAndAim(scooter, 'scooter', lighting.headlights);
    expect(
      lighting.headlights[0].position.distanceTo(previousSource),
    ).toBeGreaterThan(0.5);
    expect(lighting.headlights[0].intensity).toBe(55);
    expect(lighting.headlights[1].intensity).toBe(0);
    expect(lighting.headlights[1].visible).toBe(false);

    scene.remove(scooter.root);
    scene.add(sport.root);
    sport.root.position.set(0.3, 0, 0);
    sport.animateSuspension(0, 0);
    lighting.update(world, 100, 0.3, sportRig.count);
    sportRig.copyPose(sport.body, lighting.headlights);
    expectSourceAndAim(sport, '701', lighting.headlights);
    expect(lighting.headlights[1].visible).toBe(true);
    expect(lighting.headlights.map((light) => light.intensity)).toEqual([
      27.5, 27.5,
    ]);
    expect(lighting.headlights[0]).toBe(pooled[0]);
    expect(lighting.headlights[1]).toBe(pooled[1]);
    expect(
      scene.children.filter((child) => child instanceof SpotLight),
    ).toHaveLength(2);
  });
});
