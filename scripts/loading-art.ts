/** Authoring only: one actual game scene exports both static loading crops. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { makeBike } from '../app/game/vehicle';
import { makeTraffic } from '../app/game/models';
import { World } from '../app/game/world';
import { makeWorldView } from '../app/game/worldView';
import { makeWorldLighting, DAY_SKY } from '../app/game/worldLighting';
import { makeCartoonSky } from '../app/game/cartoonSky';
import { applyCartoonHeroStyle, applyCartoonStyle } from '../app/game/cartoonStyle';
import { createCartoonOutline } from '../app/game/cartoonOutline';
import { preloadImportedBike } from '../app/game/importedBikeAsset';
import { policeRampPose } from '../app/game/policePursuit';
import { newPlayer } from '../app/domain/progression';
import { shadeClothingCatalog } from '../app/domain/appearanceColors';
import type { Product } from '../app/domain/types';

let seed = 42976;
Math.random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
await preloadImportedBike('450');
const catalog = await fetch('/catalog/products.json').then((response) => {
  if (!response.ok) throw new Error('Loading artwork catalog: ' + response.status);
  return response.json() as Promise<Product[]>;
});
let pendingTextures = 0;
const failedTextures: string[] = [];
// Garment artwork intentionally uses raw Image/CanvasTexture promises rather
// than THREE's manager. Observe those only in this authoring page as well.
const authoredImages = new Set<HTMLImageElement>();
const NativeImage = window.Image;
window.Image = class extends NativeImage {
  constructor(width?: number, height?: number) {
    super(width, height);
    authoredImages.add(this);
    this.addEventListener('error', () => failedTextures.push(this.src), { once: true });
  }
};
THREE.DefaultLoadingManager.onStart = (_, loaded, total) => { pendingTextures = total - loaded; };
THREE.DefaultLoadingManager.onProgress = (_, loaded, total) => { pendingTextures = total - loaded; };
THREE.DefaultLoadingManager.onLoad = () => { pendingTextures = 0; };
THREE.DefaultLoadingManager.onError = (url) => { failedTextures.push(url); };

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.LinearToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.userData.visualStyle = 'cartoon';
scene.fog = new THREE.Fog(DAY_SKY, 55, 158);
const pmrem = new THREE.PMREMGenerator(renderer);
const environment = new RoomEnvironment();
scene.environment = pmrem.fromScene(environment, 0.04).texture;
pmrem.dispose();
environment.dispose();
const hemisphere = new THREE.HemisphereLight('#e3f0f2', '#343a2f', 1.4);
const sunlight = new THREE.DirectionalLight('#fff5e6', 3.4);
sunlight.position.set(-3, 7, 4);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(1024, 1024);
Object.assign(sunlight.shadow.camera, { left: -9, right: 12, top: 12, bottom: -9, far: 40 });
sunlight.shadow.normalBias = 0.015;
sunlight.shadow.bias = -0.00015;
const fill = new THREE.DirectionalLight('#a4bcd1', 0.9);
fill.position.set(12, 8, -10);
scene.add(hemisphere, sunlight, fill);
const world = new World(42, { acceleration: 0.6, maxSpeed: 38 });
world.advance(72);
makeWorldView(scene, false).update(world, 72);
makeWorldLighting(scene, renderer, hemisphere, sunlight, fill).update(world, 72, 0, 1);

const player = newPlayer();
Object.assign(player, { bike: '450', paint: '#7536c6', rims: '#ffffff', helmet: 'motocross', helmetColor: '#7536c6', helmetVisor: '#ffffff' });
player.equipped.upper = '10237061759305';
player.variants['10237061759305'] = '54581933375817';
const bike = makeBike(player, shadeClothingCatalog(catalog));
const pitch = 0.2;
bike.animateSuspension(pitch, 0, 0.3);
for (let frame = 0; frame < 70; frame++)
  bike.animateRider({ wheelie: 0.3, steer: -0.08, landing: 0, balance: 0.05, bikePitch: pitch, bikeRoll: 0 }, 1 / 60);
bike.root.position.set(0.15, 1.9, 1.1);
bike.root.rotation.y = 0.1;
bike.root.rotation.z = -0.04;
applyCartoonHeroStyle(bike.root);
const outline = createCartoonOutline(bike.root);
scene.add(bike.root);
const tow = makeTraffic('towtruck', 0);
tow.position.set(3.5, 0, 7.5);
const police = makeTraffic('police', 0);
const policePose = policeRampPose(7.2);
police.position.set(tow.position.x, policePose.y, tow.position.z + 7.2);
police.rotation.x = policePose.pitch;
applyCartoonStyle(tow);
applyCartoonStyle(police);
scene.add(tow, police);

// The actual optical lightbar gets one static halo per colour in this artwork.
const glowCanvas = document.createElement('canvas');
glowCanvas.width = glowCanvas.height = 128;
const context = glowCanvas.getContext('2d')!;
const glow = context.createRadialGradient(64, 64, 0, 64, 64, 64);
glow.addColorStop(0, '#ffffff');
glow.addColorStop(0.1, '#ffffffd9');
glow.addColorStop(0.25, '#ffffff40');
glow.addColorStop(1, '#ffffff00');
context.fillStyle = glow;
context.fillRect(0, 0, 128, 128);
const glowTexture = new THREE.CanvasTexture(glowCanvas);
for (const [x, color] of [[-0.18, '#ff294f'], [0.18, '#3f78ff']] as const) {
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color, transparent: true,
    opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  halo.position.set(x, 2.06, 0.08);
  halo.scale.setScalar(1.35);
  police.add(halo);
}

const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 240);
const sky = makeCartoonSky(scene, camera);

function frame(isPortrait: boolean) {
  const width = isPortrait ? 900 : 1600, height = isPortrait ? 1600 : 900;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.fov = isPortrait ? 58 : 40;
  camera.updateProjectionMatrix();
  bike.root.updateMatrixWorld(true);
  bike.root.traverse(object => { if (object instanceof THREE.SkinnedMesh) object.skeleton.update(); });
  const box = new THREE.Box3().setFromObject(bike.root, true);
  const center = box.getCenter(new THREE.Vector3());
  const direction = new THREE.Vector3(-1, 0.52, -1).normalize();
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y])
    for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  // Centre the full current rider/bike and leave actual street below it, with
  // clear space for the independently rendered brand and safe-area caption.
  let distance = 5;
  let bounds = [-1, -1, 1, 1];
  const verticalLimit = isPortrait ? 0.44 : 0.58;
  for (let attempt = 0; attempt < 40; attempt++, distance *= 1.06) {
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.lookAt(center);
    camera.updateMatrixWorld(true);
    const projected = corners.map(corner => corner.clone().project(camera));
    bounds = [Math.min(...projected.map(p => p.x)), Math.min(...projected.map(p => p.y)),
      Math.max(...projected.map(p => p.x)), Math.max(...projected.map(p => p.y))];
    if (bounds[0] >= -0.76 && bounds[2] <= 0.76 && bounds[1] >= -verticalLimit && bounds[3] <= verticalLimit) break;
  }
  outline.update(width, height);
  sky.resize(width, height, 1);
  sky.update(world, 72, 9.5);
  renderer.render(scene, camera);
  return { width, height, bounds, cartoon: scene.userData.visualStyle, outlines: outline.count,
    ankle: Boolean(bike.rider.getObjectByName('rider-ankle')), street: Boolean(scene.getObjectByName('streamed-world')),
    authoredImages: authoredImages.size };
}

// Texture completion is required, including supplied garment art. An arbitrary
// timer must not export a previous/blank outfit on a slower CI renderer.
const deadline = performance.now() + 60000;
let stable = 0, previous = '';
while (stable < 3) {
  if (performance.now() > deadline) throw new Error('Loading artwork textures did not settle.');
  await new Promise(resolve => setTimeout(resolve, 30));
  await document.fonts.ready;
  if (pendingTextures > 0 || [...authoredImages].some(image => !image.complete)) { stable = 0; continue; }
  const versions: string[] = [];
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) versions.push(value.uuid + ':' + value.version + ':' + value.source.version);
  });
  const current = versions.join('|');
  stable = current === previous ? stable + 1 : 0;
  previous = current;
}
if (failedTextures.length) throw new Error('Loading artwork textures failed: ' + failedTextures.join(', '));
frame(false);
await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
Object.assign(window, {
  exportLoadingArt(isPortrait: boolean) {
    const proof = frame(isPortrait);
    return { webp: renderer.domElement.toDataURL('image/webp', 0.91), png: renderer.domElement.toDataURL('image/png'), proof };
  },
});
document.body.dataset.ready = 'true';
