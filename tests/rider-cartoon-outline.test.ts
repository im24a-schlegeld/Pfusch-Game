import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';
import { applyCartoonHeroStyle } from '../app/game/cartoonStyle';
import { CARTOON_OUTLINE_MAX_MESHES, CARTOON_CONTOUR_MAX_MESHES, createCartoonOutline } from '../app/game/cartoonOutline';
import { installImportedBikeFixtures } from './importedBikeFixture';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new THREE.MeshStandardMaterial(),
  fabricMaterial: () => new THREE.MeshStandardMaterial(),
  sleeveMaterial: () => new THREE.MeshStandardMaterial(),
  accessoryMaterial: () => new THREE.MeshStandardMaterial(),
}));
installImportedBikeFixtures();

it.each(['125', 'moped', '450', '701', 'scooter'])(
  'inks the real open trouser-to-ankle cuffs through riding poses on %s without adding draws or changing bones', id => {
    const bike = makeBike({ ...newPlayer(), bike: id, helmet: 'motocross' }, []);
    const legs: THREE.SkinnedMesh[] = [];
    bike.rider.traverse(object => {
      if (object instanceof THREE.SkinnedMesh && object.name === 'continuous-trouser-leg') legs.push(object);
    });
    expect(legs).toHaveLength(2);
    const original = legs.map(leg => ({
      position: leg.geometry.getAttribute('position'),
      index: leg.geometry.index,
      weights: leg.geometry.getAttribute('skinWeight'),
      skeleton: leg.skeleton,
      inverses: leg.skeleton.boneInverses.map(inverse => inverse.elements.slice()),
    }));
    applyCartoonHeroStyle(bike.root);
    const outlines = createCartoonOutline(bike.root);
    const counts = [outlines.count, outlines.contourCount];
    for (const [side, leg] of legs.entries()) {
      const edge = leg.geometry.getAttribute('cartoonGarmentEdge');
      const uv = leg.geometry.getAttribute('uv');
      const boundary = new Map<string, number>();
      const index = leg.geometry.index!;
      for (let i = 0; i < index.count; i += 3) for (let corner = 0; corner < 3; corner++) {
        const a = index.getX(i + corner), b = index.getX(i + (corner + 1) % 3);
        if (uv.getY(a) !== 0 || uv.getY(b) !== 0) continue;
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        boundary.set(key, (boundary.get(key) ?? 0) + 1);
      }
      // The supplied tube really ends here: no cap/backface can ink the
      // camera-facing part of this fabric-to-skin boundary.
      expect(boundary.size).toBe(20);
      expect([...boundary.values()].every(uses => uses === 1)).toBe(true);
      let cuffVertices = 0;
      for (let vertex = 0; vertex < uv.count; vertex++) {
        if (uv.getY(vertex) === 0) {
          cuffVertices++;
          expect(edge.getX(vertex)).toBe(0);
        } else {
          expect(edge.getX(vertex)).toBeGreaterThan(0); // No triangle or fold seam.
          if (uv.getY(vertex) === 1) expect(edge.getX(vertex)).toBe(1); // No new hip seam.
          else if (uv.getY(vertex) > 0.2) expect(edge.getX(vertex)).toBeGreaterThan(0.2);
        }
      }
      expect(cuffVertices).toBe(21);
      expect(leg.geometry.getAttribute('position')).toBe(original[side].position);
      expect(leg.geometry.index).toBe(original[side].index);
      expect(leg.geometry.getAttribute('skinWeight')).toBe(original[side].weights);
    }
    for (const motion of [
      { wheelie: 0, steer: -1, landing: 0 },
      { wheelie: 1, steer: 1, landing: 1 },
    ]) {
      bike.animateRider(motion, 1);
      bike.root.updateMatrixWorld(true);
      for (const [side, leg] of legs.entries()) {
        const shell = leg.children.find(child => child.userData.cartoonOutline) as THREE.SkinnedMesh;
        expect(shell).toBeInstanceOf(THREE.SkinnedMesh);
        expect(shell.skeleton).toBe(original[side].skeleton);
        expect(shell.geometry).toBe(leg.geometry);
        expect(leg.skeleton.boneInverses.map(inverse => inverse.elements)).toEqual(original[side].inverses);
        leg.skeleton.update();
        const cuffVertex = leg.geometry.attributes.position.count - 1;
        const sourcePoint = leg.getVertexPosition(cuffVertex, new THREE.Vector3()).applyMatrix4(leg.matrixWorld);
        const shellPoint = shell.getVertexPosition(cuffVertex, new THREE.Vector3()).applyMatrix4(shell.matrixWorld);
        expect(shellPoint.distanceTo(sourcePoint)).toBeLessThan(1e-10);
        expect(leg.geometry.getAttribute('cartoonGarmentEdge').getX(cuffVertex)).toBe(0);
      }
      expect([outlines.count, outlines.contourCount]).toEqual(counts);
    }
    expect(outlines.count).toBeLessThanOrEqual(CARTOON_OUTLINE_MAX_MESHES);
    expect(outlines.contourCount).toBeLessThanOrEqual(CARTOON_CONTOUR_MAX_MESHES);
    outlines.dispose();
  },
);
