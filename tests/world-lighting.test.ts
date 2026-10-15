import { expect, it } from 'vitest';
import * as THREE from 'three';
import { World, type WorldLighting, type WorldSegment } from '../app/game/world';
import { makeWorldLighting, readWorldLighting, type WorldLightBlend } from '../app/game/worldLighting';

function tunnelRoute(phase?: WorldLighting) {
  const world = new World(523, { acceleration: 0.15, maxSpeed: 35 });
  let tunnel: WorldSegment | undefined;
  for (let distance = 0; !tunnel && distance < 60000; distance += 100) {
    world.advance(distance);
    tunnel = world.segments.find(segment => segment.kind === 'tunnel' && segment.start > distance
      && (!phase || segment.lighting === phase));
  }
  if (!tunnel) throw new Error('No upcoming tunnel in the seeded route.');
  return { world, tunnel };
}

function lightingFixture() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#ffffff', 55, 158);
  const renderer = { toneMappingExposure: 1, setClearColor: (_color: THREE.Color) => {} };
  const hemisphere = new THREE.HemisphereLight(), sun = new THREE.DirectionalLight();
  const fill = new THREE.DirectionalLight();
  const lighting = makeWorldLighting(scene, renderer, hemisphere, sun, fill);
  return { scene, renderer, hemisphere, sun, fill, lighting };
}

it.each(['day', 'night'] as const)('lights the tunnel only from the real headlamps, without an extra side cone (%s)', (phase) => {
  const { world, tunnel } = tunnelRoute(phase);
  const { scene, hemisphere, fill, lighting } = lightingFixture();
  for (const lane of [-2.4, 0, 2.4]) {
    lighting.update(world, (tunnel.start + tunnel.end) / 2, lane, 1);
    const localLights: THREE.Light[] = [];
    scene.traverse(object => {
      if (object instanceof THREE.SpotLight || object instanceof THREE.PointLight) localLights.push(object);
    });
    expect(localLights).toEqual([...lighting.headlights]);
    expect(lighting.headlights[0].intensity).toBe(40);
    expect(lighting.headlights[1].intensity).toBe(0);
    expect(lighting.headlights[1].visible).toBe(false);
    // The existing broad fill keeps the rider readable without projecting a
    // separate cone onto the road, wall or ceiling beside the motorcycle.
    expect(hemisphere.intensity).toBeCloseTo(0.2);
    expect(fill.intensity).toBeCloseTo(0.24);
  }
});

it.each([1, 2] as const)('fades tunnel entry and exit without changing the active light count (%s headlights)', (count) => {
  const { world, tunnel } = tunnelRoute();
  const { scene, hemisphere, sun, fill, renderer, lighting } = lightingFixture();
  const localLights = scene.children.filter(object => object instanceof THREE.SpotLight || object instanceof THREE.PointLight);
  expect(localLights).toHaveLength(2);
  const distances = [
    tunnel.start - 0.001, tunnel.start, tunnel.start + 0.001,
    tunnel.start + 7, tunnel.start + 14,
    tunnel.end - 14, tunnel.end - 7,
    tunnel.end - 0.001, tunnel.end, tunnel.end + 0.001,
  ];
  const states = distances.map(distance => {
    world.advance(distance);
    const darkness = lighting.update(world, distance, 0, count);
    const sample: WorldLightBlend = { from: 'day', to: 'day', blend: 0, tunnel: 0 };
    expect(readWorldLighting(world, distance, sample)).toBe(sample);
    expect(sample.tunnel).toBe(world.tunnelExposure(distance));
    expect(localLights.filter(light => light.visible)).toHaveLength(count);
    expect(scene.children.filter(object => object instanceof THREE.SpotLight || object instanceof THREE.PointLight))
      .toEqual(localLights);
    return [darkness, hemisphere.intensity, sun.intensity, fill.intensity, renderer.toneMappingExposure];
  });
  for (const [before, after] of [[0, 2], [7, 9]])
    states[before].forEach((value, i) => expect(Math.abs(value - states[after][i])).toBeLessThan(0.001));
  expect(states[4][0]).toBe(1);
  expect(states[5][0]).toBe(1);
});
