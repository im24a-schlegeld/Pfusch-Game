import { expect, it } from 'vitest';
import * as THREE from 'three';
import { trimLoadingForegroundLamps } from '../scripts/loading-art-foreground';
import { World } from '../app/game/world';
import { makeWorldView } from '../app/game/worldView';

it('keeps background street lamps but removes the close foreground pole from the static loading composition', () => {
  const root = new THREE.Group();
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 3);
  poles.name = 'world-round-dark';
  const matrix = new THREE.Matrix4();
  const set = (i: number, x: number, z: number, height = 6.4) => {
    matrix.makeScale(0.065, height, 0.065).setPosition(x, height / 2, z);
    poles.setMatrixAt(i, matrix);
  };
  set(0, -6.45, -5); // The huge lamp immediately beside the approved low camera.
  set(1, -6.45, 12); // Background lighting remains part of the street.
  set(2, -6.45, -5, 1.1); // Another real prop is not a street lamp.
  root.add(poles); root.updateMatrixWorld(true);
  const original = Float32Array.from(poles.instanceMatrix.array);
  const camera = new THREE.PerspectiveCamera(37, 16 / 9, 0.05, 240);
  camera.position.set(-4.6, 3, -6.4); camera.lookAt(0, 2, 1.1); camera.updateMatrixWorld(true);
  const geometry = poles.geometry, buffer = poles.instanceMatrix;
  const result = trimLoadingForegroundLamps(root, camera, 5);
  expect(result.removed).toBe(1);
  expect(poles.count).toBe(2);
  expect(poles.geometry).toBe(geometry);
  expect(poles.instanceMatrix).toBe(buffer);
  poles.getMatrixAt(0, matrix);
  expect(new THREE.Vector3().setFromMatrixPosition(matrix).z).toBe(12);
  result.restore(); result.restore();
  expect(poles.count).toBe(3);
  expect(Array.from(poles.instanceMatrix.array)).toEqual(Array.from(original));
});

it('clears the foreground lamps in the actual approved desktop jump scene', () => {
  const scene = new THREE.Scene();
  const world = new World(42, { acceleration: 0.6, maxSpeed: 38 });
  world.advance(72);
  const view = makeWorldView(scene, false); view.update(world, 72);
  const camera = new THREE.PerspectiveCamera(37, 16 / 9, 0.05, 240);
  camera.position.set(-6.6550586, 2.9866415, -9.5983384);
  camera.lookAt(0.3103101, 3.0319185, 1.2420366); camera.updateMatrixWorld(true);
  const result = trimLoadingForegroundLamps(view.root, camera, 6);
  expect(result.removed).toBeGreaterThan(0);
  expect(view.root.children).toHaveLength(56);
  result.restore(); view.dispose();
});
