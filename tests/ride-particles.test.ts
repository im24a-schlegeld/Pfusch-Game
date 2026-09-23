import { expect, it } from 'vitest';
import { Color, Points, Scene, ShaderMaterial, Vector3 } from 'three';
import { createRideParticles } from '../app/game/rideParticles';

it('keeps existing exhaust moving and fading after emission stops, and freezes it while inactive', () => {
  const scene = new Scene();
  const particles = createRideParticles(scene, false);
  const exhaust = new Vector3(0.2, 0.6, 0.8),
    tail = new Vector3(0, 0.03, 1);
  const advance = (active: boolean, emitting: boolean) =>
    particles.update(
      0.05,
      active,
      emitting,
      15,
      '125',
      exhaust,
      tail,
      0,
      null,
      '#dc632e',
      false,
    );
  for (let i = 0; i < 6; i++) advance(true, true);
  const points = scene.getObjectByName(
    'ride-exhaust-and-scrape-particles',
  ) as Points;
  particles.setViewport(960, 1.6);
  const shader = points.material as ShaderMaterial;
  expect(shader.uniforms.viewportHeight.value).toBe(1536);
  expect(shader.uniforms.pixelRatio.value).toBe(1.6);
  particles.setViewport(Number.NaN, 1);
  particles.setViewport(1440, 0);
  expect(shader.uniforms.viewportHeight.value).toBe(1536);
  expect(shader.uniforms.pixelRatio.value).toBe(1.6);
  const position = points.geometry.getAttribute('position'),
    opacity = points.geometry.getAttribute('particleOpacity');
  const live = Array.from({ length: opacity.count }, (_, i) => i).filter(
    (i) => opacity.getX(i) > 0,
  );
  expect(live.length).toBeGreaterThan(0);
  const newest = live.reduce((a, b) =>
    opacity.getX(a) > opacity.getX(b) ? a : b,
  );
  const initial = { z: position.getZ(newest), opacity: opacity.getX(newest) };
  advance(true, false);
  expect(position.getZ(newest)).toBeGreaterThan(initial.z);
  expect(opacity.getX(newest)).toBeLessThan(initial.opacity);
  const frozen = { position: [...position.array], opacity: [...opacity.array] };
  for (let i = 0; i < 5; i++) advance(false, false);
  expect([...position.array]).toEqual(frozen.position);
  expect([...opacity.array]).toEqual(frozen.opacity);
  for (let i = 0; i < 24; i++) advance(true, false);
  expect([...opacity.array].every((value) => value === 0)).toBe(true);
  expect(points.geometry.getAttribute('position')).toBe(position);
  particles.dispose();
  expect(
    scene.getObjectByName('ride-exhaust-and-scrape-particles'),
  ).toBeUndefined();
});

it('emits dark Scooter plastic independently of paint while retaining colored Supermoto chips and Sport sparks', () => {
  const colors = new Map<string, number[]>();
  for (const [model, kind, material] of [
    ['scooter', 2, 'plastic'],
    ['450', 2, 'plastic'],
    ['701', 1, 'metal'],
  ] as const) {
    const scene = new Scene();
    const particles = createRideParticles(scene, false);
    const anchor = new Vector3(0, 0.03, 1);
    const points = scene.getObjectByName(
      'ride-exhaust-and-scrape-particles',
    ) as Points;
    const position = points.geometry.getAttribute('position');
    for (let i = 0; i < 100; i++)
      particles.update(
        0.05,
        true,
        true,
        25,
        model,
        anchor,
        anchor,
        0.8,
        material,
        '#ff3300',
        false,
      );
    const tint = points.geometry.getAttribute('color');
    const kinds = points.geometry.getAttribute('particleKind');
    const opacity = points.geometry.getAttribute('particleOpacity');
    const chip = Array.from({ length: opacity.count }, (_, i) => i).find(
      (i) => opacity.getX(i) > 0 && kinds.getX(i) === kind,
    );
    expect(chip).toBeDefined();
    const color = [tint.getX(chip!), tint.getY(chip!), tint.getZ(chip!)];
    colors.set(model, color);
    if (model === 'scooter') {
      const expected = new Color('#101214');
      expect(color[0]).toBeCloseTo(expected.r, 5);
      expect(color[1]).toBeCloseTo(expected.g, 5);
      expect(color[2]).toBeCloseTo(expected.b, 5);
    }
    expect(points.geometry.getAttribute('position')).toBe(position);
    expect(position.count).toBe(128);
    particles.dispose();
  }
  expect(colors.get('450')![0]).toBeGreaterThan(colors.get('450')![2] * 3);
  expect(colors.get('701')![0]).toBeGreaterThan(0.9);
  expect(colors.get('701')![1]).toBeGreaterThan(0.7);
});
