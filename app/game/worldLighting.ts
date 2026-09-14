import * as THREE from 'three';
import type { World, WorldLighting } from './world';

const palettes = {
  day: {
    sky: '#8d999b',
    sun: '#fff5e6',
    ambient: 1.4,
    direct: 3.4,
    fill: 0.9,
    environment: 0.7,
    exposure: 1.1,
    dark: 0,
  },
  golden: {
    sky: '#9a8175',
    sun: '#ffba78',
    ambient: 1.05,
    direct: 2.8,
    fill: 0.65,
    environment: 0.5,
    exposure: 1.1,
    dark: 0.08,
  },
  night: {
    sky: '#101b2a',
    sun: '#9cb5dc',
    ambient: 0.38,
    direct: 0.25,
    fill: 0.5,
    environment: 0.23,
    exposure: 1.3,
    dark: 1,
  },
  dawn: {
    sky: '#75879a',
    sun: '#f3c6b5',
    ambient: 0.95,
    direct: 1.45,
    fill: 0.7,
    environment: 0.48,
    exposure: 1.15,
    dark: 0.2,
  },
} satisfies Record<WorldLighting, object>;
const colors = Object.fromEntries(
  Object.entries(palettes).map(([key, p]) => [
    key,
    { sky: new THREE.Color(p.sky), sun: new THREE.Color(p.sun) },
  ]),
) as Record<WorldLighting, { sky: THREE.Color; sun: THREE.Color }>;
const tunnelSky = new THREE.Color('#252d33');
const tunnelSun = new THREE.Color('#cbd5d8');

/** Distance-driven light and real tunnel acoustics share the same domain segment. */
export function makeWorldLighting(
  scene: THREE.Scene,
  renderer: Pick<THREE.WebGLRenderer, 'toneMappingExposure' | 'setClearColor'>,
  hemisphere: THREE.HemisphereLight,
  sun: THREE.DirectionalLight,
  fill: THREE.DirectionalLight,
) {
  const sky = new THREE.Color();
  const headlight = new THREE.SpotLight('#e2eced', 0, 75, 0.48, 0.7, 1.2);
  headlight.name = 'road-headlight';
  const riderLight = new THREE.PointLight('#c4d3dd', 0, 18, 1.5);
  riderLight.name = 'tunnel-rider-fill';
  scene.add(headlight, headlight.target, riderLight);
  return (world: World, distance: number, x: number) => {
    const segment = world.at(distance)!;
    const previous = world.at(Math.max(0, segment.start - 0.01));
    const from = previous?.lighting ?? segment.lighting;
    const to = segment.lighting;
    const blend = THREE.MathUtils.smoothstep(distance - segment.start, 0, 42);
    const a = palettes[from],
      b = palettes[to];
    const tunnel = world.tunnelExposure(distance);
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
    hemisphere.intensity = THREE.MathUtils.lerp(mix('ambient'), 0.42, tunnel);
    sun.intensity = THREE.MathUtils.lerp(mix('direct'), 0.08, tunnel);
    fill.intensity = THREE.MathUtils.lerp(mix('fill'), 0.85, tunnel);
    scene.environmentIntensity = THREE.MathUtils.lerp(
      mix('environment'),
      0.25,
      tunnel,
    );
    renderer.toneMappingExposure = THREE.MathUtils.lerp(
      mix('exposure'),
      1.25,
      tunnel,
    );
    const dark = Math.max(mix('dark'), tunnel);
    headlight.intensity = dark * 55;
    headlight.position.set(x, 1.25, -1);
    headlight.target.position.set(x, 0.03, -24);
    riderLight.intensity = dark * 8;
    riderLight.position.set(x - 2, 4.5, 2);
    return dark;
  };
}
