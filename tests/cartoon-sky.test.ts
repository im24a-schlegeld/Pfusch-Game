import { describe, expect, it, vi } from 'vitest';
import { InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { makeCartoonSky } from '../app/game/cartoonSky';
import { World, type WorldLighting, type WorldSegment } from '../app/game/world';

function fixture() {
  const scene = new Scene();
  const camera = new PerspectiveCamera(61, 390 / 844, 0.1, 190);
  camera.position.set(0, 4.4, 10.4);
  camera.lookAt(0, 1.4, -12);
  const world = new World(523, { acceleration: 0.15, maxSpeed: 35 });
  const segment: WorldSegment = {
    id: 1, kind: 'city', start: 100, end: 1000,
    startTime: 4, endTime: 40, lighting: 'day', variant: 0,
  };
  const at = vi.spyOn(world, 'at').mockReturnValue(segment);
  const tunnel = vi.spyOn(world, 'tunnelExposure').mockReturnValue(0);
  const sky = makeCartoonSky(scene, camera);
  const mesh = (name: string) => sky.root.getObjectByName(`cartoon-${name}`) as Mesh;
  return {
    scene, camera, world, sky, mesh, tunnel,
    lighting(from: WorldLighting, to = from) {
      at.mockImplementation(distance => distance < 100
        ? { ...segment, id: 0, start: 0, end: 100, lighting: from }
        : { ...segment, lighting: to });
    },
  };
}

describe('cartoon sky', () => {
  it('uses a bounded reusable pool, unlit geometry and no extra shadow rendering', () => {
    const { sky, world, mesh } = fixture();
    const geometries = sky.root.children.map(object => (object as Mesh).geometry);
    expect(sky.root.children.length).toBeLessThanOrEqual(4);
    const clouds = mesh('clouds') as InstancedMesh;
    expect(clouds.count).toBeGreaterThan(0);
    expect(clouds.count).toBeLessThanOrEqual(8);
    for (let time = 0; time < 120; time++) sky.update(world, 150, time * 10);
    expect(sky.root.children.map(object => (object as Mesh).geometry)).toEqual(geometries);
    for (const object of sky.root.children as Mesh[]) {
      expect(object.castShadow).toBe(false);
      expect(object.receiveShadow).toBe(false);
      expect(object.material).toBeInstanceOf(MeshBasicMaterial);
      const material = object.material as MeshBasicMaterial;
      expect(material.depthTest).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.fog).toBe(false);
      expect(material.toneMapped).toBe(false);
    }
    expect(geometries.reduce((sum, geometry) => sum + geometry.getAttribute('position').count, 0)).toBeLessThan(4000);
    sky.dispose();
  });

  it('blends day into night using the same 42 metre window and fully hides inside tunnels', () => {
    const { sky, world, lighting, mesh, tunnel } = fixture();
    lighting('day', 'night');
    sky.update(world, 100);
    expect(mesh('sun').visible).toBe(true);
    expect(mesh('moon').visible).toBe(false);
    expect(mesh('stars').visible).toBe(false);
    sky.update(world, 121);
    expect((mesh('sun').material as MeshBasicMaterial).opacity).toBeCloseTo(0.5);
    expect((mesh('moon').material as MeshBasicMaterial).opacity).toBeCloseTo(0.5);
    sky.update(world, 142);
    expect(mesh('sun').visible).toBe(false);
    expect(mesh('moon').visible).toBe(true);
    expect(mesh('stars').visible).toBe(true);
    tunnel.mockReturnValue(1);
    sky.update(world, 150);
    expect(sky.root.visible).toBe(false);
    tunnel.mockReturnValue(0);
    sky.update(world, 155);
    expect(sky.root.visible).toBe(true);
    sky.dispose();
  });

  it('keeps sun, moon and clouds inside camera depth on phone and desktop after camera movement', () => {
    const { sky, camera, world, mesh, lighting } = fixture();
    const point = new Vector3();
    const matrix = new Matrix4();
    for (const aspect of [390 / 844, 320 / 568, 1440 / 900]) {
      camera.aspect = aspect;
      camera.position.set(0.4, 5.7, 10.4);
      camera.lookAt(-0.2, 2.1, -12);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      for (const phase of ['day', 'night'] as const) {
        lighting(phase);
        sky.update(world, 150, 0);
        sky.root.updateMatrixWorld(true);
        const body = mesh(phase === 'day' ? 'sun' : 'moon');
        body.getWorldPosition(point).project(camera);
        expect(Math.abs(point.x)).toBeLessThan(0.9);
        expect(point.y).toBeGreaterThan(0);
        expect(point.y).toBeLessThan(0.9);
        expect(point.z).toBeGreaterThan(-1);
        expect(point.z).toBeLessThan(1);
      }
      const clouds = mesh('clouds') as InstancedMesh;
      clouds.getMatrixAt(0, matrix);
      point.setFromMatrixPosition(matrix).applyMatrix4(clouds.matrixWorld).project(camera);
      expect(point.z).toBeLessThan(1);
      expect(point.y).toBeGreaterThan(0);
    }
    sky.dispose();
  });

  it('detaches and releases its resources once', () => {
    const { scene, sky } = fixture();
    const disposals = sky.root.children.map(object => vi.spyOn((object as Mesh).geometry, 'dispose'));
    sky.dispose();
    sky.dispose();
    expect(scene.getObjectByName('cartoon-sky')).toBeUndefined();
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  });
});
