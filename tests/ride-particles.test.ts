import { expect, it } from 'vitest';
import { Points, Scene, Vector3 } from 'three';
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
