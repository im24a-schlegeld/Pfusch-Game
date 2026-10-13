import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeImportedBike } from '../app/game/importedBike';
import { getImportedBikeAsset } from '../app/game/importedBikeAsset';
import { IMPORTED_BIKE_WHEELBASE } from '../app/game/importedBikeDimensions';
import { createPreviewColorUpdater } from '../app/game/previewAppearance';
import type { RagdollPose } from '../app/game/ragdoll';
import { installImportedBikeFixtures } from './importedBikeFixture';

installImportedBikeFixtures(['450', '701']);

function bike(id: '450' | '701' = '450', paint = '#ff0033') {
  return makeImportedBike({ ...newPlayer(), bike: id, paint }, [], (parent) => {
    const group = new THREE.Group();
    parent.add(group);
    return {
      group,
      animate: () => undefined,
      animateAccessories: () => undefined,
      captureRagdollPose: () => ({} as RagdollPose),
      applyRagdollPose: () => undefined,
    };
  });
}

describe('authored Supermoto rear guard', () => {
  it('uses the original black guard for stickers and does not invent a plate at the tail', () => {
    const model = bike();
    expect(model.body.getObjectByName('supermoto-mudflap')).toBeUndefined();
    const guard = model.body.getObjectByName('fs450_inner_trim:body');
    expect(guard).toBeInstanceOf(THREE.Mesh);
    const mesh = guard as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect(mesh.parent).toBe(model.body);
    expect(mesh.userData.importedPart).toBe('fs450_inner_trim:body');
    expect(mesh.userData.bikePaintSurface).toBe(false);
    expect(mesh.userData.bikeStickerSurface).toBe(true);
    expect(bike('701').body.getObjectByName('supermoto-mudflap')).toBeUndefined();
    const initial = { ...newPlayer(), bike: '450' as const, paint: '#25292c' };
    const darkBike = bike('450', initial.paint);
    const update = createPreviewColorUpdater(darkBike.body, darkBike.rider, initial);
    const original = (darkBike.body.getObjectByName('fs450_inner_trim:body') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material.color.clone();
    update({ ...initial, paint: '#ffffff' });
    const darkGuard = darkBike.body.getObjectByName('fs450_inner_trim:body') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect(darkGuard.material.color.equals(original)).toBe(true);
  });

  it('preserves every source vertex and triangle of the existing guard', () => {
    const { manifest, binary } = getImportedBikeAsset('450');
    const part = manifest.parts.find(part => part.name === 'fs450_inner_trim:body')!;
    const sourcePositions = new Float32Array(binary, part.position.offset, part.position.count * 3);
    const sourceIndices = new Uint16Array(binary, part.index.offset, part.index.count);
    const scale = IMPORTED_BIKE_WHEELBASE['450'] / Math.abs(manifest.anchors.rearAxle[2] - manifest.anchors.frontAxle[2]);
    const model = bike();
    const guard = model.body.getObjectByName('fs450_inner_trim:body') as THREE.Mesh;
    const positions = guard.geometry.getAttribute('position'), index = guard.geometry.getIndex()!;
    expect(positions.count).toBe(part.position.count);
    expect(index.count).toBe(part.index.count);
    for (let i = 0; i < sourcePositions.length; i++)
      expect(positions.array[i]).toBe(Math.fround(sourcePositions[i] * scale));
    for (let i = 0; i < sourceIndices.length; i++) expect(index.getX(i)).toBe(sourceIndices[i]);
    const original = Array.from(positions.array);
    model.animateSuspension(0.5, 0.125);
    expect(Array.from(positions.array)).toEqual(original);
  });

  it('keeps the stock guard below the exhaust and in front of the rear axle', () => {
    const model = bike();
    const guard = model.body.getObjectByName('fs450_inner_trim:body') as THREE.Mesh;
    guard.geometry.computeBoundingBox();
    const bounds = guard.geometry.boundingBox!, center = bounds.getCenter(new THREE.Vector3());
    const exhaust = model.body.getObjectByName('open-silencer-outlet')!;
    expect(center.y).toBeLessThan(exhaust.position.y);
    expect(center.z).toBeLessThan(model.wheels[1].position.z);
    expect(bounds.min.y).toBeLessThan(model.wheels[1].position.y + model.wheelRadius / model.body.scale.x);
  });
});
