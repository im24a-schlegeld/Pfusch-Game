import { describe, expect, it, vi } from 'vitest';
import { Mesh, MeshStandardMaterial } from 'three';
import { newPlayer } from '../app/domain/progression';
import { initialConfiguration, previewLoadout } from '../app/domain/preview';
import type { Product } from '../app/domain/types';
import catalog from '../public/catalog/products.json';
import { makeBike } from '../app/game/vehicle';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

const products = catalog as Product[];
const windbreaker = products.find((p) => p.handle === 'unisex-windbreaker')!;

describe('optional Windbreaker hood', () => {
  it.each(['125', '450', '701'])(
    'adds matching folded fabric without changing the rider on %s',
    (bikeId) => {
      const player = { ...newPlayer(), bike: bikeId };
      const config = initialConfiguration(player, windbreaker);
      const withoutHood = makeBike(
        previewLoadout(player, windbreaker, config), products,
      );
      const withHood = makeBike(
        previewLoadout(player, windbreaker, { ...config, hoodEnabled: true }),
        products,
      );
      expect(withoutHood.rider.getObjectByName('folded-hood')).toBeUndefined();
      const hood = withHood.rider.getObjectByName('folded-hood') as Mesh;
      const collar = withHood.rider.getObjectByName('stand-collar') as Mesh;
      expect(hood).toBeDefined();
      expect(hood.material).toBe(collar.material);
      const before = withoutHood.rider.getObjectByName('tailored-garment') as Mesh;
      const after = withHood.rider.getObjectByName('tailored-garment') as Mesh;
      expect(after.geometry.getAttribute('position').array).toEqual(
        before.geometry.getAttribute('position').array,
      );
      const helmet = withHood.rider.getObjectByName('full-face-helmet')!;
      const originalHelmet = withoutHood.rider.getObjectByName('full-face-helmet')!;
      expect(helmet.scale.toArray()).toEqual(originalHelmet.scale.toArray());
      expect(helmet.position.toArray()).toEqual(originalHelmet.position.toArray());
    },
  );
});
