import { describe, expect, it, vi } from 'vitest';
import { BackSide, Box3, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, ShaderLib, UniformsUtils, Vector3 } from 'three';
import { CARTOON_SKY, makeCartoonSky } from '../app/game/cartoonSky';
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
    expect(sky.root.children.length).toBeLessThanOrEqual(CARTOON_SKY.maxDraws);
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

  it('adds only one exterior cloud shell and shares the geometry and moving instance buffer', () => {
    const { sky, world, mesh } = fixture();
    const clouds = mesh('clouds') as InstancedMesh, contour = mesh('cloud-outline') as InstancedMesh;
    expect(contour).toBeInstanceOf(InstancedMesh);
    expect(contour.geometry).toBe(clouds.geometry);
    expect(contour.instanceMatrix).toBe(clouds.instanceMatrix);
    expect(contour.count).toBe(clouds.count);
    expect(contour.userData.cartoonOutline).toBeUndefined();
    expect((contour.material as MeshBasicMaterial).side).toBe(BackSide);
    expect((contour.material as MeshBasicMaterial).depthWrite).toBe(false);
    expect(contour.renderOrder).toBeGreaterThan(clouds.renderOrder);
    const duplicateWrite = vi.spyOn(contour, 'setMatrixAt');
    sky.update(world, 150, 0);
    sky.update(world, 150, 5);
    expect(duplicateWrite).not.toHaveBeenCalled();
    expect(contour.instanceMatrix.version).toBe(clouds.instanceMatrix.version);
    expect(sky.root.children).toHaveLength(7);
    sky.dispose();
  });

  it('keeps disc borders on the true sun/moon perimeter instead of their triangle diagonals', () => {
    const { sky, mesh } = fixture();
    for (const name of ['sun', 'moon']) {
      const geometry = mesh(name).geometry;
      const barycentric = geometry.getAttribute('cartoonSkyBarycentric');
      const boundary = geometry.getAttribute('cartoonSkyBoundary');
      expect(barycentric.count).toBe(geometry.getAttribute('position').count);
      expect(boundary.count).toBe(barycentric.count);
      let borderEdges = 0, omittedEdges = 0;
      for (let i = 0; i < boundary.count; i += 3) {
        expect([barycentric.getX(i), barycentric.getY(i), barycentric.getZ(i)]).toEqual([1, 0, 0]);
        for (const flag of [boundary.getX(i), boundary.getY(i), boundary.getZ(i)])
          if (flag === 1) borderEdges++; else omittedEdges++;
      }
      expect(borderEdges).toBeGreaterThan(20);
      expect(omittedEdges).toBeGreaterThan(borderEdges);
      // A closed 48-sided sun has exactly 48 perimeter edges. The duplicated
      // first/last circle vertex must not leave a black radial seam to its centre.
      if (name === 'sun') expect(borderEdges).toBe(48);
    }
    expect(mesh('sun-halo').geometry.getAttribute('cartoonSkyBoundary')).toBeUndefined();
    expect(mesh('moon-halo').geometry.getAttribute('cartoonSkyBoundary')).toBeUndefined();
    sky.dispose();
  });

  it('sizes the shared cloud stroke in CSS pixels and ignores invalid resize dimensions', () => {
    const { sky, mesh } = fixture();
    const material = mesh('cloud-outline').material as MeshBasicMaterial;
    const shader = { vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader,
      uniforms: UniformsUtils.clone(ShaderLib.basic.uniforms) };
    material.onBeforeCompile(shader as Parameters<MeshBasicMaterial['onBeforeCompile']>[0], {} as never);
    sky.resize(1440, 900);
    expect(shader.uniforms.cartoonSkyViewport.value.toArray()).toEqual([1440, 900]);
    sky.resize(0, NaN);
    expect(shader.uniforms.cartoonSkyViewport.value.toArray()).toEqual([1440, 900]);
    expect(shader.uniforms.cartoonSkyStroke.value).toBeGreaterThanOrEqual(0.75);
    expect(shader.uniforms.cartoonSkyStroke.value).toBeLessThanOrEqual(1.25);
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

  it('keeps every actual cloud silhouette well above the forest horizon on narrow and wide cameras', () => {
    const { sky, camera, world, mesh } = fixture();
    const clouds = mesh('clouds') as InstancedMesh;
    const vertices = clouds.geometry.getAttribute('position');
    const instance = new Matrix4(), transform = new Matrix4(), point = new Vector3();
    for (const aspect of [390 / 844, 320 / 568, 1440 / 900]) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      for (const time of [0, 1200]) {
        sky.update(world, 150, time); sky.root.updateMatrixWorld(true);
        let lowest = Infinity;
        for (let puff = 0; puff < clouds.count; puff++) {
          clouds.getMatrixAt(puff, instance);
          transform.multiplyMatrices(clouds.matrixWorld, instance);
          for (let vertex = 0; vertex < vertices.count; vertex++) {
            point.fromBufferAttribute(vertices, vertex).applyMatrix4(transform).project(camera);
            lowest = Math.min(lowest, point.y);
          }
        }
        expect(lowest).toBeGreaterThan(0.28);
      }
    }
    sky.dispose();
  });

  it('detaches and releases its resources once', () => {
    const { scene, sky } = fixture();
    const geometries = new Set(sky.root.children.map(object => (object as Mesh).geometry));
    const materials = new Set(sky.root.children.map(object => (object as Mesh).material as MeshBasicMaterial));
    const disposals = [...geometries].map(geometry => vi.spyOn(geometry, 'dispose'));
    const materialDisposals = [...materials].map(material => vi.spyOn(material, 'dispose'));
    sky.dispose();
    sky.dispose();
    expect(scene.getObjectByName('cartoon-sky')).toBeUndefined();
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
    for (const dispose of materialDisposals) expect(dispose).toHaveBeenCalledTimes(1);
  });
});
