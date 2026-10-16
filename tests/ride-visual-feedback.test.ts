import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Scene } from 'three';
import { createWheelieLoadUp, speedEdgeIntensity } from '../app/game/rideVisualFeedback';
import { createSpeedEdges } from '../app/game/speedEdges';

describe('presentation-only grounded wheelie load', () => {
  const rest = { height: 0, velocityY: 0, pitch: 0, onTowTruck: false };
  it('compresses for a fresh lift, expires while held, and retriggers only after both wheels return', () => {
    const load = createWheelieLoadUp();
    expect(load.update(rest, 0, true, false, 1 / 60)).toBe(0);
    expect(load.update(rest, 0.025, true, false, 1 / 60)).toBe(1);
    let pulse = 1;
    for (let frame = 0; frame < 30; frame++)
      pulse = load.update({ ...rest, pitch: 0.6 }, 0.6, true, false, 1 / 60);
    expect(pulse).toBe(0);
    expect(load.update({ ...rest, pitch: 0.2 }, 0.25, true, false, 1 / 60)).toBe(0);
    expect(load.update(rest, 0.018, true, false, 1 / 60)).toBe(1);
  });
  it.each([
    { ...rest, height: 0.1 }, { ...rest, velocityY: 1 },
    { ...rest, pitch: 0.12 }, { ...rest, onTowTruck: true },
  ])('does not start from an airborne, already lifted or ramp pose: %j', (before) => {
    expect(createWheelieLoadUp().update(before, 0.2, true, false, 1 / 60)).toBe(0);
  });
  it('suppresses and clears on pause or reduced motion', () => {
    const load = createWheelieLoadUp();
    expect(load.update(rest, 0.01, true, false, 1 / 60)).toBe(1);
    expect(load.update({ ...rest, pitch: 0.1 }, 0.12, false, false, 0)).toBe(0);
    expect(load.update({ ...rest, pitch: 0.1 }, 0.12, true, false, 1 / 60)).toBe(0);
    expect(load.update(rest, 0.02, true, true, 1 / 60)).toBe(0);
  });
});

describe('bounded speed edges', () => {
  it('only fades in at faster riding and respects active/reduced-motion gates', () => {
    expect(speedEdgeIntensity(22, true, false)).toBe(0);
    expect(speedEdgeIntensity(27, true, false)).toBe(0);
    expect(speedEdgeIntensity(32, true, false)).toBeGreaterThan(0);
    expect(speedEdgeIntensity(45, true, false)).toBeGreaterThan(speedEdgeIntensity(32, true, false));
    expect(speedEdgeIntensity(100, true, false)).toBeLessThanOrEqual(1);
    expect(speedEdgeIntensity(100, false, false)).toBe(0);
    expect(speedEdgeIntensity(100, true, true)).toBe(0);
  });
  it.each([390 / 844, 320 / 568, 844 / 390])('keeps all streak vertices outside the clear central view at aspect %s', (aspect) => {
    const scene = new Scene(), camera = new PerspectiveCamera(70, aspect, 0.1, 190);
    scene.add(camera);
    const edges = createSpeedEdges(camera);
    const geometry = edges.mesh.geometry, material = edges.mesh.material;
    for (let frame = 0; frame < 100; frame++) edges.update(1 / 60, 46, true, false);
    const positions = geometry.getAttribute('position');
    const halfWidth = Math.tan(70 * Math.PI / 360) * aspect;
    expect(positions.count).toBe(72);
    for (let vertex = 0; vertex < positions.count; vertex++) {
      expect(Math.abs(positions.getX(vertex)) / halfWidth).toBeGreaterThanOrEqual(0.73);
      expect(Math.abs(positions.getX(vertex)) / halfWidth).toBeLessThanOrEqual(1.12);
    }
    expect(edges.mesh.geometry).toBe(geometry);
    expect(edges.mesh.material).toBe(material);
    expect(edges.mesh.visible).toBe(true);
    edges.update(1 / 60, 46, false, false);
    expect(edges.mesh.visible).toBe(false);
    edges.dispose();
    expect(camera.children).not.toContain(edges.mesh);
  });
});
