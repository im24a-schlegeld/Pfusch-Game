import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';
import { getImportedBikeAsset } from '../app/game/importedBikeAsset';
import { hardwareComponents } from '../app/game/importedHardwareFinish';
import { RIDER_DIMENSIONS } from '../app/game/riderSkeleton';
import { IMPORTED_BIKE_WHEELBASE } from '../app/game/importedBikeDimensions';
import { installImportedBikeFixtures } from './importedBikeFixture';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new THREE.MeshStandardMaterial(), fabricMaterial: () => new THREE.MeshStandardMaterial(),
  sleeveMaterial: () => new THREE.MeshStandardMaterial(), accessoryMaterial: () => new THREE.MeshStandardMaterial(),
}));
installImportedBikeFixtures(['701']);

it('supports both actual Sport sneaker soles on the authored riding pegs through normal and wheelie poses', () => {
  const asset = getImportedBikeAsset('701');
  const part = asset.manifest.parts.find(p => p.name === 'r6_metal:body')!;
  const bars = hardwareComponents(part, asset.binary).filter(c => c.max[0] - c.min[0] > .06 &&
    c.max[0] - c.min[0] < .09 && c.min[1] > .35 && c.max[1] < .45 && c.max[1] - c.min[1] < .04 &&
    c.min[2] > .28 && c.max[2] < .36);
  expect(bars).toHaveLength(2);
  const size = IMPORTED_BIKE_WHEELBASE['701'] / Math.abs(asset.manifest.anchors.rearAxle[2] - asset.manifest.anchors.frontAxle[2]);
  const bike = makeBike({ ...newPlayer(), bike: '701' }, []);
  const shoes: THREE.Mesh[] = [];
  bike.rider.traverse(o => { if (o instanceof THREE.Mesh && o.name === 'rider-boot') shoes.push(o); });
  expect(shoes).toHaveLength(2);
  const originalGeometry = shoes.map(s => s.geometry);
  for (const motion of [{ wheelie: 0, steer: 0, landing: 0 }, { wheelie: 1, steer: -1, landing: .7 }, { wheelie: 1, steer: 1, landing: 1 }]) {
    bike.animateRider(motion, 1); bike.root.updateMatrixWorld(true);
    const pose = bike.captureRagdollPose();
    for (const [side, shoe] of shoes.entries()) {
      const origin = shoe.localToWorld(new THREE.Vector3(0, -1, .005));
      const up = new THREE.Vector3(0, 1, 0).transformDirection(shoe.matrixWorld);
      const soleHit = new THREE.Raycaster(origin, up).intersectObject(shoe)[0];
      expect(soleHit.face?.materialIndex).toBe(1); // Actual supplied sole, not its bounding box.
      const contact = bike.body.worldToLocal(soleHit.point.clone());
      const bar = bars.find(c => Math.sign(c.min[0]) === Math.sign(contact.x))!;
      expect(contact.x).toBeGreaterThan(bar.min[0] * size);
      expect(contact.x).toBeLessThan(bar.max[0] * size);
      expect(contact.z).toBeGreaterThan(bar.min[2] * size);
      expect(contact.z).toBeLessThan(bar.max[2] * size);
      expect(Math.abs(contact.y - bar.max[1] * size)).toBeLessThan(.003);
      const toe = bike.body.worldToLocal(shoe.localToWorld(new THREE.Vector3(0, 0, -.14)));
      const heel = bike.body.worldToLocal(shoe.localToWorld(new THREE.Vector3(0, 0, .14)));
      expect(Math.atan2(heel.y - toe.y, heel.z - toe.z)).toBeCloseTo(7 * Math.PI / 180, 10);
      expect(shoe.geometry).toBe(originalGeometry[side]);
      const leg = pose.limbs[side].leg;
      const ankleInShoe = shoe.worldToLocal(bike.rider.localToWorld(new THREE.Vector3(...leg.end)));
      expect(ankleInShoe.x).toBeCloseTo(0, 9);
      expect(ankleInShoe.y).toBeCloseTo(.093, 9);
      expect(ankleInShoe.z).toBeCloseTo(.060, 9);
      expect(new THREE.Vector3(...leg.start).distanceTo(new THREE.Vector3(...leg.joint))).toBeCloseTo(RIDER_DIMENSIONS.thigh, 10);
      expect(new THREE.Vector3(...leg.joint).distanceTo(new THREE.Vector3(...leg.end))).toBeCloseTo(RIDER_DIMENSIONS.shin, 10);
      // Shoe and sock stay connected to the same ankle, including the wheelie.
      shoe.geometry.computeBoundingBox();
      shoe.updateMatrix();
      expect(shoe.geometry.boundingBox!.clone().applyMatrix4(shoe.matrix).containsPoint(new THREE.Vector3(...leg.end))).toBe(true);
    }
  }
});
