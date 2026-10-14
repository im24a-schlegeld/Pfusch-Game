import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';
import { RIDER_DIMENSIONS } from '../app/game/riderSkeleton';
import { installImportedBikeFixtures } from './importedBikeFixture';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new THREE.MeshStandardMaterial(),
  fabricMaterial: () => new THREE.MeshStandardMaterial(),
  sleeveMaterial: () => new THREE.MeshStandardMaterial(),
  accessoryMaterial: () => new THREE.MeshStandardMaterial(),
}));
installImportedBikeFixtures();

function meshes(root: THREE.Object3D, name: string) {
  const result: THREE.Mesh[] = [];
  root.traverse(object => {
    if (object instanceof THREE.Mesh && object.name === name) result.push(object);
  });
  return result;
}

function cuffCenter(leg: THREE.Mesh, posed = false) {
  const positions = leg.geometry.getAttribute('position'), uv = leg.geometry.getAttribute('uv');
  const center = new THREE.Vector3();
  let count = 0;
  for (let i = 0; i < positions.count; i++) {
    // Ignore the duplicated circumference seam when averaging the cuff ring.
    if (uv.getY(i) > 0.00001 || uv.getX(i) > 0.99999) continue;
    const point = new THREE.Vector3().fromBufferAttribute(positions, i);
    if (posed && leg instanceof THREE.SkinnedMesh) leg.applyBoneTransform(i, point);
    center.add(point);
    count++;
  }
  return center.divideScalar(count);
}

it.each(['125', 'moped', '450', '701', 'scooter'])(
  'shows connected black socks below the trouser cuff on %s without changing adult bones', id => {
    const bike = makeBike({ ...newPlayer(), bike: id }, []);
    const ankles = meshes(bike.rider, 'rider-ankle');
    const trousers = meshes(bike.rider, 'continuous-trouser-leg');
    const shoes = meshes(bike.rider, 'rider-boot');
    expect(ankles).toHaveLength(2);
    expect(trousers).toHaveLength(2);
    expect(shoes).toHaveLength(2);
    const pose = bike.captureRagdollPose();
    pose.limbs.forEach(({ leg }, side) => {
      const joint = new THREE.Vector3(...leg.joint), end = new THREE.Vector3(...leg.end);
      const direction = joint.clone().sub(end).normalize();
      expect(joint.distanceTo(new THREE.Vector3(...leg.start))).toBeCloseTo(RIDER_DIMENSIONS.thigh, 10);
      expect(joint.distanceTo(end)).toBeCloseTo(RIDER_DIMENSIONS.shin, 10);
      expect(cuffCenter(trousers[side]).distanceTo(end)).toBeCloseTo(0.075, 5);
      const ankle = ankles[side] as THREE.SkinnedMesh;
      expect(ankle).toBeInstanceOf(THREE.SkinnedMesh);
      expect(ankle.skeleton).toBe((trousers[side] as THREE.SkinnedMesh).skeleton);
      const material = ankle.material as THREE.MeshStandardMaterial;
      expect(material.color.getHexString()).toBe('141c20');
      expect(material.userData.appearanceColorSlot).toBeUndefined();
      const positions = ankle.geometry.getAttribute('position');
      const weights = ankle.geometry.getAttribute('skinWeight');
      let top = -Infinity, bottom = Infinity;
      for (let i = 0; i < positions.count; i++) {
        const along = new THREE.Vector3().fromBufferAttribute(positions, i).sub(end).dot(direction);
        top = Math.max(top, along); bottom = Math.min(bottom, along);
        expect(weights.getX(i)).toBe(0);
        expect(weights.getY(i)).toBe(1);
      }
      expect(top).toBeCloseTo(0.083, 5); // 8 mm hidden inside the fabric cuff.
      expect(bottom).toBeCloseTo(-0.012, 5); // Sock seats inside the shoe collar.
      const shoe = shoes[side];
      shoe.geometry.computeBoundingBox();
      shoe.updateMatrix();
      const collar = shoe.geometry.boundingBox!.clone().applyMatrix4(shoe.matrix);
      expect(collar.containsPoint(end.clone().addScaledVector(direction, bottom))).toBe(true);
      // Measure the actual shoe surface along this shin. The shoe's global
      // highest tongue belongs to another point, especially with high pegs.
      const collarProbeMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
      const collarProbe = new THREE.Mesh(shoe.geometry, collarProbeMaterial);
      collarProbe.position.copy(shoe.position); collarProbe.quaternion.copy(shoe.quaternion); collarProbe.updateMatrixWorld(true);
      const hits = new THREE.Raycaster(end, direction).intersectObject(collarProbe);
      const collarAlongShin = Math.max(0, ...hits.map(hit => hit.distance));
      expect(0.075 - collarAlongShin).toBeGreaterThan(0.015);
      collarProbeMaterial.dispose();
    });
    const ankleGeometry = ankles.map(mesh => mesh.geometry);
    for (const motion of [
      { wheelie: 1, steer: 1, landing: 1 },
      { wheelie: 0, steer: -1, landing: 0, launch: 1 },
    ]) {
      bike.animateRider(motion, 1);
      bike.root.updateMatrixWorld(true);
      const moved = bike.captureRagdollPose();
      moved.limbs.forEach(({ leg }, side) => {
        expect(new THREE.Vector3(...leg.joint).distanceTo(new THREE.Vector3(...leg.end)))
          .toBeCloseTo(RIDER_DIMENSIONS.shin, 10);
        const ankle = ankles[side] as THREE.SkinnedMesh;
        ankle.skeleton.update();
        expect(cuffCenter(ankle, true).distanceTo(new THREE.Vector3(...leg.end)))
          .toBeCloseTo(0.012, 5);
        expect(ankle.geometry).toBe(ankleGeometry[side]);
      });
    }
  },
);
