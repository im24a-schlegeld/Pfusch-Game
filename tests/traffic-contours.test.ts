import { expect, it } from 'vitest';
import * as THREE from 'three';
import { makeTraffic, makeTrafficVariants } from '../app/game/models';
import { animateTraffic } from '../app/game/trafficModels';
import { applyCartoonStyle } from '../app/game/cartoonStyle';
import { TOW_RAMP, towRampHeight } from '../app/game/trafficDomain';

function contours(root: THREE.Object3D) {
  const lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>[] = [];
  root.traverse(object => {
    if (object instanceof THREE.LineSegments && object.userData.cartoonTrafficContour) lines.push(object);
  });
  return lines;
}

function segments(line: THREE.LineSegments) {
  const positions = line.geometry.getAttribute('position');
  return Array.from({ length: positions.count / 2 }, (_, i) => [
    new THREE.Vector3().fromBufferAttribute(positions, i * 2),
    new THREE.Vector3().fromBufferAttribute(positions, i * 2 + 1),
  ] as const);
}

it.each(['car', 'police', 'towtruck', 'van', 'construction'])(
  'gives %s one bounded black contour in the shared loading/game model', kind => {
    const model = makeTraffic(kind, 0);
    applyCartoonStyle(model);
    const lines = contours(model);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.geometry.attributes.position.count).toBeGreaterThan(24);
    expect(line.geometry.attributes.position.count).toBeLessThanOrEqual(2048);
    expect([...line.geometry.attributes.position.array].every(Number.isFinite)).toBe(true);
    expect(line.material.color.getHexString()).toBe('080a0e');
    expect(line.material.fog).toBe(true);
    expect(line.material.depthTest).toBe(true);
    expect(line.material.depthWrite).toBe(false);
    expect(line.material.toneMapped).toBe(false);
    const shader = { vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
      uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.basic.uniforms) };
    line.material.onBeforeCompile(shader as Parameters<THREE.Material['onBeforeCompile']>[0], {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('gl_Position.z -= 0.00001 * gl_Position.w');
    expect(shader.vertexShader).toContain('#include <fog_vertex>');
    expect(shader.fragmentShader).toContain('#include <fog_fragment>');
    expect(line.renderOrder).toBe(1);
    expect(line.castShadow).toBe(false);
    expect(line.userData.cartoonOutline).toBeUndefined();
  },
);

it('inks the real tow ramp side edges and leaves the flat tray free of triangle diagonals', () => {
  const line = contours(makeTraffic('towtruck', 0))[0];
  expect(line).toBeDefined();
  const edges = segments(line);
  for (const side of [-1, 1]) {
    expect(edges.some(([a, b]) => Math.abs(a.x - side * TOW_RAMP.halfWidth) < 0.0001 &&
      Math.abs(b.x - a.x) < 0.0001 && Math.abs(a.z - b.z) > 4 &&
      Math.abs(a.y - towRampHeight(a.z)) < 0.04 &&
      Math.abs(b.y - towRampHeight(b.z)) < 0.04)).toBe(true);
  }
  const falseTrayEdges = edges.filter(([a, b]) => {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    return mid.z > TOW_RAMP.frontZ + 0.2 && mid.z < TOW_RAMP.rearZ - 0.2 &&
      Math.abs(mid.x) < 0.6 && Math.abs(mid.y - towRampHeight(mid.z)) < 0.01;
  });
  expect(falseTrayEdges).toHaveLength(0);
});

it.each(['car', 'police'])('draws the actual windscreen perimeter of %s without its triangulation diagonal', kind => {
  const line = contours(makeTraffic(kind, 0))[0];
  expect(line).toBeDefined();
  const edges = segments(line);
  const bottomLeft = new THREE.Vector3(-0.9, 1.268, -1.28);
  const bottomRight = new THREE.Vector3(0.9, 1.268, -1.28);
  const topRight = new THREE.Vector3(0.79, 1.878, -0.67);
  const matches = (a: THREE.Vector3, b: THREE.Vector3, x: THREE.Vector3, y: THREE.Vector3) =>
    a.distanceTo(x) < 0.0001 && b.distanceTo(y) < 0.0001 ||
    b.distanceTo(x) < 0.0001 && a.distanceTo(y) < 0.0001;
  expect(edges.some(([a, b]) => matches(a, b, bottomLeft, bottomRight))).toBe(true);
  expect(edges.some(([a, b]) => matches(a, b, bottomLeft, topRight))).toBe(false);
});

it('shares contour resources across colors and 32 pool copies while wheel animation keeps the tire boundaries', () => {
  const variants = makeTrafficVariants('car');
  const original = contours(variants[0])[0];
  expect(original).toBeDefined();
  for (const variant of variants) {
    const line = contours(variant)[0];
    expect(line.geometry).toBe(original.geometry);
    expect(line.material).toBe(original.material);
  }
  const scene = new THREE.Scene();
  for (let i = 0; i < 32; i++) {
    const entry = new THREE.Group();
    const model = variants[i % variants.length].clone(true);
    entry.add(model); scene.add(entry);
    const line = contours(model)[0];
    expect(new THREE.Raycaster().intersectObject(line, false)).toEqual([]);
    const wheel = model.children.find(child => child.name === 'traffic-wheel')!;
    const tireEdges = segments(line).filter(([a, b]) => Math.abs(a.x - wheel.position.x) < 0.0001 &&
      Math.abs(b.x - wheel.position.x) < 0.0001 &&
      Math.abs(Math.hypot(a.y - wheel.position.y, a.z - wheel.position.z) - wheel.userData.radius) < 0.0001);
    expect(tireEdges).toHaveLength(32);
    for (let frame = 0; frame < 12; frame++) animateTraffic(entry, 6, 1 / 60);
    expect(wheel.rotation.x).not.toBe(0);
    expect(contours(model)).toHaveLength(1);
    expect(line.geometry).toBe(original.geometry);
  }
  // The renderer's resource Sets can release all shared pool copies once.
  expect(new Set(contours(scene).map(line => line.geometry)).size).toBe(1);
  expect(new Set(contours(scene).map(line => line.material)).size).toBe(1);
});
