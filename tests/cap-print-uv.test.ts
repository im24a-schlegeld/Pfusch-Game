import { describe, expect, it, vi } from 'vitest';
import { MeshStandardMaterial } from 'three';
import { createCarriedCap } from '../app/game/carriedCap';
import { newPlayer } from '../app/domain/progression';
import type { Product } from '../app/domain/types';
import catalog from '../public/catalog/products.json';
import { CAP_PRINTS } from '../app/game/capPrints';
vi.mock('../app/game/garmentTexture', () => ({ accessoryMaterial: () => new MeshStandardMaterial() }));

describe('continuous cap embroidery UVs', () => {
  it.each(['p-zero-cap', 'logo-cap-1'])('%s keeps its complete rear embroidery above the adjustment opening', handle => {
    const print = CAP_PRINTS[handle][0];
    const lowestPoint = .144 * (1 - (print.y + print.height / 2) / 1024);
    expect(lowestPoint).toBeGreaterThan(.072);
  });
  it('does not smear front or rear artwork across the cylindrical seam', () => {
    const product = (catalog as Product[]).find(item => item.handle === 'p-zero-cap')!;
    const cap = createCarriedCap(product, newPlayer(), '#111111');
    const uv = cap.geometry.getAttribute('uv'), indices = cap.geometry.getIndex();
    for (const group of cap.geometry.groups.filter(item => item.materialIndex === 0)) {
      for (let i = group.start; i < group.start + group.count; i += 3) {
        const values = [0, 1, 2].map(offset => uv.getX(indices ? indices.getX(i + offset) : i + offset));
        const height = cap.geometry.getAttribute('position');
        const ys = [0, 1, 2].map(offset => height.getY(indices ? indices.getX(i + offset) : i + offset));
        if (Math.min(...ys) > .105) continue; // The top pole has no embroidery.
        expect(Math.max(...values) - Math.min(...values), JSON.stringify(ys)).toBeLessThanOrEqual(.5);
      }
    }
  });
});
