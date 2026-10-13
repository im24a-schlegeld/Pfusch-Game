import { expect, it } from 'vitest';
import * as THREE from 'three';
import { createSneaker } from '../app/game/sneaker';

it('places the wider big-toe tip toward the rider centre on both feet', () => {
  for (const side of [-1, 1]) {
    const shoe = createSneaker('#e6e4dd', side);
    const positions = shoe.geometry.attributes.position;
    const tip = new THREE.Box3(), point = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++)
      if (positions.getZ(i) < -0.13) tip.expandByPoint(point.fromBufferAttribute(positions, i));
    expect(tip.isEmpty()).toBe(false);
    // +X is inside the left foot; -X is inside the right foot. This is the
    // source shoe's asymmetric toe shape, not a test of its mirror flag.
    expect(side * tip.getCenter(point).x).toBeLessThan(-0.002);
  }
});

it('points the low toe and laces forward with the tall heel behind on both feet', () => {
  for (const side of [-1, 1]) {
    const shoe = createSneaker('#e6e4dd', side);
    const positions = shoe.geometry.attributes.position;
    const normals = shoe.geometry.attributes.normal;
    let toeHeight = 0, heelHeight = 0, toeNormalZ = 0, toeVertices = 0;
    for (let i = 0; i < positions.count; i++) {
      // The supplied low-top has a low rounded toe and a high rear collar.
      // These anatomical landmarks catch a 180-degree reversal at fixed size.
      if (positions.getZ(i) < -0.12) {
        toeHeight = Math.max(toeHeight, positions.getY(i));
        toeNormalZ += normals.getZ(i);
        toeVertices++;
      }
      if (positions.getZ(i) > 0.12)
        heelHeight = Math.max(heelHeight, positions.getY(i));
    }
    expect(toeVertices).toBeGreaterThan(0);
    expect(toeHeight).toBeLessThan(0.065);
    expect(heelHeight).toBeGreaterThan(0.10);
    expect(toeNormalZ / toeVertices).toBeLessThan(-0.15);

    const laces = shoe.geometry.groups.find(group => group.materialIndex === 2)!;
    const laceVertices = new Set<number>();
    for (let i = laces.start; i < laces.start + laces.count; i++)
      laceVertices.add(shoe.geometry.index!.getX(i));
    const laceCenterZ = [...laceVertices].reduce((sum, i) => sum + positions.getZ(i), 0)
      / laceVertices.size;
    expect(laceCenterZ).toBeLessThan(-0.02);
  }
});

it('keeps the supplied sneaker small, untextured and mirrored at fixed adult size', () => {
  const left = createSneaker('#e6e4dd', -1), right = createSneaker('#7461a5', 1);
  const size = right.geometry.boundingBox!.getSize(new THREE.Vector3());
  // Decimation may remove an extremal sole vertex; allow less than one mm.
  expect(Math.abs(size.z - 0.30)).toBeLessThan(0.001);
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

it('keeps the supplied shoe surface winding consistent with outward normals on both feet', () => {
  for (const side of [-1, 1]) {
    const shoe = createSneaker('#e6e4dd', side);
    const positions = shoe.geometry.attributes.position, normals = shoe.geometry.attributes.normal;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const edge = new THREE.Vector3(), face = new THREE.Vector3(), normal = new THREE.Vector3();
    let surfaceArea = 0, alignedArea = 0;
    for (let i = 0; i < shoe.geometry.index!.count; i += 3) {
      const ia = shoe.geometry.index!.getX(i), ib = shoe.geometry.index!.getX(i + 1);
      const ic = shoe.geometry.index!.getX(i + 2);
      a.fromBufferAttribute(positions, ia); b.fromBufferAttribute(positions, ib);
      c.fromBufferAttribute(positions, ic);
      face.crossVectors(edge.copy(b).sub(a), c.sub(a));
      normal.fromBufferAttribute(normals, ia)
        .add(b.fromBufferAttribute(normals, ib)).add(c.fromBufferAttribute(normals, ic))
        .multiplyScalar(1 / 3);
      surfaceArea += face.length();
      alignedArea += face.dot(normal);
    }
    // Source simplification retains some local deviations; reversed shell faces
    // or normals rotated separately from positions lose this area alignment.
    expect(alignedArea / surfaceArea).toBeGreaterThan(0.75);
  }
});
