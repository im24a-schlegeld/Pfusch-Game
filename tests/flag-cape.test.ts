import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Raycaster, ShaderLib, Texture, TextureLoader, UniformsUtils, Vector3, type WebGLRenderer } from 'three';
import type { Product } from '../app/domain/types';
import catalog from '../public/catalog/products.json';
import { addFlagCape, FLAG_CAPE, flagCapeUv } from '../app/game/flagCape';
import { createSceneInvalidation } from '../app/game/sceneInvalidation';
import { installImportedBikeFixtures } from './importedBikeFixture';
import { makeBike } from '../app/game/vehicle';
import { newPlayer } from '../app/domain/progression';
import { applyCartoonHeroStyle } from '../app/game/cartoonStyle';

installImportedBikeFixtures();
vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(), fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(), accessoryMaterial: () => new MeshStandardMaterial(),
}));

const product = catalog.find(item => item.category === 'cape') as Product;
function cape() {
  const bike = new Group(), torso = new Group();
  bike.add(torso); torso.position.set(0, .8, .2); torso.rotation.x = -.35;
  const texture = new Texture(), loader = vi.fn(() => texture);
  const controller = addFlagCape(torso, product, loader)!;
  return { bike, torso, texture, loader, ...controller };
}

function clothMeasures(mesh: Mesh) {
  mesh.updateWorldMatrix(true, false);
  const positions = mesh.geometry.getAttribute('position');
  const { rows, columns, width, length } = FLAG_CAPE;
  const scale = mesh.getWorldScale(new Vector3());
  const a = new Vector3(), b = new Vector3();
  const distance = (first: number, second: number) => a.fromBufferAttribute(positions, first).applyMatrix4(mesh.matrixWorld)
    .distanceTo(b.fromBufferAttribute(positions, second).applyMatrix4(mesh.matrixWorld));
  let horizontal = 0, vertical = 0, minimumRatio = Infinity, maximumRatio = 0;
  for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
    const vertex = row * (columns + 1) + column;
    if (column < columns) {
      const edge = distance(vertex, vertex + 1), ratio = edge / (width / columns * scale.x);
      horizontal += edge; minimumRatio = Math.min(minimumRatio, ratio); maximumRatio = Math.max(maximumRatio, ratio);
    }
    if (row < rows) {
      const edge = distance(vertex, vertex + columns + 1), ratio = edge / (length / rows * scale.y);
      vertical += edge; minimumRatio = Math.min(minimumRatio, ratio); maximumRatio = Math.max(maximumRatio, ratio);
    }
  }
  return { scale, width: horizontal / (rows + 1), length: vertical / (columns + 1), minimumRatio, maximumRatio };
}

const pointAt = (mesh: Mesh, vertex: number) => new Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), vertex);
const pinIndices = [0, FLAG_CAPE.columns / 2, FLAG_CAPE.columns];
describe('original PFUSCH flag as a neck cape', () => {
  it('turns the untouched flag a quarter-turn so its original left eyelet edge is the collar', () => {
    const { mesh, texture, loader } = cape();
    expect(loader).toHaveBeenCalledWith(product.preview!.artwork!.localImage);
    expect(texture.offset.toArray()).toEqual([.0775, .24]);
    expect(texture.repeat.toArray()).toEqual([.86, .5175]);
    expect(texture.flipY).toBe(true);
    expect(mesh.material.side).toBe(DoubleSide);
    expect(mesh.material.color.getHexString()).toBe('ffffff');
    expect(mesh.geometry.getAttribute('position').count).toBe((FLAG_CAPE.columns + 1) * (FLAG_CAPE.rows + 1));
    expect(mesh.geometry.index!.count / 3).toBe(FLAG_CAPE.columns * FLAG_CAPE.rows * 2);
    const uv = mesh.geometry.getAttribute('uv');
    expect([uv.getX(0), uv.getY(0)]).toEqual([0, 0]);
    expect([uv.getX(FLAG_CAPE.columns), uv.getY(FLAG_CAPE.columns)]).toEqual([0, 1]);
    const hem = FLAG_CAPE.rows * (FLAG_CAPE.columns + 1);
    expect([uv.getX(hem), uv.getY(hem)]).toEqual([1, 0]);
    expect([uv.getX(uv.count - 1), uv.getY(uv.count - 1)]).toEqual([1, 1]);
    expect(FLAG_CAPE.length / FLAG_CAPE.width).toBeCloseTo(1.04 / .626);
    expect(flagCapeUv({ ...product.preview!.artwork!, crop: { x: 0, y: 0, width: 3000, height: 1 } })).toBeNull();
  });
  it('keeps a pixel-sized perimeter on the moving double-sided cloth in its existing artwork pass', () => {
    const { mesh, texture, torso, update } = cape();
    const position = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv');
    const original = Array.from(position.array), originalUv = Array.from(uv.array);
    const children = [...mesh.children], geometry = mesh.geometry;
    applyCartoonHeroStyle(torso);
    applyCartoonHeroStyle(torso);
    const shader = {
      vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader,
      uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms),
    };
    const renderer = { getPixelRatio: () => 2 } as WebGLRenderer;
    mesh.material.onBeforeCompile(shader as Parameters<MeshStandardMaterial['onBeforeCompile']>[0], renderer);
    mesh.onBeforeRender(renderer, {} as never, {} as never, geometry, mesh.material, {} as never);
    // The stroke uses physical pixel derivatives, while its width follows CSS
    // pixels on high-DPI phones. Cropped map UVs must never move the perimeter.
    expect(shader.uniforms.flagCapeOutlineWidth?.value).toBeCloseTo(2.3);
    expect(shader.vertexShader).toContain('vFlagCapeUv = uv;');
    expect(shader.fragmentShader).toContain('fwidth(vFlagCapeUv)');
    expect(shader.fragmentShader.indexOf('float flagCapeInk')).toBeGreaterThan(shader.fragmentShader.indexOf('#include <colorspace_fragment>'));
    expect(shader.fragmentShader.match(/float flagCapeInk/g)).toHaveLength(1);
    expect(shader.fragmentShader).toContain('// PFUSCH_CARTOON');
    const width = shader.uniforms.flagCapeOutlineWidth;
    mesh.onBeforeRender({ getPixelRatio: () => 1 } as WebGLRenderer, {} as never, {} as never, geometry, mesh.material, {} as never);
    expect(width.value).toBeCloseTo(1.15);
    update({ speed: 40, lateralAcceleration: 4 }, 1 / 60);
    expect(Array.from(position.array)).not.toEqual(original);
    expect(mesh.geometry).toBe(geometry);
    expect(mesh.geometry.getAttribute('position')).toBe(position);
    expect(mesh.geometry.getAttribute('uv')).toBe(uv);
    expect(Array.from(uv.array)).toEqual(originalUv);
    expect(mesh.material.map).toBe(texture);
    expect(mesh.material.side).toBe(DoubleSide);
    expect(mesh.children).toEqual(children);
  });
  it('supports the original eyelet corners and joins them to a narrow closed neck tie', () => {
    const { mesh } = cape();
    const positions = mesh.geometry.getAttribute('position');
    const last = FLAG_CAPE.columns;
    expect(positions.getX(0)).toBeLessThan(0);
    expect(positions.getX(last)).toBeGreaterThan(0);
    expect(positions.getX(0) + positions.getX(last)).toBeCloseTo(0, 8);
    expect(positions.getZ(0)).toBeGreaterThan(0);
    expect(positions.getZ(last)).toBeGreaterThan(0);
    expect(Math.hypot(positions.getX(0) - positions.getX(last), positions.getY(0) - positions.getY(last),
      positions.getZ(0) - positions.getZ(last))).toBeLessThan(FLAG_CAPE.width);
    const firstEye = mesh.getObjectByName('flag-original-bottom-left-eyelet')!;
    const lastEye = mesh.getObjectByName('flag-original-top-left-eyelet')!;
    expect(firstEye.position.x).toBeLessThan(positions.getX(0));
    expect(lastEye.position.x).toBeGreaterThan(positions.getX(last));
    expect(Math.abs(firstEye.position.x - positions.getX(0))).toBeLessThan(.005);
    expect(lastEye.position.x - positions.getX(last)).toBeLessThan(.005);
    expect(mesh.getObjectByName('flag-cape-knot')).toBeDefined();
    expect(mesh.getObjectByName('flag-cape-knot')!.position.x).toBeCloseTo(0, 8);
    expect(mesh.getObjectByName('flag-cape-knot')!.position.y).toBeGreaterThan(.58);
    expect(mesh.getObjectByName('flag-cape-knot')!.position.z).toBeGreaterThan(0);
    const tie = mesh.getObjectByName('flag-eyelet-connecting-tie') as Mesh;
    expect(tie).toBeDefined();
    tie.geometry.computeBoundingBox();
    expect(tie.geometry.boundingBox!.max.y).toBeLessThan(.64);
    const neckTie = mesh.getObjectByName('flag-neck-tie') as Mesh;
    neckTie.geometry.computeBoundingBox();
    expect(neckTie.geometry.boundingBox!.max.x).toBeLessThan(.125);
    expect(neckTie.geometry.boundingBox!.min.x).toBeGreaterThan(-.125);
    expect(mesh.getObjectByName('flag-cape-knot')!.position.y).toBeLessThan(.61);
  });
  it('keeps the same material dimensions on all five bikes after rest and riding', () => {
    const loader = vi.spyOn(TextureLoader.prototype, 'load').mockImplementation(() => new Texture());
    const measurements: { id: string; phase: string; width: number; length: number }[] = [];
    try {
      for (const id of ['125', 'moped', 'scooter', '450', '701']) {
        const player = newPlayer(); player.bike = id; player.equipped.cape = product.id;
        const bike = makeBike(player, [product]);
        const flag = bike.root.getObjectByName('pfusch-flag-cape') as Mesh;
        const positions = flag.geometry.getAttribute('position'), original = positions.array;
        // Initial construction settles 90 fixed steps. Re-evaluate after the
        // imported rider counter-scale is installed, as the real garage does.
        bike.animateAccessories({ speed: 0, reducedMotion: true }, 1 / 60);
        for (const phase of ['rest', 'riding']) {
          if (phase === 'riding') for (let frame = 0; frame < 300; frame++)
            bike.animateAccessories({ speed: 40, lateralAcceleration: 4 }, 1 / 60);
          const measure = clothMeasures(flag), detail = `${id} ${phase}: ${JSON.stringify(measure)}`;
          for (const scale of measure.scale.toArray()) expect(scale).toBeCloseTo(1.45, 8);
          expect(Math.abs(measure.width / (FLAG_CAPE.width * 1.45) - 1), detail).toBeLessThan(.04);
          expect(Math.abs(measure.length / (FLAG_CAPE.length * 1.45) - 1), detail).toBeLessThan(.04);
          expect(measure.minimumRatio, detail).toBeGreaterThan(.70);
          expect(measure.maximumRatio, detail).toBeLessThan(1.30);
          measurements.push({ id, phase, width: measure.width, length: measure.length });
          expect(positions.array).toBe(original);
        }
      }
      for (const phase of ['rest', 'riding']) for (const dimension of ['width', 'length'] as const) {
        const values = measurements.filter(measure => measure.phase === phase).map(measure => measure[dimension]);
        expect(Math.max(...values) / Math.min(...values), `${phase} ${dimension} across bikes`).toBeLessThan(1.04);
      }
    } finally { loader.mockRestore(); }
  }, 120000);
  it('keeps the rear neck seam and fabric outside the actual folded hoodie', () => {
    const loader = vi.spyOn(TextureLoader.prototype, 'load').mockImplementation(() => new Texture());
    try {
      const hoodie = catalog.find(item => item.handle === 'keep-up-hoodie') as Product;
      const player = newPlayer(); player.bike = '450'; player.helmet = 'motocross';
      player.equipped.cape = product.id; player.equipped.upper = hoodie.id;
      const bike = makeBike(player, [product, hoodie]);
      bike.animateAccessories({ speed: 0, reducedMotion: true }, 1 / 60);
      bike.root.updateMatrixWorld(true);
      const flag = bike.root.getObjectByName('pfusch-flag-cape') as Mesh;
      const hood = bike.root.getObjectByName('folded-hood') as Mesh;
      const positions = flag.geometry.getAttribute('position'), ray = new Raycaster();
      const direction = new Vector3(0, 0, -1).transformDirection(flag.matrixWorld);
      let checked = 0;
      for (let vertex = 0; vertex < positions.count; vertex++) {
        const point = pointAt(flag, vertex);
        if (point.z < .08) continue;
        ray.set(flag.localToWorld(new Vector3(point.x, point.y, 1)), direction);
        const hit = ray.intersectObject(hood, false)[0];
        if (!hit) continue;
        const rearSurface = flag.worldToLocal(hit.point).z;
        expect(point.z, `rear hood contact at vertex ${vertex}`).toBeGreaterThan(rearSurface + .002);
        checked++;
      }
      expect(checked).toBeGreaterThan(3);
    } finally { loader.mockRestore(); }
  });
  it('routes the narrow neck tie outside the real collar and folded hood', () => {
    const loader = vi.spyOn(TextureLoader.prototype, 'load').mockImplementation(() => new Texture());
    try {
      const hoodie = catalog.find(item => item.handle === 'keep-up-hoodie') as Product;
      const player = newPlayer(); player.bike = '450'; player.helmet = 'motocross';
      player.equipped.cape = product.id; player.equipped.upper = hoodie.id;
      const bike = makeBike(player, [product, hoodie]);
      bike.animateRider({ wheelie: 0, steer: 0, landing: 0, bikePitch: 0 }, 1 / 60);
      bike.animateAccessories({ speed: 0, reducedMotion: true }, 1 / 60);
      bike.root.updateMatrixWorld(true);
      const flag = bike.root.getObjectByName('pfusch-flag-cape') as Mesh;
      const torso = flag.parent!;
      const cord = flag.getObjectByName('flag-neck-tie') as Mesh;
      const surfaces = ['tailored-garment', 'stand-collar', 'folded-hood'].flatMap(name => bike.root.getObjectsByProperty('name', name)) as Mesh[];
      const centers = (cord.geometry as import('three').TubeGeometry).parameters.path;
      const helmet = bike.root.getObjectByName('motocross-helmet')!;
      const ray = new Raycaster(), radial = new Vector3(), origin = new Vector3(), target = new Vector3();
      const up = new Vector3(0, 1, 0).transformDirection(torso.matrixWorld);
      let checked = 0;
      for (let sample = 1; sample < 100; sample++) {
        const point = centers.getPoint(sample / 100);
        radial.set(point.x, 0, point.z).normalize();
        origin.copy(radial).multiplyScalar(.65); origin.y = point.y; torso.localToWorld(origin);
        target.set(0, point.y, 0); torso.localToWorld(target);
        ray.set(origin, target.sub(origin).normalize());
        const hit = ray.intersectObjects(surfaces, false)[0];
        if (!hit) continue;
        const surface = torso.worldToLocal(hit.point);
        expect(Math.hypot(point.x, point.z), `cord sample ${sample}`)
          .toBeGreaterThan(Math.hypot(surface.x, surface.z) + .001);
        ray.set(torso.localToWorld(new Vector3(point.x, 0, point.z)), up);
        const helmetHit = ray.intersectObject(helmet, true)[0];
        if (helmetHit) expect(point.y + .004, `tie below helmet sample ${sample}`)
          .toBeLessThan(torso.worldToLocal(helmetHit.point).y);
        checked++;
      }
      expect(checked).toBeGreaterThan(20);
    } finally { loader.mockRestore(); }
  });
  it('blows the hem rearward at ordinary riding speed while speed zero still falls under gravity', () => {
    const rest = cape(), ride = cape();
    for (let step = 0; step < 360; step++) {
      rest.update({ speed: 0 }, 1 / 60); ride.update({ speed: 22 }, 1 / 60);
    }
    const hem = FLAG_CAPE.rows * (FLAG_CAPE.columns + 1) + FLAG_CAPE.columns / 2;
    rest.mesh.updateWorldMatrix(true, false); ride.mesh.updateWorldMatrix(true, false);
    const still = pointAt(rest.mesh, hem).applyMatrix4(rest.mesh.matrixWorld);
    const moving = pointAt(ride.mesh, hem).applyMatrix4(ride.mesh.matrixWorld);
    expect(moving.z - still.z).toBeGreaterThan(.18);
    expect(moving.y - still.y).toBeGreaterThan(.05);
  });
  it('keeps the eyelets and rear neck support fixed while collar fabric and hem can drape', () => {
    const { bike, torso, mesh, update } = cape();
    const attribute = mesh.geometry.getAttribute('position');
    const positions = attribute.array as Float32Array;
    const attachment = pinIndices.map(vertex => pointAt(mesh, vertex));
    const firstFreeRow = FLAG_CAPE.columns + 1;
    const fabric = Array.from({ length: FLAG_CAPE.columns + 1 }, (_, vertex) => pointAt(mesh, firstFreeRow + vertex));
    const knot = mesh.getObjectByName('flag-cape-knot')!;
    const knotPosition = knot.position.toArray();
    const skeletonPosition = torso.position.toArray();
    for (let frame = 0; frame < 240; frame++) {
      bike.rotation.x = Math.sin(frame / 60) * 1.1; bike.rotation.z = Math.sin(frame / 30) * .2;
      update({ speed: 55, lateralAcceleration: Math.sin(frame / 18) * 18, landing: frame === 80 ? 1 : 0 }, 1 / 60);
      for (let pin = 0; pin < pinIndices.length; pin++) expect(pointAt(mesh, pinIndices[pin]).toArray()).toEqual(attachment[pin].toArray());
      expect(torso.position.toArray()).toEqual(skeletonPosition);
      expect(knot.position.toArray()).toEqual(knotPosition);
    }
    expect(attribute.array).toBe(positions);
    expect(fabric.some((point, vertex) => point.distanceTo(pointAt(mesh, firstFreeRow + vertex)) > .002)).toBe(true);
    for (let vertex = 0; vertex < attribute.count; vertex++) {
      const x = attribute.getX(vertex), y = attribute.getY(vertex), z = attribute.getZ(vertex);
      expect(Number.isFinite(x + y + z)).toBe(true);
      expect(Math.min(...attachment.map(anchor => anchor.distanceTo(new Vector3(x, y, z))))).toBeLessThan(FLAG_CAPE.length + FLAG_CAPE.width);
      const normal = mesh.geometry.getAttribute('normal');
      expect(Math.hypot(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex))).toBeCloseTo(1, 5);
    }
  });
  it('freezes on pause and gives reduced motion a stable wind drape', () => {
    const { mesh, update } = cape();
    for (let frame = 0; frame < 80; frame++) update({ speed: 35 }, 1 / 60);
    const positions = mesh.geometry.getAttribute('position').array;
    const before = Array.from(positions);
    for (let frame = 0; frame < 20; frame++) update({ speed: 60, landing: 1, paused: true }, .1);
    expect(Array.from(positions)).toEqual(before);
    update({ speed: 35, reducedMotion: true }, 1 / 60);
    const reduced = Array.from(positions);
    for (let frame = 0; frame < 30; frame++) update({ speed: 35, landing: 1, lateralAcceleration: 30, reducedMotion: true }, 1 / 30);
    expect(Array.from(positions)).toEqual(reduced);
    update({ speed: Infinity, lateralAcceleration: NaN }, 0);
    expect(Array.from(positions)).toEqual(reduced);
  });
  it('reaches the same cloth state after 300 fixed steps at 30, 60 and 120 Hz', () => {
    const results = [30, 60, 120].map(rate => {
      const { mesh, update } = cape();
      for (let frame = 0; frame < rate * 5; frame++)
        update({ speed: 38, lateralAcceleration: 3, longitudinalAcceleration: 1 }, 1 / rate);
      return Array.from(mesh.geometry.getAttribute('position').array);
    });
    for (const result of results.slice(1)) {
      let maximum = 0;
      for (let i = 0; i < result.length; i++) maximum = Math.max(maximum, Math.abs(result[i] - results[0][i]));
      expect(maximum).toBeLessThan(1e-5);
    }
  });
  it('preserves free cloth inertia when the torso turns, while the wrapped collar follows', () => {
    const { torso, mesh, update } = cape();
    mesh.updateWorldMatrix(true, false);
    const hem = FLAG_CAPE.rows * (FLAG_CAPE.columns + 1) + FLAG_CAPE.columns / 2;
    const worldHem = pointAt(mesh, hem).applyMatrix4(mesh.matrixWorld);
    const localHem = pointAt(mesh, hem);
    const worldPin = pointAt(mesh, 0).applyMatrix4(mesh.matrixWorld);
    const pins = pinIndices.map(vertex => pointAt(mesh, vertex).toArray());
    torso.rotation.x -= .25;
    // Half a simulation step isolates frame transport from subsequent forces.
    update({ speed: 0 }, 1 / 120);
    mesh.updateWorldMatrix(true, false);
    expect(pointAt(mesh, hem).applyMatrix4(mesh.matrixWorld).distanceTo(worldHem)).toBeLessThan(1e-6);
    expect(pointAt(mesh, hem).distanceTo(localHem)).toBeGreaterThan(.02);
    expect(pointAt(mesh, 0).applyMatrix4(mesh.matrixWorld).distanceTo(worldPin)).toBeGreaterThan(.05);
    expect(pinIndices.map(vertex => pointAt(mesh, vertex).toArray())).toEqual(pins);
  });
  it('softens lateral rider transport without suppressing vertical cloth inertia', () => {
    const { torso, mesh, update } = cape();
    const hem = FLAG_CAPE.rows * (FLAG_CAPE.columns + 1) + FLAG_CAPE.columns / 2;
    mesh.updateWorldMatrix(true, false);
    const before = pointAt(mesh, hem).applyMatrix4(mesh.matrixWorld);
    const pins = pinIndices.map(vertex => pointAt(mesh, vertex).toArray());
    torso.position.x += .4;
    torso.position.y += .2;
    // Isolate frame transport from forces: the next fixed cloth step has not
    // run yet. A lane change should carry most of the flag along with the rider.
    update({ speed: 0 }, 1 / 120);
    mesh.updateWorldMatrix(true, false);
    const after = pointAt(mesh, hem).applyMatrix4(mesh.matrixWorld);
    expect(after.x - before.x).toBeGreaterThan(.25);
    expect(after.x - before.x).toBeLessThan(.39);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1e-6);
    expect(pinIndices.map(vertex => pointAt(mesh, vertex).toArray())).toEqual(pins);
  });
  it('does not lift cloth onto the height of a distant finite seat volume', () => {
    const body = new Group(), torso = new Group();
    body.userData.importedBike = '125';
    // High bodywork well in front of the rider must not become an infinite
    // horizontal obstacle underneath every cloth point.
    body.userData.tailContact = [0, 1.1, -4];
    body.add(torso); torso.position.set(0, .8, .2); torso.rotation.x = -.35;
    const { mesh, update } = addFlagCape(torso, product, () => new Texture())!;
    update({ speed: 0, reducedMotion: true }, 1 / 60);
    mesh.updateWorldMatrix(true, false);
    const hem = FLAG_CAPE.rows * (FLAG_CAPE.columns + 1);
    let lowest = Infinity;
    for (let column = 0; column <= FLAG_CAPE.columns; column++)
      lowest = Math.min(lowest, pointAt(mesh, hem + column).applyMatrix4(mesh.matrixWorld).y);
    expect(lowest).toBeLessThan(.8);
  });
  it('ignores unreferenced shared-buffer vertices when fitting a seat collider', () => {
    const make = (withUnusedVertex: boolean) => {
      const body = new Group(), torso = new Group();
      body.userData.importedBike = '125';
      body.add(torso); torso.position.set(0, .8, .2); torso.rotation.x = -.35;
      const geometry = new BufferGeometry();
      const points = [-.1, .35, .5, .1, .35, .5, 0, .35, .75];
      // Imported split parts share attributes, including vertices that belong
      // to completely different bike parts. Only these three form the seat.
      if (withUnusedVertex) points.push(5, 3, 5);
      geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
      geometry.setIndex([0, 1, 2]);
      const seat = new Mesh(geometry, new MeshStandardMaterial());
      seat.userData.importedPart = 'seat'; body.add(seat);
      const controller = addFlagCape(torso, product, () => new Texture())!;
      controller.update({ speed: 0, reducedMotion: true }, 1 / 60);
      return Array.from(controller.mesh.geometry.getAttribute('position').array);
    };
    expect(make(true)).toEqual(make(false));
  });
  it('keeps cloth faces outside rear plastic bodywork beyond the old seat/tail volumes', () => {
    const body = new Group(), torso = new Group();
    body.userData.importedBike = '450'; body.add(torso);
    torso.position.set(0, .8, .2); torso.rotation.x = -.35;
    const plastic = new Mesh(new BoxGeometry(.45, .08, .65), new MeshStandardMaterial());
    plastic.position.set(0, .48, .7);
    plastic.userData.importedPart = 'rear-black-plastic'; plastic.userData.importedRig = 'body'; body.add(plastic);
    const { mesh, update } = addFlagCape(torso, product, () => new Texture())!;
    update({ speed: 0, reducedMotion: true }, 1 / 60); mesh.updateWorldMatrix(true, false);
    const positions = mesh.geometry.getAttribute('position'), indices = mesh.geometry.index!;
    const center = new Vector3(), corner = new Vector3();
    let supported = 0;
    for (let triangle = 0; triangle < indices.count; triangle += 3) {
      center.set(0, 0, 0);
      for (let i = 0; i < 3; i++) center.add(corner.fromBufferAttribute(positions, indices.getX(triangle + i)));
      center.multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld);
      if (Math.abs(center.x) >= .225 || center.z <= .375 || center.z >= 1.025) continue;
      expect(center.y > .52 - .002 || center.y < .44 + .002, `cloth face ${triangle / 3}`).toBe(true);
      if (center.y > .52 && center.y < .58) supported++;
    }
    expect(supported).toBeGreaterThan(2);
  });
  it('uses the current rider pose for gravity before the renderer updates world matrices', () => {
    const pending = cape(), rendered = cape();
    for (const item of [pending, rendered]) {
      const importedScale = new Group();
      importedScale.matrixAutoUpdate = false;
      importedScale.matrix.makeScale(1.05, 1.05, 1.05);
      importedScale.add(item.torso);
      item.bike.add(importedScale);
      item.bike.updateMatrixWorld(true);
      item.bike.rotation.x = .8;
      item.torso.rotation.x = -.5;
    }
    rendered.bike.updateMatrixWorld(true);
    pending.update({ speed: 0, reducedMotion: true }, 1 / 60);
    rendered.update({ speed: 0, reducedMotion: true }, 1 / 60);
    expect(Array.from(pending.mesh.geometry.getAttribute('position').array))
      .toEqual(Array.from(rendered.mesh.geometry.getAttribute('position').array));
  });
  it('drapes close to the back and reserves pouch volume only with an equipped bag', () => {
    const bare = cape(), bagged = cape();
    const bag = new Group(); bag.name = 'crossbody-assembly-v43';
    bagged.torso.add(bag);
    for (const item of [bare, bagged]) item.update({ speed: 0, reducedMotion: true }, 1 / 60);
    const positions = bagged.mesh.geometry.getAttribute('position');
    let displaced = 0;
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const a = pointAt(bare.mesh, vertex), b = pointAt(bagged.mesh, vertex);
      displaced = Math.max(displaced, a.distanceTo(b));
      if (b.z > .10) expect(Math.hypot(b.x / .20, (b.y - .16) / .22, (b.z - .18) / .13)).toBeGreaterThanOrEqual(.9999);
    }
    expect(displaced).toBeGreaterThan(.02);
  });
  it('owns and releases only its own texture with the mesh material', () => {
    const { mesh, texture } = cape();
    const dispose = vi.spyOn(texture, 'dispose');
    mesh.material.dispose(); expect(dispose).toHaveBeenCalledOnce();
  });
  it('invalidates an idle garage when its original artwork finishes loading', () => {
    const { torso, texture } = cape();
    const invalidation = createSceneInvalidation();
    invalidation.track(torso);
    expect(invalidation.consume()).toBe(true);
    expect(invalidation.consume()).toBe(false);
    // This is the same image+version publication performed by TextureLoader.
    texture.image = { width: 2000, height: 2000 };
    texture.needsUpdate = true;
    expect(invalidation.consume()).toBe(true);
    expect(invalidation.consume()).toBe(false);
  });
});
