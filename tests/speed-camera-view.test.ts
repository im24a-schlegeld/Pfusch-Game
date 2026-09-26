import { describe, expect, it } from 'vitest';
import {
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
        expect(sensor.children).toEqual(resources);
      }
      expect(
        scene.children.filter((child) => child.name === 'Blitzer'),
      ).toHaveLength(1);
      expect(
        view.root.children.every((child) => child instanceof InstancedMesh),
      ).toBe(true);
      expect(sensor.scale.x).toBe(0.95);
      camera.active = false;
      view.updateSpeedCamera(camera, 202, 1);
      expect(sensor.visible).toBe(false);
      expect(flash.visible).toBe(false);
      expect(flash.material.opacity).toBe(0);
    },
  );
});
