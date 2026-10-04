import { describe, expect, it } from 'vitest';
import { SUPERMOTO_MASK_BASE, supermotoLampGeometry, supermotoLampWellGeometry, supermotoProjectorGeometry } from '../app/game/supermotoHeadlight';
import type { BufferGeometry } from 'three';

function depths(geometry: BufferGeometry) {
  const p = geometry.getAttribute('position');
  return Array.from({ length: p.count }, (_, i) => p.getZ(i) -
    (SUPERMOTO_MASK_BASE[2] + (p.getY(i) - SUPERMOTO_MASK_BASE[1]) * 0.475 + p.getX(i) ** 2 * 1.65));
}

describe('recessed Supermoto headlight optics', () => {
  it('keeps real lenses and deep reflector cups behind a separate shallow glass cover', () => {
    const glass = depths(supermotoLampGeometry('glass'));
    const wall = depths(supermotoLampWellGeometry());
    const back = depths(supermotoLampGeometry('reflector'));
    const lenses = depths(supermotoProjectorGeometry('lens'));
    const cups = depths(supermotoProjectorGeometry('cup'));
    expect(Math.min(...glass)).toBeCloseTo(-0.004, 6);
    expect(Math.max(...glass)).toBeLessThan(0.002);
    expect(Math.min(...lenses)).toBeGreaterThan(Math.max(...glass) + 0.018);
    expect(Math.min(...wall)).toBeCloseTo(0.004, 6);
    expect(Math.max(...wall)).toBeCloseTo(0.060, 6);
    expect(Math.min(...back)).toBeGreaterThan(Math.max(...lenses) + 0.02);
    expect(Math.max(...cups) - Math.min(...cups)).toBeGreaterThan(0.027);
  });
});
