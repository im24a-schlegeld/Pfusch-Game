import * as THREE from 'three';
import type { World, WorldLighting } from './world';

export const DAY_SKY = '#7ecdf4';

const palettes = {
  day: {
    sky: DAY_SKY,
    sun: '#fff3d4',
    ambient: 1.55,
    direct: 1.8,
    fill: 0.8,
    environment: 0.38,
    exposure: 1.05,
    dark: 0,
  },
  golden: {
    sky: '#efad88',
    sun: '#ffd89b',
    ambient: 1.25,
    direct: 1.65,
    fill: 0.75,
    environment: 0.3,
    exposure: 1.05,
    dark: 0.08,
  },
  night: {
    sky: '#203452',
    sun: '#b9d4fa',
    ambient: 0.62,
    direct: 0.55,
    fill: 0.65,
    environment: 0.2,
    exposure: 1.15,
    dark: 1,
  },
  dawn: {
    sky: '#a8bde3',
    sun: '#ffe4c8',
    ambient: 1.3,
    direct: 1.4,
    fill: 0.8,
    environment: 0.32,
    exposure: 1.08,
    dark: 0.2,
  },
} satisfies Record<WorldLighting, object>;
const colors = Object.fromEntries(
  Object.entries(palettes).map(([key, p]) => [
    key,
    { sky: new THREE.Color(p.sky), sun: new THREE.Color(p.sun) },
  ]),
) as Record<WorldLighting, { sky: THREE.Color; sun: THREE.Color }>;
const tunnelSky = new THREE.Color('#101720');
const tunnelSun = new THREE.Color('#cbd5d8');

export interface WorldLightBlend {
  from: WorldLighting;
  to: WorldLighting;
  blend: number;
  tunnel: number;
}

/** Reuse the supplied sample so the sky and lighting share one allocation-free fade. */
export function readWorldLighting(world: World, distance: number, target: WorldLightBlend) {
  const segment = world.at(distance);
  const previous = segment && world.at(Math.max(0, segment.start - 0.01));
  target.to = segment?.lighting ?? 'day';
  target.from = previous?.lighting ?? target.to;
  target.blend = segment ? THREE.MathUtils.smoothstep(distance - segment.start, 0, 42) : 1;
  target.tunnel = world.tunnelExposure(distance);
  return target;
}

/** Distance-driven light and real tunnel acoustics share the same domain segment. */
export function makeWorldLighting(
  scene: THREE.Scene,
  renderer: Pick<THREE.WebGLRenderer, 'toneMappingExposure' | 'setClearColor'>,
  hemisphere: THREE.HemisphereLight,
  sun: THREE.DirectionalLight,
  fill: THREE.DirectionalLight,
) {
  const sky = new THREE.Color();
  const sample: WorldLightBlend = { from: 'day', to: 'day', blend: 0, tunnel: 0 };
  // Keep the authored optical cone narrow, but leave enough bright core to
  // cover the near road. A 70% fringe made that footprint almost disappear.
  const headlights = [
    new THREE.SpotLight('#e2eced', 0, 75, 0.48, 0.35, 1.2),
    new THREE.SpotLight('#e2eced', 0, 75, 0.48, 0.35, 1.2),
  ] as const;
  headlights[0].name = 'road-headlight';
  headlights[1].name = 'road-headlight-secondary';
  for (const headlight of headlights) {
    headlight.visible = false;
    scene.add(headlight, headlight.target);
  }
  // Only the motorcycle's optical faces project local light. The existing
  // hemisphere and directional fill keep the rider readable without an
  // artificial side cone on the tunnel wall or the road beside the bike.
  const update = (
    world: World,
    distance: number,
    _x: number,
    headlightCount: 1 | 2,
  ) => {
    const { from, to, blend, tunnel } = readWorldLighting(world, distance, sample);
    const a = palettes[from],
      b = palettes[to];
    const mix = (
      key: 'ambient' | 'direct' | 'fill' | 'environment' | 'exposure' | 'dark',
    ) => THREE.MathUtils.lerp(a[key], b[key], blend);
    sky
      .copy(colors[from].sky)
      .lerp(colors[to].sky, blend)
      .lerp(tunnelSky, tunnel);
    renderer.setClearColor(sky);
    if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(sky);
    sun.color
      .copy(colors[from].sun)
      .lerp(colors[to].sun, blend)
      .lerp(tunnelSun, tunnel);
    hemisphere.intensity = THREE.MathUtils.lerp(mix('ambient'), 0.2, tunnel);
    sun.intensity = THREE.MathUtils.lerp(mix('direct'), 0.035, tunnel);
    fill.intensity = THREE.MathUtils.lerp(mix('fill'), 0.24, tunnel);
    scene.environmentIntensity = THREE.MathUtils.lerp(
      mix('environment'),
      0.1,
      tunnel,
    );
    renderer.toneMappingExposure = THREE.MathUtils.lerp(
      mix('exposure'),
      1.05,
      tunnel,
    );
    const dark = Math.max(mix('dark'), tunnel);
    for (let i = 0; i < headlights.length; i++) {
      const active = i < headlightCount;
      // Keep the light count stable so entering a tunnel does not recompile
      // every lit material. Daylight switches intensity off, not the light.
      headlights[i].visible = active;
      headlights[i].intensity = active ? (dark * 55) / headlightCount : 0;
    }
    return dark;
  };
  return { headlights, update };
}
