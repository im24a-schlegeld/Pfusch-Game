import { expect, it, vi } from 'vitest';
import { Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { makeBike } from '../app/game/vehicle';
import { newPlayer } from '../app/domain/progression';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

it('keeps the Sport waistband beneath the leaning shirt through rider motion', () => {
  const player = newPlayer();
  player.bike = '701';
  const bike = makeBike(player, []);
  const waist = bike.rider.getObjectByName('continuous-trouser-seat') as Mesh;
  const shirt = bike.rider.getObjectByName('tailored-garment') as Mesh;
  const surface = new Mesh(shirt.geometry, shirt.material);
  surface.updateMatrixWorld(true);
  const position = waist.geometry.getAttribute('position');
  const point = new Vector3(),
    ray = new Raycaster();
  for (const motion of [
    { wheelie: 0, forward: 0 },
    { wheelie: 0, forward: 1 },
    { wheelie: 1, forward: 0, steer: 0.7 },
  ]) {
    bike.animateRider({ steer: 0, landing: 0, ...motion }, 1);
    bike.root.updateMatrixWorld(true);
    let covered = 0;
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(waist.matrixWorld);
      shirt.worldToLocal(point);
      if (point.y < 0.005 || point.z < 0 || Math.abs(point.x) > 0.16) continue;
      ray.set(new Vector3(point.x, point.y, 0.8), new Vector3(0, 0, -1));
      const hit = ray.intersectObject(surface)[0];
      expect(hit).toBeDefined();
      expect(point.z).toBeLessThan(hit.point.z - 0.002);
      covered++;
    }
    expect(covered).toBeGreaterThan(20);
  }
});
