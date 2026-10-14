import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import catalog from '../public/catalog/products.json';
import type { Player, Product } from '../app/domain/types';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';
import { createCartoonOutline } from '../app/game/cartoonOutline';
import { installImportedBikeFixtures } from './importedBikeFixture';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new THREE.MeshStandardMaterial(),
  fabricMaterial: () => new THREE.MeshStandardMaterial(),
  sleeveMaterial: () => new THREE.MeshStandardMaterial(),
  accessoryMaterial: () => new THREE.MeshStandardMaterial(),
}));
installImportedBikeFixtures(['450', '701']);

type Triangle = [THREE.Vector2, THREE.Vector2, THREE.Vector2];
const cross = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function contains(point: THREE.Vector2, [a, b, c]: Triangle) {
  if (point.x < Math.min(a.x, b.x, c.x) || point.x > Math.max(a.x, b.x, c.x) ||
      point.y < Math.min(a.y, b.y, c.y) || point.y > Math.max(a.y, b.y, c.y)) return false;
  const signs = [cross(a, b, point), cross(b, c, point), cross(c, a, point)];
  return Math.max(...signs) <= 1e-7 || Math.min(...signs) >= -1e-7;
}
/** CPU evaluation of the actual outline vertex shader, including bone normals,
 * perspective, CSS stroke width and BackSide culling. No graphics context. */
function project(mesh: THREE.Mesh, camera: THREE.PerspectiveCamera, expanded = false) {
  const width = 390, height = 844;
  const positions = mesh.geometry.getAttribute('position');
  const normals = expanded && mesh.geometry.getAttribute('cartoonOutlineNormal') || mesh.geometry.getAttribute('normal');
  const mv = new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
  const nm = new THREE.Matrix3().getNormalMatrix(mv);
  if (mesh instanceof THREE.SkinnedMesh) mesh.skeleton.update();
  const points = Array.from({ length: positions.count }, (_, vertex) => {
    const position = mesh.getVertexPosition(vertex, new THREE.Vector3());
    const clip = new THREE.Vector4(position.x, position.y, position.z, 1).applyMatrix4(mv).applyMatrix4(camera.projectionMatrix);
    const pixel = new THREE.Vector2((clip.x / clip.w + 1) * width / 2, (clip.y / clip.w + 1) * height / 2);
    if (!expanded) return pixel;
    const normal = new THREE.Vector4(normals.getX(vertex), normals.getY(vertex), normals.getZ(vertex), 0);
    if (mesh instanceof THREE.SkinnedMesh) mesh.applyBoneTransform(vertex, normal);
    const direction = new THREE.Vector3(normal.x, normal.y, normal.z).applyMatrix3(nm).normalize();
    const projected = new THREE.Vector4(direction.x, direction.y, direction.z, 0).applyMatrix4(camera.projectionMatrix);
    const weight = THREE.MathUtils.smoothstep(Math.hypot(projected.x, projected.y), 0.025, 0.12);
    const stroke = (mesh.material as THREE.ShaderMaterial).uniforms.cartoonStroke.value as number;
    return pixel.add(new THREE.Vector2(projected.x * width, projected.y * height).normalize().multiplyScalar(weight * stroke));
  });
  const triangles: Triangle[] = [];
  const index = mesh.geometry.index;
  for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
    const triangle = [0, 1, 2].map(corner => points[index ? index.getX(i + corner) : i + corner]) as Triangle;
    if (expanded ? cross(...triangle) < 0 : cross(...triangle) > 0) triangles.push(triangle);
  }
  return { points, triangles };
}

it.each([
  { id: '450', wheelie: 0, edge: [440, 415] },
  { id: '701', wheelie: 1, edge: [410, 385] },
])('covers the real exterior T-shirt shoulder on $id at wheelie=$wheelie', ({ id, wheelie, edge }) => {
  const player: Player = { ...newPlayer(), bike: id, helmet: 'motocross' };
  player.equipped.upper = '10237099737417';
  const bike = makeBike(player, catalog as unknown as Product[]);
  const sources: THREE.Mesh[] = [], sleeves: THREE.SkinnedMesh[] = [];
  bike.rider.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    sources.push(object);
    if (object instanceof THREE.SkinnedMesh && object.name === 'garment-sleeve') sleeves.push(object);
  });
  const sleeve = sleeves[0];
  const lightingAttribute = sleeve.geometry.getAttribute('normal');
  const lightingNormals = Array.from(lightingAttribute.array);
  const positions = sleeve.geometry.getAttribute('position'), weights = sleeve.geometry.getAttribute('skinWeight');
  const uv = sleeve.geometry.getAttribute('uv'), index = sleeve.geometry.index;
  const outlines = createCartoonOutline(bike.root);
  const outlineNormals = sleeve.geometry.getAttribute('cartoonOutlineNormal');
  expect(outlineNormals).toBeInstanceOf(THREE.BufferAttribute);
  expect(outlineNormals === lightingAttribute).toBe(false);
  const seams = new Map<string, number>();
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const key = [positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)]
      .map(value => Math.round(value * 100000)).join(',');
    const duplicate = seams.get(key);
    if (duplicate === undefined) seams.set(key, vertex);
    else expect(new THREE.Vector3().fromBufferAttribute(outlineNormals, vertex)
      .distanceTo(new THREE.Vector3().fromBufferAttribute(outlineNormals, duplicate))).toBeLessThan(1e-7);
  }
  bike.animateRider({ wheelie, steer: 0, landing: 0, bikePitch: wheelie * 0.8, bikeRoll: 0 }, 1);
  bike.animateSuspension(wheelie * 0.8, 0, wheelie);
  bike.root.updateMatrixWorld(true);
  const fov = 2 * Math.atan(Math.tan(25 * Math.PI / 180) / (390 / 844)) * 180 / Math.PI;
  const camera = new THREE.PerspectiveCamera(fov, 390 / 844, 0.1, 190);
  camera.position.set(0, 4.4, 10.4); camera.lookAt(0, 1.4, -12); camera.updateMatrixWorld(true);
  const colored = sources.flatMap(source => project(source, camera).triangles);
  const shells = sources.flatMap(source => source.children.filter(child => child.userData.cartoonOutline) as THREE.Mesh[]);
  const shellTriangles = shells.flatMap(shell => project(shell, camera, true).triangles);
  const projected = project(sleeve, camera).points;
  const a = projected[edge[0]], b = projected[edge[1]];
  const outward = new THREE.Vector2(b.y - a.y, a.x - b.x).normalize();
  for (const t of [0.25, 0.5, 0.75]) {
    const point = a.clone().lerp(b, t).addScaledVector(outward, 0.35);
    // This is outside the entire colored rider: another body part cannot
    // explain its missing ink, nor can an internal cloth seam satisfy it.
    expect(colored.some(triangle => contains(point, triangle))).toBe(false);
    expect(shellTriangles.some(triangle => contains(point, triangle))).toBe(true);
  }
  expect(Array.from(sleeve.geometry.getAttribute('normal').array)).toEqual(lightingNormals);
  expect(sleeve.geometry.getAttribute('normal')).toBe(lightingAttribute);
  expect(sleeve.geometry.getAttribute('position')).toBe(positions);
  expect(sleeve.geometry.getAttribute('skinWeight')).toBe(weights);
  expect(sleeve.geometry.getAttribute('uv')).toBe(uv);
  expect(sleeve.geometry.index).toBe(index);
  expect((sleeve.children.find(child => child.userData.cartoonOutline) as THREE.SkinnedMesh).skeleton).toBe(sleeve.skeleton);
  outlines.dispose();
});
