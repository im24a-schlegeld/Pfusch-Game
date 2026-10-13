import { describe, expect, it, vi } from 'vitest';
import { Box3, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
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
    expect(sky.root.children.length).toBeLessThanOrEqual(6);
    const clouds = mesh('clouds') as InstancedMesh;
    expect(clouds.count).toBeGreaterThan(0);
    expect(clouds.count).toBeLessThanOrEqual(56);
    for (let time = 0; time < 120; time++) sky.update(world, 150, time * 10);
    expect(sky.root.children.map(object => (object as Mesh).geometry)).toEqual(geometries);
    for (const object of sky.root.children as Mesh[]) {
      expect(object.castShadow).toBe(false);
      expect(object.receiveShadow).toBe(false);
      expect(object.material).toBeInstanceOf(MeshBasicMaterial);
      const material = object.material as MeshBasicMaterial;
      expect(material.depthTest).toBe(true);
      expect(material.depthWrite).toBe(object === clouds);
      expect(material.fog).toBe(false);
      expect(material.toneMapped).toBe(false);
    }
    expect(geometries.reduce((sum, geometry) => sum + geometry.getAttribute('position').count, 0)).toBeLessThan(4000);
    sky.dispose();
  });

  it('uses real irregular cloud volumes with baked face shades and gentle bounded drift', () => {
    const { sky, world, mesh } = fixture();
    const clouds = mesh('clouds') as InstancedMesh;
    clouds.geometry.computeBoundingBox();
    expect(clouds.geometry.boundingBox!.max.z - clouds.geometry.boundingBox!.min.z).toBeGreaterThan(1);
    const colors = clouds.geometry.getAttribute('color');
    const shades = new Set<number>();
    for (let i = 0; i < colors.count; i++) shades.add(colors.getX(i));
    expect(shades.size).toBeGreaterThanOrEqual(4);
    expect((clouds.material as MeshBasicMaterial).map).toBeNull();
    sky.update(world, 150, 0);
    const start = clouds.instanceMatrix.array.slice();
    const widths = new Set<number>();
    const matrix = new Matrix4();
    const size = new Vector3();
    for (let i = 0; i < clouds.count; i++) {
      clouds.getMatrixAt(i, matrix);
      size.setFromMatrixScale(matrix);
      widths.add(Math.round((size.x / size.y) * 10));
    }
    expect(widths.size).toBeGreaterThan(4);
    sky.update(world, 150, 5);
    for (let i = 0; i < clouds.count; i++) {
      const move = clouds.instanceMatrix.array[i * 16 + 12] - start[i * 16 + 12];
      expect(move).toBeGreaterThan(0);
      expect(move).toBeLessThan(10);
    }
    // Reduced-motion integration always passes elapsed=0, independent of distance.
    sky.update(world, 180, 0);
    expect(Array.from(clouds.instanceMatrix.array)).toEqual(Array.from(start));
    sky.dispose();
  });

  it('blends day into night using the same 42 metre window and fully hides inside tunnels', () => {
    const { sky, world, lighting, mesh, tunnel } = fixture();
    lighting('day', 'night');
    sky.update(world, 100);
    expect(mesh('sun').visible).toBe(true);
    expect(mesh('sun-halo').visible).toBe(true);
    expect(mesh('sun-halo').geometry.getAttribute('color').itemSize).toBe(4);
    expect(mesh('moon').visible).toBe(false);
    expect(mesh('stars').visible).toBe(false);
    sky.update(world, 121);
    expect((mesh('sun').material as MeshBasicMaterial).opacity).toBeCloseTo(0.5);
    expect((mesh('moon').material as MeshBasicMaterial).opacity).toBeCloseTo(0.5);
    sky.update(world, 142);
    expect(mesh('sun').visible).toBe(false);
    expect(mesh('moon').visible).toBe(true);
    expect(mesh('moon-halo').visible).toBe(true);
    expect(mesh('sun-halo').visible).toBe(false);
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
    const bounds = new Box3();
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
      // Volumes must remain clear of the far clip even with the phone's wide FOV.
      camera.fov = 112;
      camera.updateProjectionMatrix();
      sky.update(world, 150, 0);
      clouds.geometry.computeBoundingBox();
      for (let i = 0; i < clouds.count; i++) {
        clouds.getMatrixAt(i, matrix);
        bounds.copy(clouds.geometry.boundingBox!).applyMatrix4(matrix);
        expect(bounds.min.z).toBeGreaterThan(-camera.far);
        expect(bounds.max.z).toBeLessThan(-100);
      }
      camera.fov = 61;
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
