import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeImportedBike } from '../app/game/importedBike';
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

describe('imported Supermoto rear mudflap', () => {
  it('provides a black rubber sticker surface only on the Supermoto', () => {
    const model = bike();
    const flap = model.body.getObjectByName('supermoto-mudflap');
    expect(flap).toBeInstanceOf(THREE.Mesh);
    const mesh = flap as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect(mesh.parent).toBe(model.body);
    expect(mesh.userData.bikePaintSurface).toBe(false);
    expect(mesh.userData.bikeStickerSurface).toBe(true);
    expect(mesh.material.color.getHexString()).toBe('141414');
    expect(mesh.material.metalness).toBe(0);
    expect(mesh.material.roughness).toBe(1);
    expect(bike('701').body.getObjectByName('supermoto-mudflap')).toBeUndefined();
    const initial = { ...newPlayer(), bike: '450' as const, paint: '#141414' };
    const darkBike = bike('450', initial.paint);
    const update = createPreviewColorUpdater(darkBike.body, darkBike.rider, initial);
    update({ ...initial, paint: '#ffffff' });
    const darkFlap = darkBike.body.getObjectByName('supermoto-mudflap') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect(darkFlap.material.color.getHexString()).toBe('141414');
  });

  it('joins the actual tail underside with a closed thin sheet', () => {
    const model = bike();
    const flap = model.body.getObjectByName('supermoto-mudflap') as THREE.Mesh;
    expect(flap).toBeInstanceOf(THREE.Mesh);
    const tail = model.body.getObjectByName('fs450_bodywork_paint:body') as THREE.Mesh;
    const probeMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const probe = new THREE.Mesh(tail.geometry, probeMaterial);
    const positions = flap.geometry.getAttribute('position');
    const ray = new THREE.Raycaster();
    probe.updateMatrixWorld(true);
    for (let i = 0; i < 5; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(positions, i);
      ray.set(new THREE.Vector3(point.x, 2, point.z), new THREE.Vector3(0, -1, 0));
      const underside = Math.min(...ray.intersectObject(probe, false).map(hit => hit.point.y));
      expect(Number.isFinite(underside)).toBe(true);
      expect(point.y - underside).toBeGreaterThanOrEqual(0);
      expect(point.y - underside).toBeLessThan(0.002);
    }
    probeMaterial.dispose();
    const index = flap.geometry.getIndex()!;
    const edges = new Map<string, number>();
    for (let i = 0; i < index.count; i += 3) {
      const triangle = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      for (let j = 0; j < 3; j++) {
        const a = triangle[j], b = triangle[(j + 1) % 3];
        const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    expect([...edges.values()].every(count => count === 2)).toBe(true);
  });

  it('keeps the rubber clear of the real rear wheel through suspension travel', () => {
    const model = bike();
    const flap = model.body.getObjectByName('supermoto-mudflap') as THREE.Mesh;
    expect(flap).toBeInstanceOf(THREE.Mesh);
    const positions = flap.geometry.getAttribute('position');
    const wheel = model.wheels[1];
    const wheelRadius = model.wheelRadius / model.body.scale.x;
    for (const travel of [-0.025, 0, 0.065, 0.125]) {
      model.animateSuspension(0, travel);
      model.root.updateMatrixWorld(true);
      const center = model.body.worldToLocal(wheel.getWorldPosition(new THREE.Vector3()));
      for (let i = 0; i < positions.count; i++) {
        const point = new THREE.Vector3().fromBufferAttribute(positions, i);
        expect(Math.hypot(point.y - center.y, point.z - center.z) - wheelRadius).toBeGreaterThan(0.03);
      }
    }
  });
});
