import { expect, it } from 'vitest';
import { Bone, Group } from 'three';
import { captureRidePose } from '../app/game/revivePresentation';

it('restores the same chassis and adult bones without creating replacement objects', () => {
  const root = new Group(), steering = new Group(), torso = new Bone(), arm = new Bone();
  root.position.set(2, 0, 0);
  torso.position.set(0, 1.2, 0);
  arm.position.set(.3, .4, 0);
  steering.matrixAutoUpdate = false;
  steering.matrix.makeRotationX(.4);
  root.add(steering, torso); torso.add(arm);
  const restore = captureRidePose(root), matrix = steering.matrix.clone();
  root.position.y = 3; root.rotation.z = 1.4;
  torso.position.y = -2; torso.scale.multiplyScalar(2); arm.position.y = -3;
  steering.matrix.identity();
  restore();
  expect(root.children).toEqual([steering, torso]);
  expect(root.position.toArray()).toEqual([2, 0, 0]);
  expect(root.rotation.z).toBe(0);
  expect(torso.position.toArray()).toEqual([0, 1.2, 0]);
  expect(torso.scale.toArray()).toEqual([1, 1, 1]);
  expect(arm.position.toArray()).toEqual([.3, .4, 0]);
  expect(steering.matrix.equals(matrix)).toBe(true);
});
