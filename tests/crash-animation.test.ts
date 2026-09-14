import { describe, expect, it, vi } from 'vitest';
import {
  Bone,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Scene,
  SkinnedMesh,
  SpotLight,
  Vector3,
  type Object3D,
} from 'three';
import { newPlayer } from '../app/domain/progression';
import type { Product } from '../app/domain/types';
import catalog from '../public/catalog/products.json';
import { createBikeHeadlightRig } from '../app/game/bikeHeadlight';
import {
  createCrashAnimation,
  crashDuration,
} from '../app/game/crashAnimation';
import { makeBike } from '../app/game/vehicle';
import type { BikeModelId } from '../app/game/vehicleScale';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

function fixture(
  model: BikeModelId = '125',
  reducedMotion = false,
  cause = 'Traffic collision',
) {
  const bike = makeBike({ ...newPlayer(), bike: model }, []);
  const scene = new Scene();
  scene.add(bike.root);
  bike.root.position.set(0.4, 0.75, 0);
  bike.root.rotation.z = -0.08;
  bike.animateSuspension(0.7, 0.012);
  const animation = createCrashAnimation(bike, {
    cause,
    pitch: 0.7,
    travel: 0.012,
    reducedMotion,
  });
  return { bike, animation };
}

function pose(bike: ReturnType<typeof makeBike>) {
  return {
    position: bike.root.position.toArray(),
    rotation: bike.root.quaternion.toArray(),
    bodyPosition: bike.body.position.toArray(),
    bodyRotation: bike.body.quaternion.toArray(),
    riderPosition: bike.rider.position.toArray(),
    riderRotation: bike.rider.quaternion.toArray(),
  };
}

/** Measure rendered vertices independently of the cached support calculation. */
function minimumVisibleY(owner: Object3D, excluded?: Object3D) {
  let minimum = Infinity;
  const point = new Vector3(),
    instance = new Matrix4(),
    world = new Matrix4();
  const visit = (object: Object3D) => {
    if (object === excluded || !object.visible) return;
    if (object instanceof Mesh) {
      if (object instanceof SkinnedMesh) object.skeleton.update();
      const instances = object instanceof InstancedMesh ? object.count : 1;
      const count = object.geometry.getAttribute('position').count;
      for (let index = 0; index < instances; index++) {
        if (object instanceof InstancedMesh) {
          object.getMatrixAt(index, instance);
          world.multiplyMatrices(object.matrixWorld, instance);
        } else world.copy(object.matrixWorld);
        for (let vertex = 0; vertex < count; vertex++) {
          object.getVertexPosition(vertex, point).applyMatrix4(world);
          minimum = Math.min(minimum, point.y);
        }
      }
    }
    for (const child of object.children) visit(child);
  };
  visit(owner);
  return minimum;
}

describe('bounded crash presentation', () => {
  it.each(['125', 'scooter', '450', '701'] as const)(
    '%s falls and slides with unchanged adult bones, above the road and with attached light origins',
    (model) => {
      const { bike, animation } = fixture(model);
      const rig = createBikeHeadlightRig(model);
      const lights = [new SpotLight(), new SpotLight()];
      const bones: Bone[] = [];
      bike.rider.traverse((object) => {
        if (object instanceof Bone) bones.push(object);
      });
      const boneTransforms = bones.map((bone) => ({
        position: bone.position.toArray(),
        scale: bone.scale.toArray(),
      }));
      const riderScale = bike.rider.scale.clone();
      const initial = bike.root.position.clone();
      animation.advance(0, true);
      rig.copyPose(bike.body, lights);
      const inverse = bike.body.matrixWorld.clone().invert();
      const sources = lights
        .slice(0, rig.count)
        .map((light) => light.position.clone().applyMatrix4(inverse));
      for (let i = 0; i < 75; i++) {
        animation.advance(1 / 60, true);
        rig.copyPose(bike.body, lights);
        for (let lens = 0; lens < rig.count; lens++)
          expect(
            lights[lens].position.distanceTo(
              sources[lens].clone().applyMatrix4(bike.body.matrixWorld),
            ),
          ).toBeLessThan(1e-10);
      }
      expect(animation.elapsed).toBe(1.2);
      expect(Math.abs(bike.root.rotation.z)).toBeGreaterThan(1.4);
      expect(bike.root.position.z).toBeLessThan(initial.z - 1);
      expect(bike.rider.position.length()).toBeGreaterThan(0.3);
      bike.root.updateMatrixWorld(true);
      expect(minimumVisibleY(bike.rider)).toBeCloseTo(0.035, 4);
      expect(minimumVisibleY(bike.body, bike.rider)).toBeCloseTo(0.025, 4);
      expect(bike.rider.scale).toEqual(riderScale);
      expect(
        bones.map((bone) => ({
          position: bone.position.toArray(),
          scale: bone.scale.toArray(),
        })),
      ).toEqual(boneTransforms);
      expect(
        [
          ...animation.focus.toArray(),
          ...bike.rider.matrixWorld.elements,
        ].every(Number.isFinite),
      ).toBe(true);
      const settled = pose(bike);
      expect(animation.advance(0.1, true)).toBe(true);
      expect(pose(bike)).toEqual(settled);
    },
  );

  it('freezes presentation time and all transforms while unfocused or hidden, then completes using only active time', () => {
    const { bike, animation } = fixture();
    for (let i = 0; i < 4; i++) animation.advance(0.1, true);
    const frozen = pose(bike),
      elapsed = animation.elapsed,
      focus = animation.focus.clone();
    for (let i = 0; i < 40; i++)
      expect(animation.advance(0.1, false)).toBe(false);
    expect(animation.elapsed).toBe(elapsed);
    expect(pose(bike)).toEqual(frozen);
    expect(animation.focus).toEqual(focus);
    for (let i = 0; i < 9; i++) animation.advance(0.1, true);
    expect(animation.elapsed).toBe(1.2);
  });

  it('shows one brief static pose for reduced motion and skips voluntary endings', () => {
    expect(crashDuration('Traffic collision', false)).toBe(1.2);
    expect(crashDuration('Overrotated the wheelie', true)).toBe(0.18);
    expect(crashDuration('Ride ended', false)).toBe(0);
    expect(crashDuration('Ride ended', true)).toBe(0);
    const reduced = fixture('scooter', true);
    expect(reduced.animation.advance(0, true)).toBe(false);
    const still = pose(reduced.bike);
    expect(reduced.animation.advance(0.08, true)).toBe(false);
    expect(pose(reduced.bike)).toEqual(still);
    expect(reduced.animation.advance(0.1, true)).toBe(true);
    expect(pose(reduced.bike)).toEqual(still);
    const ended = fixture('701', false, 'Ride ended');
    const original = pose(ended.bike);
    expect(ended.animation.advance(0.1, true)).toBe(true);
    expect(pose(ended.bike)).toEqual(original);
  });

  it('bounds wall-clock stalls and ignores invalid or negative deltas', () => {
    const { animation } = fixture();
    animation.advance(40, true);
    expect(animation.elapsed).toBe(0.1);
    for (const dt of [NaN, Infinity, -1, 0]) animation.advance(dt, true);
    expect(animation.elapsed).toBe(0.1);
    expect(animation.focus.distanceTo(new Vector3())).toBeGreaterThan(0);
  });

  it.each([-0.12, 0.12])(
    'keeps the moving cap above the road from initial roll %s without raising the rider',
    (roll) => {
      const cap = (catalog as Product[]).find(
        (product) => product.handle === 'p-zero-cap',
      )!;
      for (const model of ['125', 'scooter', '450', '701']) {
        const player = newPlayer();
        player.bike = model;
        player.equipped.head = cap.id;
        const bike = makeBike(player, [cap]);
        bike.root.rotation.z = roll;
        bike.animateSuspension(1.3, 0.024);
        bike.animateAccessories({ reducedMotion: true }, 1 / 60);
        const animation = createCrashAnimation(bike, {
          cause: 'Overrotated the wheelie',
          pitch: 1.3,
          travel: 0.024,
          reducedMotion: false,
        });
        for (let frame = 0; frame < 80; frame++) {
          animation.advance(1 / 60, true);
          bike.animateAccessories({ longitudinalAcceleration: -10 }, 1 / 60);
        }
        bike.root.updateMatrixWorld(true);
        expect(bike.root.rotation.z).toBeLessThan(-1.4);
        expect(
          minimumVisibleY(bike.rider.getObjectByName('carried-cap')!),
        ).toBeGreaterThan(0.035);
        expect(minimumVisibleY(bike.rider)).toBeCloseTo(0.035, 4);
        expect(minimumVisibleY(bike.body, bike.rider)).toBeCloseTo(0.025, 4);
      }
    },
  );
});
