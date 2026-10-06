/** Open /scripts/loading-art.html in Vite to export the actual game assets. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { makeBike } from '../app/game/vehicle';
import { makeTraffic } from '../app/game/models';
import { World } from '../app/game/world';
import { makeWorldView } from '../app/game/worldView';
import { makeWorldLighting, DAY_SKY } from '../app/game/worldLighting';
import { preloadImportedBike } from '../app/game/importedBikeAsset';
import { newPlayer } from '../app/domain/progression';
import { shadeClothingCatalog } from '../app/domain/appearanceColors';
import type { Product } from '../app/domain/types';
import catalog from '../public/catalog/products.json';

await preloadImportedBike('450');
const portrait = new URLSearchParams(location.search).has('portrait');
const width = portrait ? 900 : 1400;
const height = portrait ? 1600 : 1080;
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
const bike = makeBike(player, shadeClothingCatalog(catalog as Product[]));
scene.add(bike.root);
bike.animateSuspension(.56, 0, .7);
for (let frame = 0; frame < 70; frame++) bike.animateRider({ wheelie: .75, steer: 0, landing: 0, balance: .05, bikePitch: .56, bikeRoll: 0 }, 1 / 60);
bike.root.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
const police = makeTraffic('police', 0);
police.position.set(2.8, 0, 9.1); scene.add(police);
for (const [x, color] of [[2.62, '#fc365a'], [2.98, '#6581ff']] as const) {
  const light = new THREE.PointLight(color, 14, 8, 2);
  light.position.set(x, 2.1, 9.1); scene.add(light);
}
const camera = new THREE.PerspectiveCamera(portrait ? 61 : 36, width / height, .05, 100);
camera.position.set(-5.4, 2.85, -5.4);
camera.lookAt(.3, 1.55, 1.0);
const save = document.createElement('a');
save.textContent = 'Ladebild als WebP speichern'; save.download = portrait ? 'loading-wheelie-portrait.webp' : 'loading-wheelie.webp';
document.body.appendChild(save);
// Garment artwork textures load asynchronously. Rendering continues only in
// this authoring fixture; the shipped loading screen is one lightweight image.
let frames = 0;
function draw() {
  renderer.render(scene, camera);
  if (++frames < 240) requestAnimationFrame(draw);
  else { save.href = renderer.domElement.toDataURL('image/webp', .9); document.body.dataset.ready = 'true'; }
}
draw();
