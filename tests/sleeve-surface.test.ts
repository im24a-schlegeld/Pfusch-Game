import { expect, it, vi } from 'vitest';
import { Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { makeBike } from '../app/game/vehicle';
import { newPlayer } from '../app/domain/progression';
import { SLEEVE_UV_METRES } from '../app/game/sleeveSurface';
import products from '../public/catalog/products.json';
import type { Product } from '../app/domain/types';
import { installImportedBikeFixtures } from './importedBikeFixture';

installImportedBikeFixtures();
vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

it.each(['moped', '450', '701'])(
  '%s preserves the Racing print scale across both tapered sleeves',
  (bikeId) => {
    const player = newPlayer();
    player.bike = bikeId;
    player.equipped.upper = products.find(p => p.handle === 'racing-zipper')!.id;
    const bike = makeBike(player, products as Product[]);
    const sleeves = bike.rider.getObjectsByProperty('name', 'garment-sleeve') as Mesh[];
    expect(sleeves).toHaveLength(2);
    const a = new Vector3(), b = new Vector3();
    for (const sleeve of sleeves) {
      const p = sleeve.geometry.getAttribute('position');
      const uv = sleeve.geometry.getAttribute('uv');
      const sides = 24, stride = sides + 1, rings = 48, outside = sides / 2;
      expect(p.count).toBe((rings + 1) * stride);
      expect(uv.getY(rings * stride + outside)).toBe(0);
      let samples = 0;
      for (let row = 1; row <= rings; row++) {
        const i = row * stride + outside;
        const v = uv.getY(i);
        // Check the printed elbow/forearm, excluding the sewn hidden shoulder.
        if (v < 0.07 || v > 0.49) continue;
        a.fromBufferAttribute(p, i - stride);
        b.fromBufferAttribute(p, i);
        expect(a.distanceTo(b)).toBeCloseTo(
          (uv.getY(i - stride) - v) * SLEEVE_UV_METRES.along,
          3,
        );
        for (const offset of [-1, 0]) {
          a.fromBufferAttribute(p, i + offset);
          b.fromBufferAttribute(p, i + offset + 1);
          expect(a.distanceTo(b)).toBeCloseTo(
            (uv.getX(i + offset + 1) - uv.getX(i + offset)) * SLEEVE_UV_METRES.around,
            3,
          );
        }
        samples++;
      }
      expect(samples).toBeGreaterThan(12);
    }
  },
);
