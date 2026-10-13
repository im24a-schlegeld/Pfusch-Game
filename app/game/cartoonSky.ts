import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { World, WorldLighting } from './world';
import { readWorldLighting, type WorldLightBlend } from './worldLighting';

// One cloud draw, one star draw and two celestial discs, independent of quality.
// Geometry is made once. No canvas textures, lighting, shadow passes or particles.
export const CARTOON_SKY = { clouds: 7, stars: 36, maxDraws: 4 } as const;
const DEPTH = 175;
const cloudLayout = [
  [-0.88, 0.48, 0.13], [-0.26, 0.77, 0.105], [0.52, 0.38, 0.14],
  [1.22, 0.76, 0.16], [-0.46, 0.23, 0.085], [0.07, 0.46, 0.08],
  [0.97, 0.12, 0.10],
] as const;
const cloudColors: Record<WorldLighting, THREE.Color> = {
  day: new THREE.Color('#ffffff'), golden: new THREE.Color('#ffe1c2'),
  night: new THREE.Color('#526684'), dawn: new THREE.Color('#edddfa'),
};
const sunColors: Record<WorldLighting, THREE.Color> = {
  day: new THREE.Color('#fff0a5'), golden: new THREE.Color('#ffc36d'),
  night: new THREE.Color('#ffc36d'), dawn: new THREE.Color('#ffe4a8'),
};

function cloudShape() {
  const shape = new THREE.Shape();
  shape.moveTo(-1.4, -0.36);
  shape.bezierCurveTo(-2.03, -0.33, -1.98, 0.44, -1.35, 0.45);
  shape.bezierCurveTo(-1.22, 1.03, -0.46, 1.08, -0.2, 0.64);
  shape.bezierCurveTo(0.12, 1.37, 1.07, 1.03, 1.08, 0.48);
  shape.bezierCurveTo(1.89, 0.54, 2.04, -0.27, 1.31, -0.36);
  shape.bezierCurveTo(0.68, -0.49, -0.71, -0.46, -1.4, -0.36);
  return shape;
}

function cloudShade() {
  const shape = new THREE.Shape();
  shape.moveTo(-1.6, -0.04);
  shape.bezierCurveTo(-1.04, 0.03, -0.62, -0.15, -0.13, 0.03);
  shape.bezierCurveTo(0.5, 0.23, 0.97, -0.12, 1.62, 0.07);
  shape.bezierCurveTo(1.57, -0.35, 1.05, -0.34, 0.48, -0.36);
  shape.bezierCurveTo(-0.35, -0.41, -1.2, -0.33, -1.6, -0.04);
  return shape;
}

function coloredGeometry(geometry: THREE.BufferGeometry, color: string) {
  const rgb = new THREE.Color(color);
  const colors = new Float32Array(geometry.getAttribute('position').count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = rgb.r; colors[i + 1] = rgb.g; colors[i + 2] = rgb.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function merge(parts: THREE.BufferGeometry[]) {
  const merged = mergeGeometries(parts, false)!;
  for (const part of parts) part.dispose();
  return merged;
}

function outlinedShape(shape: THREE.Shape, color: string) {
  return merge([
    coloredGeometry(new THREE.ShapeGeometry(shape, 12).scale(1.045, 1.045, 1), '#233449'),
    coloredGeometry(new THREE.ShapeGeometry(shape, 12).translate(0, 0, 0.02), color),
  ]);
}

function makeCloudGeometry() {
  return merge([
    outlinedShape(cloudShape(), '#fffdf4'),
    coloredGeometry(new THREE.ShapeGeometry(cloudShade(), 9).translate(0, 0, 0.04), '#c8e2ed'),
  ]);
}

function makeSunGeometry() {
  return merge([
    coloredGeometry(new THREE.CircleGeometry(1.05, 40), '#3e4852'),
    coloredGeometry(new THREE.CircleGeometry(1, 40).translate(0, 0, 0.02), '#ffffff'),
  ]);
}

function makeMoonGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0.47, 0.87);
  shape.bezierCurveTo(-0.27, 1.25, -1.02, 0.63, -1.0, -0.08);
  shape.bezierCurveTo(-0.99, -0.97, 0.17, -1.44, 0.82, -0.57);
  shape.bezierCurveTo(-0.28, -0.75, -0.57, 0.54, 0.47, 0.87);
  return outlinedShape(shape, '#fff5cc');
}

function makeStarsGeometry() {
  const positions: number[] = [];
  for (let i = 0; i < CARTOON_SKY.stars; i++) {
    // Stable low-discrepancy positions; visual RNG never touches the game seed.
    const x = ((i * 0.61803398875) % 1) * 1.92 - 0.96;
    const y = 0.16 + ((i * 0.38196601125 + i * i * 0.071) % 1) * 0.78;
    const r = i % 5 === 0 ? 0.0075 : 0.0035;
    positions.push(
      x, y + r, 0, x - r * 0.65, y, 0, x, y - r, 0,
      x, y + r, 0, x, y - r, 0, x + r * 0.65, y, 0,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function skyMaterial(vertexColors = true) {
  return new THREE.MeshBasicMaterial({
    vertexColors, transparent: true, depthWrite: false, fog: false,
    toneMapped: false,
  });
}

/** Camera-following backdrop. Call after the ride camera has been positioned. */
export function makeCartoonSky(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
  const root = new THREE.Group();
  root.name = 'cartoon-sky';
  const cloudMaterial = skyMaterial();
  const clouds = new THREE.InstancedMesh(makeCloudGeometry(), cloudMaterial, CARTOON_SKY.clouds);
  clouds.name = 'cartoon-clouds';
  clouds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  clouds.frustumCulled = false;
  clouds.renderOrder = -100;
  const sunMaterial = skyMaterial();
  const sun = new THREE.Mesh(makeSunGeometry(), sunMaterial);
  sun.name = 'cartoon-sun';
  sun.renderOrder = -101;
  const moonMaterial = skyMaterial();
  const moon = new THREE.Mesh(makeMoonGeometry(), moonMaterial);
  moon.name = 'cartoon-moon';
  moon.renderOrder = -101;
  const starMaterial = skyMaterial(false);
  starMaterial.color.set('#f7efd4');
  const stars = new THREE.Mesh(makeStarsGeometry(), starMaterial);
  stars.name = 'cartoon-stars';
  stars.renderOrder = -102;
  for (const object of [sun, moon, stars]) object.frustumCulled = false;
  root.add(clouds, sun, moon, stars);
  scene.add(root);
  const matrix = new THREE.Matrix4();
  const sample: WorldLightBlend = { from: 'day', to: 'day', blend: 0, tunnel: 0 };
  let disposed = false;

  const update = (world: World, distance: number, elapsedSeconds = distance / 30) => {
    if (disposed) return;
    const { from, to, blend, tunnel } = readWorldLighting(world, distance, sample);
    const outside = 1 - tunnel;
    root.visible = outside > 0.005;
    if (!root.visible) return;
    root.position.copy(camera.position);
    root.quaternion.copy(camera.quaternion);
    const height = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * DEPTH;
    const width = height * camera.aspect;
    const night = THREE.MathUtils.lerp(from === 'night' ? 1 : 0, to === 'night' ? 1 : 0, blend);
    cloudMaterial.color.copy(cloudColors[from]).lerp(cloudColors[to], blend);
    cloudMaterial.opacity = outside;
    sunMaterial.color.copy(sunColors[from]).lerp(sunColors[to], blend);
    sunMaterial.opacity = (1 - night) * outside;
    moonMaterial.opacity = night * outside;
    starMaterial.opacity = night * outside * 0.88;
    sun.visible = sunMaterial.opacity > 0.005;
    moon.visible = moonMaterial.opacity > 0.005;
    stars.visible = starMaterial.opacity > 0.005;
    const drift = Math.max(0, elapsedSeconds) * 0.007;
    for (let i = 0; i < cloudLayout.length; i++) {
      const [x, y, size] = cloudLayout[i];
      // Wrap only once the whole silhouette is outside even a narrow phone.
      const edge = 1.1 + (size * 2.1) / camera.aspect;
      const slide = ((x + drift * (0.6 + i * 0.07) + edge) % (edge * 2)) - edge;
      const scale = height * size;
      matrix.makeScale(scale, scale, 1);
      matrix.setPosition(slide * width, y * height, -DEPTH + 2);
      clouds.setMatrixAt(i, matrix);
    }
    clouds.instanceMatrix.needsUpdate = true;
    const sunHeight = THREE.MathUtils.lerp(from === 'golden' ? 0.2 : 0.58, to === 'golden' ? 0.2 : 0.58, blend);
    sun.position.set(width * 0.62, height * sunHeight, -DEPTH);
    sun.scale.setScalar(height * 0.095);
    moon.position.set(width * 0.63, height * 0.56, -DEPTH);
    moon.scale.setScalar(height * 0.105);
    stars.position.z = -DEPTH - 1;
    stars.scale.set(width, height, 1);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    for (const object of [clouds, sun, moon, stars]) {
      object.geometry.dispose();
      object.material.dispose();
    }
    clouds.dispose();
  };
  return { root, update, dispose };
}
