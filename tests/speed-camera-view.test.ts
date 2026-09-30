import { describe, expect, it } from 'vitest';
import {
  AdditiveBlending,
  Box3,
  BufferGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Scene,
  Vector3,
} from 'three';
import { BIKES } from '../app/domain/config';
import type { SpeedCameraState } from '../app/game/speedCamera';
import { World } from '../app/game/world';
import { makeWorldView } from '../app/game/worldView';

describe('speed camera scene integration', () => {
  it.each([false, true])(
    'keeps one physical sensor and flash aligned across world cell changes (low=%s)',
    (low) => {
      const scene = new Scene();
      const world = new World(
        523,
        BIKES.find((bike) => bike.id === '701')!,
      );
      const view = makeWorldView(scene, low);
      const camera: SpeedCameraState = {
        id: 1,
        active: true,
        distance: 200,
        side: -1,
        triggered: true,
      };
      const sensor = scene.getObjectByName('Blitzer') as Group;
      const flash = sensor.getObjectByName('BlitzerFlash') as Mesh<
        BufferGeometry,
        MeshBasicMaterial
      >;
      const glow = sensor.getObjectByName('BlitzerFlashGlow') as Mesh<
        BufferGeometry,
        MeshBasicMaterial
      >;
      const resources = sensor.children.slice();
      for (const distance of [100, 107.9, 108.1, 197.5, 201]) {
        world.advance(distance);
        view.update(world, distance);
        view.updateSpeedCamera(camera, distance, 0.75);
        scene.updateMatrixWorld(true);
        expect(sensor.getWorldPosition(new Vector3()).toArray()).toEqual([
          -6.35,
          0,
          distance - 200,
        ]);
        expect(sensor.visible).toBe(true);
        expect(flash.visible).toBe(true);
        expect(flash.material.opacity).toBe(0.75);
        expect(glow.visible).toBe(true);
        expect(glow.material.opacity).toBe(0.75);
        expect(sensor.children).toEqual(resources);
      }
      expect(
        scene.children.filter((child) => child.name === 'Blitzer'),
      ).toHaveLength(1);
      expect(
        view.root.children.every((child) => child instanceof InstancedMesh),
      ).toBe(true);
      expect(sensor.scale.x).toBe(1.12);
      camera.active = false;
      view.updateSpeedCamera(camera, 202, 1);
      expect(sensor.visible).toBe(false);
      expect(flash.visible).toBe(false);
      expect(flash.material.opacity).toBe(0);
      expect(glow.visible).toBe(false);
      expect(glow.material.opacity).toBe(0);
    },
  );

  it.each([-1, 1] as const)(
    'stands level and road-aligned on shoulder %s with a bright sensor flash',
    (side) => {
      const scene = new Scene();
      const view = makeWorldView(scene, true);
      view.updateSpeedCamera(
        { id: 1, active: true, distance: 180, side, triggered: true },
        150,
        1,
      );
      scene.updateMatrixWorld(true);
      const sensor = scene.getObjectByName('Blitzer') as Group;
      const direction = (axis: Vector3) =>
        axis.transformDirection(sensor.matrixWorld);
      expect(direction(new Vector3(0, 1, 0)).toArray()).toEqual([0, 1, 0]);
      expect(direction(new Vector3(0, 0, 1)).toArray()).toEqual([0, 0, 1]);
      // Housing height, excluding the transparent glow, remains grounded and is
      // visibly larger than the old 2.31 m cabinet without entering the road.
      const base = new Box3().setFromObject(
        sensor.getObjectByName('BaseCabinet')!,
      );
      const roof = new Box3().setFromObject(
        sensor.getObjectByName('SlopedRoof_LeftLow_RightHigh')!,
      );
      expect(base.min.y).toBeCloseTo(0, 6);
      expect(roof.max.y).toBeGreaterThan(2.7);
      expect(
        Math.min(Math.abs(base.min.x), Math.abs(base.max.x)),
      ).toBeGreaterThan(5.7);

      const flash = sensor.getObjectByName('BlitzerFlash') as Mesh<
        BufferGeometry,
        MeshBasicMaterial
      >;
      const glow = sensor.getObjectByName('BlitzerFlashGlow') as Mesh<
        BufferGeometry,
        MeshBasicMaterial
      >;
      const recess = new Box3().setFromObject(
        sensor.getObjectByName('SensorRecess')!,
      );
      const core = new Box3().setFromObject(flash);
      expect(core.min.x).toBeGreaterThan(recess.min.x);
      expect(core.max.x).toBeLessThan(recess.max.x);
      expect(core.min.y).toBeGreaterThan(recess.min.y);
      expect(core.max.y).toBeLessThan(recess.max.y);
      expect(core.min.z).toBeGreaterThan(recess.max.z);
      expect(flash.material.opacity).toBe(1);
      expect(flash.material.toneMapped).toBe(false);
      expect(glow.material.toneMapped).toBe(false);
      expect(glow.material.blending).toBe(AdditiveBlending);
      expect(glow.material.map).not.toBeNull();
      expect(glow.position.x).toBe(flash.position.x);
      expect(glow.position.y).toBe(flash.position.y);

      view.updateSpeedCamera(
        { id: 1, active: true, distance: 180, side, triggered: true },
        150,
        0,
      );
      expect(flash.visible).toBe(false);
      expect(glow.visible).toBe(false);
    },
  );
});
