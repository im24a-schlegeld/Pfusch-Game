/** Open /scripts/loading-art.html in Vite to export the actual game assets. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { makeBike } from '../app/game/vehicle';
import { makeTraffic } from '../app/game/models';
import { World } from '../app/game/world';
import { makeWorldView } from '../app/game/worldView';
import { makeWorldLighting, DAY_SKY } from '../app/game/worldLighting';
import { preloadImportedBike } from '../app/game/importedBikeAsset';
import { policeRampPose } from '../app/game/policePursuit';
import { newPlayer } from '../app/domain/progression';
import { shadeClothingCatalog } from '../app/domain/appearanceColors';
import type { Product } from '../app/domain/types';

await preloadImportedBike('450');
// Public catalog data is served as an asset, never imported into Vite's module graph.
const catalog = await fetch('/catalog/products.json').then((response) => {
  if (!response.ok) throw new Error(`Loading artwork catalog: ${response.status}`);
  return response.json() as Promise<Product[]>;
});
const params = new URLSearchParams(location.search);
const portrait = params.has('portrait');
const trailerScene = params.get('scene') === 'trailer';
const width = portrait ? 900 : 1600;
const height = portrait ? 1600 : 900;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(width, height);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(DAY_SKY, 35, 105);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = .48;
const hemisphere = new THREE.HemisphereLight('#e3f0f2', '#343a2f', 1.4);
scene.add(hemisphere);
const key = new THREE.DirectionalLight('#fff3e5', 3);
key.position.set(-5, 8, -4); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -9, right: 9, top: 12, bottom: -9 });
key.shadow.normalBias = .03;
scene.add(key);
const rim = new THREE.DirectionalLight('#a4bcd1', .9);
rim.position.set(12, 8, -10); scene.add(rim);
const world = new World(42, { acceleration: .6, maxSpeed: 38 });
world.advance(72);
makeWorldView(scene, false).update(world, 72);
makeWorldLighting(scene, renderer, hemisphere, key, rim).update(world, 72, 0, 1);
const player = newPlayer();
Object.assign(player, { bike: '450', paint: '#7536c6', rims: '#ffffff', helmet: 'motocross', helmetColor: '#7536c6', helmetVisor: '#ffffff' });
player.equipped.upper = '10237061759305';
player.variants['10237061759305'] = '54581933375817';
const bike = makeBike(player, shadeClothingCatalog(catalog));
scene.add(bike.root);
const pitch = trailerScene ? .17 : .56;
bike.animateSuspension(pitch, 0, trailerScene ? .2 : .7);
for (let frame = 0; frame < 70; frame++) bike.animateRider({ wheelie: trailerScene ? .23 : .75, steer: trailerScene ? -.17 : 0, landing: 0, balance: .05, bikePitch: pitch, bikeRoll: 0 }, 1 / 60);
bike.root.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
const police = makeTraffic('police', 0);
scene.add(police);
const camera = new THREE.PerspectiveCamera(portrait ? 61 : 36, width / height, .05, 100);
function frameTrailerCamera(isPortrait: boolean) {
  const subject = new THREE.Box3().setFromObject(bike.root).getCenter(new THREE.Vector3());
  // The visible helmet/wheel silhouette sits below the full mesh bounds.
  subject.y -= .45;
  camera.fov = isPortrait ? 68 : 39;
  // Front-left three-quarter view, looking slightly down across the street.
  // Keep the bike vertically centred while showing asphalt below the complete
  // motorcycle and chase instead of filling the upper frame with empty sky.
  camera.position.set(isPortrait ? -5.2 : -6.1, 4.3, isPortrait ? -6.7 : -5.8);
  camera.lookAt(subject);
  camera.updateProjectionMatrix();
}
if (trailerScene) {
  // The right lane's real traffic asset retains its exact gameplay dimensions.
  // Only its front-axle ramp contact lifts the pursuing police car.
  const tow = makeTraffic('towtruck', 0);
  tow.position.set(3.5, 0, 7.5);
  scene.add(tow);
  const policeLocalZ = 7.2;
  const policePose = policeRampPose(policeLocalZ);
  police.position.set(tow.position.x, policePose.y, tow.position.z + policeLocalZ);
  police.rotation.x = policePose.pitch;
  // One unchanged adult skeleton, airborne beyond the deck's left edge.
  bike.root.position.set(.15, 1.95, 1.1);
  bike.root.rotation.y = .1;
  bike.root.rotation.z = -.06;

  // Camera-facing light halos are photographic glow, not replacement models.
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 128;
  const ctx = glowCanvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(.08, 'rgba(255,255,255,.95)');
  gradient.addColorStop(.23, 'rgba(255,255,255,.25)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  const lamp = (position: THREE.Vector3, color: string, size: number, intensity: number) => {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture, color, transparent: true, opacity: .84,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    glow.position.copy(position);
    glow.scale.setScalar(size);
    police.add(glow);
    const light = new THREE.PointLight(color, intensity, 6, 2);
    light.position.copy(position);
    police.add(light);
  };
  lamp(new THREE.Vector3(-.18, 2.06, .08), '#ff294f', 1.5, 13);
  lamp(new THREE.Vector3(.18, 2.06, .08), '#3f78ff', 1.5, 16);
  for (const side of [-1, 1])
    lamp(new THREE.Vector3(side * 2.35 * .32, .78, -2.97), '#e4f4ff', 1.05, 8);

  // The motorcycle, not the empty roadway, defines the composition. The low
  // three-quarter camera keeps the entire fixed rider rig at the image centre;
  // the chase remains behind it, with extra lateral room for portrait crops.
  frameTrailerCamera(portrait);
} else {
  police.position.set(2.8, 0, 9.1);
  for (const [x, color] of [[2.62, '#fc365a'], [2.98, '#6581ff']] as const) {
    const light = new THREE.PointLight(color, 14, 8, 2);
    light.position.set(x, 2.1, 9.1); scene.add(light);
  }
  camera.position.set(-5.4, 2.85, -5.4);
  camera.lookAt(.3, 1.55, 1.0);
}
const save = document.createElement('a');
save.textContent = 'Ladebild als WebP speichern';
save.download = `loading-${trailerScene ? 'trailer' : 'wheelie'}${portrait ? '-portrait' : ''}.webp`;
document.body.appendChild(save);
// Garment artwork textures load asynchronously. Rendering continues only in
// this authoring fixture; the shipped loading screen is one lightweight image.
// Export only after all authored garment maps have settled; static art needs no
// continuous gameplay loop. A second frame resolves browser texture uploads.
THREE.DefaultLoadingManager.onLoad = () => { void finish(); };
let finished = false;
async function finish() {
  if (finished) return;
  finished = true;
  renderer.render(scene, camera);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  renderer.render(scene, camera);
  save.href = renderer.domElement.toDataURL('image/webp', .9);
  document.body.dataset.ready = 'true';
  // Batch authoring can export both crops without creating a second WebGL
  // context or rebuilding the large native world/vehicle asset graph.
  if (trailerScene) Object.assign(window, {
    exportLoadingArt(isPortrait: boolean) {
      const w = isPortrait ? 900 : 1600, h = isPortrait ? 1600 : 900;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      frameTrailerCamera(isPortrait);
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/webp', .9);
    },
  });
}
// Cached assets may already have completed before the scene was assembled.
setTimeout(() => { void finish(); }, 2500);
