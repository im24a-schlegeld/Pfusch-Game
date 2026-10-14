import { expect, it } from 'vitest';
import * as THREE from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeImportedBike } from '../app/game/importedBike';
import { getImportedBikeAsset } from '../app/game/importedBikeAsset';
import { hardwareComponents } from '../app/game/importedHardwareFinish';
import { installImportedBikeFixtures } from './importedBikeFixture';

installImportedBikeFixtures(['701']);

it.each(['frontWheel', 'rearWheel'] as const)('rounds the actual Sport %s hoop while preserving spoke interiors, hub and original profile vertices', (side) => {
  const asset = getImportedBikeAsset('701');
  const part = asset.manifest.parts.find(p => p.name === `r6_rim:${side}`)!;
  const source = new Float32Array(asset.binary, part.position.offset, part.position.count * 3);
  const sourceIndex = new Uint16Array(asset.binary, part.index.offset, part.index.count);
  const axle = side === 'frontWheel' ? asset.manifest.anchors.frontAxle : asset.manifest.anchors.rearAxle;
  const sourceRadius = (vertex: number) => Math.hypot(source[vertex * 3 + 1] - axle[1], source[vertex * 3 + 2] - axle[2]);
  const cutoff = side === 'frontWheel' ? 0.2 : 0.203;
  const hoop = side === 'frontWheel' ? new Set(hardwareComponents(part, asset.binary).filter(component =>
    component.triangles.length > 100 && component.triangles.every(triangle => [0, 1, 2].every(corner => {
      const vertex = sourceIndex[triangle * 3 + corner] * 3;
      return Math.hypot(source[vertex + 1] - axle[1], source[vertex + 2] - axle[2]) > 0.2;
    }))).flatMap(component => component.triangles)) : new Set(Array.from({ length: sourceIndex.length / 3 }, (_, triangle) => triangle)
      .filter(triangle => [0, 1, 2].every(corner => sourceRadius(sourceIndex[triangle * 3 + corner]) > cutoff)));
  expect(hoop.size).toBe(side === 'frontWheel' ? 504 : 241);
  const bike = makeImportedBike({ ...newPlayer(), bike: '701' }, [], parent => {
    const group = new THREE.Group(); parent.add(group);
    return { group, animate() {}, animateAccessories() {}, applyRagdollPose() {},
      captureRagdollPose() { throw new Error('No rider in rim fixture'); } };
  });
  const mesh = bike.body.getObjectByName(part.name) as THREE.Mesh;
  const position = mesh.geometry.getAttribute('position'), indices = mesh.geometry.index!;
  const scale = position.getX(0) / (source[0] - axle[0]);
  const preserved = new Set<string>();
  let largestAngle = 0;
  for (let triangle = 0; triangle < indices.count; triangle += 3) {
    const vertices = [indices.getX(triangle), indices.getX(triangle + 1), indices.getX(triangle + 2)];
    preserved.add(vertices.join(','));
    if (!vertices.every(vertex => Math.hypot(position.getY(vertex), position.getZ(vertex)) > cutoff * scale)) continue;
    for (let corner = 0; corner < 3; corner++) {
      const a = vertices[corner], b = vertices[(corner + 1) % 3];
      const dot = (position.getY(a) * position.getY(b) + position.getZ(a) * position.getZ(b)) /
        (Math.hypot(position.getY(a), position.getZ(a)) * Math.hypot(position.getY(b), position.getZ(b)));
      largestAngle = Math.max(largestAngle, Math.acos(THREE.MathUtils.clamp(dot, -1, 1)));
    }
  }
  // A 64-section circle keeps sag below .13% of its radius at any camera angle.
  expect(largestAngle).toBeLessThanOrEqual(Math.PI / 32 + 0.00001);
  for (let triangle = 0; triangle < sourceIndex.length / 3; triangle++) {
    // Connected rear spokes only receive matching splits at the hoop contact;
    // their interiors, the complete hub and valve remain original triangles.
    if (!hoop.has(triangle) && [0, 1, 2].filter(corner => sourceRadius(sourceIndex[triangle * 3 + corner]) > cutoff).length < 2)
      expect(preserved.has(Array.from(sourceIndex.slice(triangle * 3, triangle * 3 + 3)).join(','))).toBe(true);
  }
  for (let vertex = 0; vertex < part.position.count; vertex++) {
    expect(position.getX(vertex)).toBeCloseTo((source[vertex * 3] - axle[0]) * scale, 6);
    expect(position.getY(vertex)).toBeCloseTo((source[vertex * 3 + 1] - axle[1]) * scale, 6);
    expect(position.getZ(vertex)).toBeCloseTo((source[vertex * 3 + 2] - axle[2]) * scale, 6);
  }
  expect(mesh.geometry.groups).toHaveLength(0);
  expect(mesh.material).not.toBeInstanceOf(Array);
  expect(indices.count).toBeLessThan(30000);
  expect(position.count).toBeLessThan(5000);
  const normal = mesh.geometry.getAttribute('normal'), uv = mesh.geometry.getAttribute('uv');
  expect(normal.count).toBe(position.count); expect(uv.count).toBe(position.count);
  expect(Array.from(normal.array).every(Number.isFinite)).toBe(true);
});
