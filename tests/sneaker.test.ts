import { expect, it } from 'vitest';
import * as THREE from 'three';
import { createSneaker } from '../app/game/sneaker';

it('keeps the supplied sneaker small, untextured and mirrored at fixed adult size', () => {
  const left = createSneaker('#e6e4dd', -1), right = createSneaker('#7461a5', 1);
  const size = right.geometry.boundingBox!.getSize(new THREE.Vector3());
  expect(size.z).toBeCloseTo(0.30, 4);
  expect(size.x).toBeGreaterThan(0.09);
  expect(size.x).toBeLessThan(0.13);
  expect(size.y).toBeLessThan(0.15);
  expect(right.geometry.index!.count / 3).toBeLessThan(2500);
  expect(right.geometry.groups).toHaveLength(3);
  expect(left.geometry.boundingBox!.getSize(new THREE.Vector3()).toArray()).toEqual(size.toArray());
  expect(left.geometry.attributes.position.getX(0)).toBe(-right.geometry.attributes.position.getX(0));
  expect(left.geometry.index!.getX(1)).toBe(right.geometry.index!.getX(2));
  expect(left.material[0].userData.appearanceColorSlot).toBe('shoesColor');
  expect(right.material[0].color.getHexString()).toBe('7461a5');
  expect(right.material[1].color.equals(left.material[1].color)).toBe(true);
  for (const material of [...left.material, ...right.material]) {
    expect(material.map).toBeNull();
    expect(material.normalMap).toBeNull();
    expect(material.bumpMap).toBeNull();
    expect(material.metalness).toBe(0);
  }
});
