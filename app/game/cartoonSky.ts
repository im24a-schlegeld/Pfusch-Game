import * as THREE from 'three';
import type { World, WorldLighting } from './world';
import { readWorldLighting, type WorldLightBlend } from './worldLighting';

// Two shared-buffer cloud draws, one star draw, two discs and two halo draws.
// Geometry is made once. No canvas textures, lighting, shadow passes or particles.
export const CARTOON_SKY = { clouds: 7, maxPuffs: 56, stars: 36, maxDraws: 7 } as const;
const DEPTH = 175;
const cloudLayout = [
  // x, y, size, width, height, yaw, roll, speed, puff count
  [-1.03, 0.54, 0.115, 1.12, 0.90, -0.20, -0.06, 1.03, 5],
  [-0.39, 0.82, 0.070, 1.33, 0.76, 0.30, 0.04, 0.62, 4],
  [0.67, 0.50, 0.128, 0.96, 1.04, -0.34, -0.04, 1.17, 7],
  [1.28, 0.69, 0.105, 1.18, 0.86, 0.18, 0.07, 0.79, 6],
  [-0.51, 0.48, 0.055, 1.70, 0.64, -0.11, -0.03, 0.48, 4],
  [0.04, 0.48, 0.078, 0.88, 1.11, 0.36, 0.10, 0.87, 5],
  [0.96, 0.46, 0.061, 1.45, 0.73, -0.27, -0.05, 0.57, 6],
] as const;
const puffLayout = [
  [-0.88, 0.02, 0.0, 0.66], [0, 0.06, 0.04, 0.91],
  [0.87, 0.0, -0.04, 0.64], [-0.31, 0.65, -0.10, 0.72],
  [0.57, 0.46, -0.14, 0.60], [-1.14, 0.29, -0.08, 0.43],
  [0.42, -0.05, 0.44, 0.52],
] as const;
const cloudColors: Record<WorldLighting, THREE.Color> = {
  day: new THREE.Color('#ffffff'), golden: new THREE.Color('#ffe1c2'),
  night: new THREE.Color('#526684'), dawn: new THREE.Color('#edddfa'),
};
const sunColors: Record<WorldLighting, THREE.Color> = {
  day: new THREE.Color('#fff0a5'), golden: new THREE.Color('#ffc36d'),
  night: new THREE.Color('#ffc36d'), dawn: new THREE.Color('#ffe4a8'),
};

function coloredGeometry(geometry: THREE.BufferGeometry, color: string) {
  const rgb = new THREE.Color(color);
  const colors = new Float32Array(geometry.getAttribute('position').count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = rgb.r; colors[i + 1] = rgb.g; colors[i + 2] = rgb.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function makeCloudGeometry() {
  // Eighty triangles per puff. Baked face colours provide volume without
  // adding a light or evaluating the world's lighting shader for the sky.
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  const colors = new Float32Array(normals.count * 3);
  const shades = ['#9caebd', '#c2d0db', '#e6edef', '#fffdf4'].map(color => new THREE.Color(color));
  for (let i = 0; i < normals.count; i++) {
    const light = normals.getY(i) * 0.76 + normals.getZ(i) * 0.45 - normals.getX(i) * 0.27;
    const shade = shades[light > 0.58 ? 3 : light > 0.08 ? 2 : light > -0.46 ? 1 : 0];
    colors[i * 3] = shade.r;
    colors[i * 3 + 1] = shade.g;
    colors[i * 3 + 2] = shade.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function makeCloudClusters() {
  let seed = 84621;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  return cloudLayout.map(layout => ({
    layout,
    rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.06, layout[5], layout[6])),
    puffs: puffLayout.slice(0, layout[8]).map(([x, y, z, radius]) => {
      const r = radius * (0.84 + random() * 0.3);
      return new THREE.Matrix4().compose(
        new THREE.Vector3(x + (random() - 0.5) * 0.29, y + (random() - 0.5) * 0.18, z + (random() - 0.5) * 0.24),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, random() * 0.4 - 0.2, random() * 0.14 - 0.07)),
        new THREE.Vector3(r * (0.91 + random() * 0.28), r * (0.78 + random() * 0.19), r * (0.73 + random() * 0.22)),
      );
    }),
  }));
}

function makeSunGeometry() {
  const geometry = coloredGeometry(new THREE.CircleGeometry(1, 48), '#ffe8a6');
  const white = new THREE.Color('#fffef4');
  geometry.getAttribute('color').setXYZ(0, white.r, white.g, white.b);
  return geometry;
}

function makeMoonGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0.47, 0.87);
  shape.bezierCurveTo(-0.27, 1.25, -1.02, 0.63, -1.0, -0.08);
  shape.bezierCurveTo(-0.99, -0.97, 0.17, -1.44, 0.82, -0.57);
  shape.bezierCurveTo(-0.28, -0.75, -0.57, 0.54, 0.47, 0.87);
  return coloredGeometry(new THREE.ShapeGeometry(shape, 16), '#fff5cc');
}

function makeHaloGeometry() {
  const positions = [0, 0, 0], colors = [1, 1, 1, 0.4], indices: number[] = [];
  const rings = [[0.85, 0.31], [1.6, 0.11], [2.7, 0]] as const;
  const sides = 40;
  for (const [radius, alpha] of rings) for (let i = 0; i < sides; i++) {
    const angle = i * Math.PI * 2 / sides;
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    colors.push(1, 1, 1, alpha);
  }
  for (let i = 0; i < sides; i++) indices.push(0, 1 + i, 1 + (i + 1) % sides);
  for (let ring = 1; ring < rings.length; ring++) for (let i = 0; i < sides; i++) {
    const a = 1 + (ring - 1) * sides + i, b = 1 + (ring - 1) * sides + (i + 1) % sides;
    const c = 1 + ring * sides + i, d = 1 + ring * sides + (i + 1) % sides;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  return geometry;
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

/** Mark only the authored disc perimeter. The internal triangulation remains
 * uninked, including the crescent's curved inner border. Built once. */
function discContourGeometry(source: THREE.BufferGeometry) {
  const index = source.index!;
  const positions = source.getAttribute('position');
  const vertices = Array.from({ length: positions.count }, (_, i) =>
    `${Math.round(positions.getX(i) * 100000)},${Math.round(positions.getY(i) * 100000)},${Math.round(positions.getZ(i) * 100000)}`);
  const edges = new Map<string, number>();
  const key = (a: number, b: number) => vertices[a] < vertices[b] ? `${vertices[a]}:${vertices[b]}` : `${vertices[b]}:${vertices[a]}`;
  for (let i = 0; i < index.count; i += 3)
    for (let j = 0; j < 3; j++) {
      const edge = key(index.getX(i + j), index.getX(i + (j + 1) % 3));
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  const geometry = source.toNonIndexed();
  const barycentric = new Float32Array(index.count * 3), boundary = new Float32Array(index.count * 3);
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    const flags = [edges.get(key(b, c)) === 1 ? 1 : 0, edges.get(key(c, a)) === 1 ? 1 : 0, edges.get(key(a, b)) === 1 ? 1 : 0];
    for (let j = 0; j < 3; j++) {
      barycentric[(i + j) * 3 + j] = 1;
      boundary.set(flags, (i + j) * 3);
    }
  }
  geometry.setAttribute('cartoonSkyBarycentric', new THREE.BufferAttribute(barycentric, 3));
  geometry.setAttribute('cartoonSkyBoundary', new THREE.BufferAttribute(boundary, 3));
  source.dispose();
  return geometry;
}

function applyDiscContour(material: THREE.MeshBasicMaterial, pixelRatio: { value: number }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.cartoonSkyPixelRatio = pixelRatio;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute vec3 cartoonSkyBarycentric;
      attribute vec3 cartoonSkyBoundary;
      varying vec3 vSkyBarycentric;
      varying vec3 vSkyBoundary;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vSkyBarycentric = cartoonSkyBarycentric;
      vSkyBoundary = cartoonSkyBoundary;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform float cartoonSkyPixelRatio;
      varying vec3 vSkyBarycentric;
      varying vec3 vSkyBoundary;`)
      .replace('#include <opaque_fragment>', `
      vec3 skyEdgeWidth = max(fwidth(vSkyBarycentric) * cartoonSkyPixelRatio, vec3(0.00001));
      vec3 skyEdgeInk = (1.0 - smoothstep(skyEdgeWidth * 0.2, skyEdgeWidth * 1.15, vSkyBarycentric)) * vSkyBoundary;
      float skyBorder = max(skyEdgeInk.x, max(skyEdgeInk.y, skyEdgeInk.z));
      outgoingLight = mix(outgoingLight, vec3(0.0006, 0.0009, 0.0012), skyBorder);
      #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'pfusch-sky-disc-border-v1';
}

function cloudContourMaterial(viewport: THREE.Vector2) {
  const material = skyMaterial(false);
  material.color.set('#020304');
  material.side = THREE.BackSide;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.cartoonSkyViewport = { value: viewport };
    shader.uniforms.cartoonSkyStroke = { value: 1.05 };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      uniform vec2 cartoonSkyViewport;
      uniform float cartoonSkyStroke;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
      // Puffs are unit spheres. Position normals keep duplicated coloured
      // faces smooth without modifying the original geometry or face shades.
      vec3 skyNormal = normalize(position);
      mat3 skyInstance = mat3(instanceMatrix);
      skyNormal /= vec3(dot(skyInstance[0], skyInstance[0]), dot(skyInstance[1], skyInstance[1]), dot(skyInstance[2], skyInstance[2]));
      skyNormal = normalize(normalMatrix * skyInstance * skyNormal);
      vec2 projectedNormal = (projectionMatrix * vec4(skyNormal, 0.0)).xy;
      vec2 direction = projectedNormal * cartoonSkyViewport;
      direction /= max(length(direction), 0.00001);
      gl_Position.xy += direction * smoothstep(0.025, 0.12, length(projectedNormal)) * (2.0 * cartoonSkyStroke / cartoonSkyViewport) * gl_Position.w;
      gl_Position.z += 0.00001 * gl_Position.w;`);
  };
  material.customProgramCacheKey = () => 'pfusch-sky-cloud-border-v1';
  return material;
}

/** Camera-following backdrop. Call after the ride camera has been positioned. */
export function makeCartoonSky(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
  const root = new THREE.Group();
  root.name = 'cartoon-sky';
  const cloudMaterial = skyMaterial();
  // Actual depth makes overlapping puffs one volume instead of pasted circles.
  cloudMaterial.depthWrite = true;
  const clusters = makeCloudClusters();
  const puffCount = clusters.reduce((count, cluster) => count + cluster.puffs.length, 0);
  const clouds = new THREE.InstancedMesh(makeCloudGeometry(), cloudMaterial, puffCount);
  clouds.name = 'cartoon-clouds';
  clouds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  clouds.frustumCulled = false;
  clouds.renderOrder = -100;
  const viewport = new THREE.Vector2(390, 844);
  const pixelRatio = { value: 1 };
  const cloudOutline = new THREE.InstancedMesh(clouds.geometry, cloudContourMaterial(viewport), puffCount);
  cloudOutline.name = 'cartoon-cloud-outline';
  cloudOutline.userData.cartoonSkyOutline = true;
  cloudOutline.instanceMatrix = clouds.instanceMatrix;
  cloudOutline.frustumCulled = false;
  // Coloured puffs first write their complete depth union. The outline then
  // appears only outside that volume, never between its overlapping puffs.
  cloudOutline.renderOrder = -99;
  cloudOutline.raycast = () => {};
  const sunMaterial = skyMaterial();
  applyDiscContour(sunMaterial, pixelRatio);
  const sun = new THREE.Mesh(discContourGeometry(makeSunGeometry()), sunMaterial);
  sun.name = 'cartoon-sun';
  sun.renderOrder = -101;
  const moonMaterial = skyMaterial();
  applyDiscContour(moonMaterial, pixelRatio);
  const moon = new THREE.Mesh(discContourGeometry(makeMoonGeometry()), moonMaterial);
  moon.name = 'cartoon-moon';
  moon.renderOrder = -101;
  const sunHaloMaterial = skyMaterial();
  sunHaloMaterial.color.set('#ffe5b2');
  const moonHaloMaterial = skyMaterial();
  moonHaloMaterial.color.set('#b9d7ff');
  const sunHalo = new THREE.Mesh(makeHaloGeometry(), sunHaloMaterial);
  sunHalo.name = 'cartoon-sun-halo';
  const moonHalo = new THREE.Mesh(makeHaloGeometry(), moonHaloMaterial);
  moonHalo.name = 'cartoon-moon-halo';
  sunHalo.renderOrder = moonHalo.renderOrder = -102;
  const starMaterial = skyMaterial(false);
  starMaterial.color.set('#f7efd4');
  const stars = new THREE.Mesh(makeStarsGeometry(), starMaterial);
  stars.name = 'cartoon-stars';
  stars.renderOrder = -103;
  for (const object of [sun, moon, stars, sunHalo, moonHalo]) object.frustumCulled = false;
  root.add(clouds, cloudOutline, sun, moon, stars, sunHalo, moonHalo);
  scene.add(root);
  const matrix = new THREE.Matrix4();
  const clusterMatrix = new THREE.Matrix4();
  const clusterPosition = new THREE.Vector3();
  const clusterScale = new THREE.Vector3();
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
    cloudOutline.material.opacity = outside;
    sunMaterial.color.copy(sunColors[from]).lerp(sunColors[to], blend);
    sunMaterial.opacity = (1 - night) * outside;
    moonMaterial.opacity = night * outside;
    starMaterial.opacity = night * outside * 0.88;
    sunHaloMaterial.opacity = sunMaterial.opacity;
    moonHaloMaterial.opacity = moonMaterial.opacity;
    sun.visible = sunMaterial.opacity > 0.005;
    moon.visible = moonMaterial.opacity > 0.005;
    stars.visible = starMaterial.opacity > 0.005;
    sunHalo.visible = sun.visible;
    moonHalo.visible = moon.visible;
    const drift = Math.max(0, elapsedSeconds) * 0.010;
    let puffIndex = 0;
    for (const cluster of clusters) {
      const [x, y, size, stretchX, stretchY, , , speed] = cluster.layout;
      // Wrap only once the whole silhouette is outside even a narrow phone.
      const edge = 1.15 + (size * 2.5 * stretchX) / camera.aspect;
      const slide = ((x + drift * speed + edge) % (edge * 2)) - edge;
      const scale = height * size;
      // Limit depth independently of phone FOV so no puff touches the far clip.
      clusterScale.set(scale * stretchX, scale * stretchY, Math.min(scale, 14));
      clusterPosition.set(slide * width, y * height, -DEPTH + 20);
      clusterMatrix.compose(clusterPosition, cluster.rotation, clusterScale);
      const e = clusterMatrix.elements;
      const depth = Math.hypot(e[2], e[6], e[10]);
      if (depth > 14) {
        e[2] *= 14 / depth; e[6] *= 14 / depth; e[10] *= 14 / depth;
      }
      for (const puff of cluster.puffs) {
        matrix.multiplyMatrices(clusterMatrix, puff);
        clouds.setMatrixAt(puffIndex++, matrix);
      }
    }
    clouds.instanceMatrix.needsUpdate = true;
    const sunHeight = THREE.MathUtils.lerp(from === 'golden' ? 0.2 : 0.58, to === 'golden' ? 0.2 : 0.58, blend);
    sun.position.set(width * 0.62, height * sunHeight, -DEPTH);
    sun.scale.setScalar(height * 0.095);
    moon.position.set(width * 0.63, height * 0.56, -DEPTH);
    moon.scale.setScalar(height * 0.105);
    sunHalo.position.copy(sun.position); sunHalo.position.z -= 0.3;
    moonHalo.position.copy(moon.position); moonHalo.position.z -= 0.3;
    sunHalo.scale.copy(sun.scale); moonHalo.scale.copy(moon.scale);
    stars.position.z = -DEPTH - 1;
    stars.scale.set(width, height, 1);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    const objects = [clouds, cloudOutline, sun, moon, stars, sunHalo, moonHalo];
    for (const geometry of new Set(objects.map(object => object.geometry))) geometry.dispose();
    for (const material of new Set(objects.map(object => object.material))) material.dispose();
    clouds.dispose();
    cloudOutline.dispose();
  };
  const resize = (width: number, height: number, ratio = 1) => {
    if (disposed || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    viewport.set(width, height);
    if (Number.isFinite(ratio) && ratio > 0) pixelRatio.value = ratio;
  };
  return { root, update, resize, dispose };
}
