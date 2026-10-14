import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';
import { CARTOON_OUTLINE_MAX_MESHES, CARTOON_CONTOUR_MAX_MESHES, CARTOON_CONTOUR_MAX_SEGMENTS, createCartoonOutline } from '../app/game/cartoonOutline';
import { installImportedBikeFixtures } from './importedBikeFixture';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new THREE.MeshStandardMaterial(),
  fabricMaterial: () => new THREE.MeshStandardMaterial(),
  sleeveMaterial: () => new THREE.MeshStandardMaterial(),
  accessoryMaterial: () => new THREE.MeshStandardMaterial(),
}));
installImportedBikeFixtures();

interface Range { source: string; start: number; count: number }
function detailContour(root: THREE.Object3D, source: THREE.Mesh) {
  const owner = root.getObjectByProperty('uuid', source.userData.cartoonContourOwner) as THREE.LineSegments;
  expect(owner, source.name).toBeInstanceOf(THREE.LineSegments);
  const ranges = owner.userData.cartoonContourRanges as Range[];
  const range = ranges.find(range => range.source === source.uuid)!;
  expect(range.count).toBeGreaterThan(0);
  const positions = owner.geometry.getAttribute('position');
  expect(positions.count).toBeLessThanOrEqual(CARTOON_CONTOUR_MAX_SEGMENTS * 2);
  const material = owner.material as THREE.ShaderMaterial;
  expect(material.depthWrite).toBe(true);
  expect(material.depthTest).toBe(true);
  return { owner, range, positions };
}

it.each(['125', 'moped', '450', '701', 'scooter'])('adds actual brake boundaries on %s without losing major forms or adding contour draws', id => {
  const bike = makeBike({ ...newPlayer(), bike: id, helmet: 'motocross' }, []);
  const sources: THREE.Mesh[] = [];
  bike.body.traverse(object => {
    if (object instanceof THREE.Mesh && (/brake_(friction_steel|steel|caliper|dark_carrier|carrier)/.test(object.name) ||
        (id === '125' && /^ciao_rim:/.test(object.name)) ||
        (id === 'moped' && /^moped_mechanics:(frontWheel|rearWheel)$/.test(object.name)))) sources.push(object);
  });
  expect(sources.length).toBe(id === '125' || id === 'moped' ? 2 : id === 'scooter' ? 4 : 5);
  const original = sources.map(source => ({ geometry: source.geometry, material: source.material }));
  const outlines = createCartoonOutline(bike.root);
  for (const [i, source] of sources.entries()) {
    const { owner, range, positions } = detailContour(bike.root, source);
    expect(source.geometry).toBe(original[i].geometry);
    expect(source.material).toBe(original[i].material);
    if (id !== '125') expect(source.children.some(child => child.userData.cartoonOutline)).toBe(false);
    const sourcePositions = source.geometry.getAttribute('position');
    const sourceVertices = new Set(Array.from({ length: sourcePositions.count }, (_, vertex) =>
      [sourcePositions.getX(vertex), sourcePositions.getY(vertex), sourcePositions.getZ(vertex)]
        .map(value => Math.round(value * 100000)).join(',')));
    const transform = new THREE.Matrix4().copy(source.matrixWorld).invert().multiply(owner.matrixWorld);
    const point = new THREE.Vector3();
    let minimumRadius = Infinity, maximumRadius = 0;
    for (let vertex = range.start; vertex < range.start + range.count; vertex++) {
      point.fromBufferAttribute(positions, vertex).applyMatrix4(transform);
      expect(sourceVertices.has(point.toArray().map(value => Math.round(value * 100000)).join(','))).toBe(true);
      minimumRadius = Math.min(minimumRadius, Math.hypot(point.y, point.z));
      maximumRadius = Math.max(maximumRadius, Math.hypot(point.y, point.z));
    }
    if (/brake_(friction_steel|steel):/.test(source.name)) {
      const radii = Array.from({ length: sourcePositions.count }, (_, vertex) =>
        Math.hypot(sourcePositions.getY(vertex), sourcePositions.getZ(vertex)));
      // Removing tiny perforation loops must keep the real inner and outer
      // rotor rings, including both discs in the Sport's front source batch.
      expect(minimumRadius).toBeCloseTo(Math.min(...radii), 5);
      expect(maximumRadius).toBeCloseTo(Math.max(...radii), 5);
    }
    bike.animateSuspension(0.4, 0.07);
    bike.animateRider({ wheelie: 0.5, steer: 0.8, handlebarSteer: 0.8, landing: 0 }, 1);
    bike.wheels.forEach(wheel => wheel.rotation.x = 1.3);
    bike.root.updateMatrixWorld(true);
    const moved = new THREE.Matrix4().copy(source.matrixWorld).invert().multiply(owner.matrixWorld);
    expect(Math.max(...moved.elements.map((value, axis) => Math.abs(value - transform.elements[axis])))).toBeLessThan(1e-10);
  }
  for (const name of ['motocross-helmet', 'motocross-peak', 'motocross-goggle-frame'])
    expect(bike.root.getObjectByName(name)!.children.some(child => child.userData.cartoonContour)).toBe(true);
  bike.body.traverse(object => {
    if (object instanceof THREE.Mesh && object.userData.bikePaintSurface)
      expect(object.children.some(child => child.userData.cartoonContour)).toBe(true);
  });
  expect(outlines.count).toBeLessThanOrEqual(CARTOON_OUTLINE_MAX_MESHES);
  expect(outlines.contourCount).toBeLessThanOrEqual(CARTOON_CONTOUR_MAX_MESHES);
  outlines.dispose();
  expect(sources.every(source => source.userData.cartoonContourOwner === undefined)).toBe(true);
});

it('adds only real Sport windshield rim edges while preserving transparent glass and clear lenses', () => {
  const bike = makeBike({ ...newPlayer(), bike: '701', helmet: 'motocross' }, []);
  const source = bike.body.getObjectByName('r6_windscreen_glass:body') as THREE.Mesh;
  const geometry = source.geometry, material = source.material as THREE.MeshStandardMaterial;
  const opacity = material.opacity;
  const outlines = createCartoonOutline(bike.root);
  const { owner, range } = detailContour(bike.root, source);
  expect(source.geometry).toBe(geometry);
  expect(source.material).toBe(material);
  expect(material.opacity).toBe(opacity);
  expect(opacity).toBe(0.58);
  expect(material.transparent).toBe(true);
  expect(source.children.some(child => child.userData.cartoonOutline)).toBe(false);
  expect(range.count).toBeLessThan(geometry.index!.count); // No triangle fan wireframe.
  // This closed thick source has 93 authored hard rim edges and no open
  // borders. Every smooth face diagonal must stay out of the glass draw.
  expect(range.count).toBe(93 * 2);
  const otherGlass = bike.body.getObjectByName('r6_clear_glass:body')!;
  expect(otherGlass.children.some(child => child.userData.cartoonOutline || child.userData.cartoonContour)).toBe(false);
  expect(otherGlass.userData.cartoonContourOwner === undefined).toBe(true);
  let sourceDisposals = 0, mergedDisposals = 0;
  geometry.addEventListener('dispose', () => sourceDisposals++);
  owner.geometry.addEventListener('dispose', () => mergedDisposals++);
  outlines.dispose(); outlines.dispose();
  expect(sourceDisposals).toBe(0);
  expect(mergedDisposals).toBe(1);
});

it('merges detail in owner coordinates without extending a shared edge cache on another moving rig', () => {
  const root = new THREE.Group(), left = new THREE.Group(), right = new THREE.Group();
  root.add(left, right);
  const geometry = new THREE.BoxGeometry(0.4, 0.3, 0.1);
  const owners = [left, right].map(parent => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    mesh.userData.importedPart = 'source_paint:fork'; mesh.userData.bikePaintSurface = true;
    mesh.position.set(0.2, -0.1, 0.3); mesh.rotation.y = 0.6; parent.add(mesh);
    return mesh;
  });
  const brake = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.05), new THREE.MeshStandardMaterial());
  brake.name = 'fs450_brake_caliper:fork'; brake.userData.importedPart = brake.name;
  brake.position.set(-0.12, 0.07, 0.18); brake.rotation.z = 0.3; left.add(brake);
  const outlines = createCartoonOutline(root);
  const { owner, range, positions } = detailContour(root, brake);
  const other = owners[1].children.find(child => child.userData.cartoonContour) as THREE.LineSegments;
  expect(owner.parent).toBe(owners[0]);
  expect(owner.geometry).not.toBe(other.geometry);
  expect(other.geometry.getAttribute('position').count).toBe(24);
  expect(range.start).toBe(24); expect(range.count).toBe(24);
  const transform = new THREE.Matrix4().copy(brake.matrixWorld).invert().multiply(owner.matrixWorld);
  const expected = brake.geometry.getAttribute('position');
  for (let vertex = range.start; vertex < range.start + range.count; vertex++) {
    const point = new THREE.Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(transform);
    expect(Array.from({ length: expected.count }, (_, i) =>
      point.distanceTo(new THREE.Vector3().fromBufferAttribute(expected, i))).some(distance => distance < 1e-7)).toBe(true);
  }
  left.rotation.set(0.7, -0.4, 0.2); right.rotation.set(-0.3, 0.8, -0.1); root.updateMatrixWorld(true);
  const moved = new THREE.Matrix4().copy(brake.matrixWorld).invert().multiply(owner.matrixWorld);
  expect(Math.max(...moved.elements.map((value, axis) => Math.abs(value - transform.elements[axis])))).toBeLessThan(1e-10);
  let sharedDisposals = 0, cloneDisposals = 0;
  geometry.addEventListener('dispose', () => sharedDisposals++);
  owner.geometry.addEventListener('dispose', () => cloneDisposals++);
  outlines.dispose(); outlines.dispose();
  expect(sharedDisposals).toBe(0); expect(cloneDisposals).toBe(1);
});

it('keeps opaque hero shell and edge fringe in depth before later transparent clouds', () => {
  const source = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.1), new THREE.MeshStandardMaterial());
  source.name = 'full-face-helmet';
  const root = new THREE.Group(); root.add(source);
  const outlines = createCartoonOutline(root);
  const shell = source.children.find(child => child.userData.cartoonOutline) as THREE.Mesh;
  const edge = source.children.find(child => child.userData.cartoonContour) as THREE.LineSegments;
  for (const material of [shell.material, edge.material] as THREE.ShaderMaterial[]) {
    expect(material.transparent).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(true);
  }
  outlines.dispose();
});
