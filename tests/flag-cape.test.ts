import { describe, expect, it, vi } from 'vitest';
import { DoubleSide, Group, Texture } from 'three';
import type { Product } from '../app/domain/types';
import catalog from '../public/catalog/products.json';
import { addFlagCape, FLAG_CAPE, flagCapeUv } from '../app/game/flagCape';
import { createSceneInvalidation } from '../app/game/sceneInvalidation';

const product = catalog.find(item => item.category === 'cape') as Product;
function cape() {
  const bike = new Group(), torso = new Group();
  bike.add(torso); torso.position.set(0, .8, .2); torso.rotation.x = -.35;
  const texture = new Texture(), loader = vi.fn(() => texture);
  const controller = addFlagCape(torso, product, loader)!;
  return { bike, torso, texture, loader, ...controller };
}
describe('original PFUSCH flag as a neck cape', () => {
  it('turns the untouched flag a quarter-turn so its original left eyelet edge is the collar', () => {
    const { mesh, texture, loader } = cape();
    expect(loader).toHaveBeenCalledWith(product.preview!.artwork!.localImage);
    expect(texture.offset.toArray()).toEqual([.0775, .24]);
    expect(texture.repeat.toArray()).toEqual([.86, .5175]);
    expect(texture.flipY).toBe(true);
    expect(mesh.material.side).toBe(DoubleSide);
    expect(mesh.material.color.getHexString()).toBe('ffffff');
    expect(mesh.geometry.getAttribute('position').count).toBe(525);
    expect(mesh.geometry.index!.count / 3).toBe(960);
    const uv = mesh.geometry.getAttribute('uv');
    expect([uv.getX(0), uv.getY(0)]).toEqual([0, 0]);
    expect([uv.getX(FLAG_CAPE.columns), uv.getY(FLAG_CAPE.columns)]).toEqual([0, 1]);
    const hem = FLAG_CAPE.rows * (FLAG_CAPE.columns + 1);
    expect([uv.getX(hem), uv.getY(hem)]).toEqual([1, 0]);
    expect([uv.getX(uv.count - 1), uv.getY(uv.count - 1)]).toEqual([1, 1]);
    expect(FLAG_CAPE.length / FLAG_CAPE.width).toBeCloseTo(1.04 / .626);
    expect(flagCapeUv({ ...product.preview!.artwork!, crop: { x: 0, y: 0, width: 3000, height: 1 } })).toBeNull();
  });
  it('brings both original eyelet corners together at a visible front-side knot and drapes beyond the back', () => {
    const { mesh } = cape();
    const positions = mesh.geometry.getAttribute('position');
    const last = FLAG_CAPE.columns;
    expect(positions.getX(0)).toBeGreaterThan(.045);
    expect(positions.getX(last)).toBeGreaterThan(.045);
    expect(positions.getZ(0)).toBeLessThan(0);
    expect(positions.getZ(last)).toBeLessThan(0);
    expect(Math.hypot(positions.getX(0) - positions.getX(last), positions.getY(0) - positions.getY(last),
      positions.getZ(0) - positions.getZ(last))).toBeLessThan(.03);
    const firstEye = mesh.getObjectByName('flag-original-bottom-left-eyelet')!;
    const lastEye = mesh.getObjectByName('flag-original-top-left-eyelet')!;
    expect(firstEye.position.x).toBeGreaterThan(positions.getX(0));
    expect(lastEye.position.x).toBeGreaterThan(positions.getX(last));
    expect(firstEye.position.x - positions.getX(0)).toBeLessThan(.005);
    expect(lastEye.position.x - positions.getX(last)).toBeLessThan(.005);
    expect(mesh.getObjectByName('flag-cape-knot')).toBeDefined();
    expect(mesh.getObjectByName('flag-eyelet-connecting-tie')).toBeDefined();
    const center = Math.floor(FLAG_CAPE.columns / 2), hem = FLAG_CAPE.rows * (FLAG_CAPE.columns + 1) + center;
    const previous = hem - (FLAG_CAPE.columns + 1);
    // The extra length curls rearward over the seat, with a continuing sloped hem.
    expect(positions.getZ(hem)).toBeGreaterThan(.3);
    expect(positions.getY(hem)).toBeLessThan(.09);
    expect(Math.abs(positions.getY(hem) - positions.getY(previous))).toBeGreaterThan(.001);
    expect(positions.getZ(hem)).toBeGreaterThan(positions.getZ(previous));
  });
  it('keeps every neck attachment fixed through wind, steering, wheelies and landings', () => {
    const { bike, torso, mesh, update } = cape();
    const attribute = mesh.geometry.getAttribute('position');
    const positions = attribute.array as Float32Array;
    const attachment = Array.from(positions.slice(0, (FLAG_CAPE.columns + 1) * 3));
    const knot = mesh.getObjectByName('flag-cape-knot')!;
    const knotPosition = knot.position.toArray();
    const skeletonPosition = torso.position.toArray();
    for (let frame = 0; frame < 240; frame++) {
      bike.rotation.x = Math.sin(frame / 60) * 1.1; bike.rotation.z = Math.sin(frame / 30) * .2;
      update({ speed: 55, lateralAcceleration: Math.sin(frame / 18) * 18, landing: frame === 80 ? 1 : 0 }, 1 / 60);
      expect(Array.from(positions.slice(0, attachment.length))).toEqual(attachment);
      expect(torso.position.toArray()).toEqual(skeletonPosition);
      expect(knot.position.toArray()).toEqual(knotPosition);
    }
    expect(attribute.array).toBe(positions);
    for (let vertex = 0; vertex < attribute.count; vertex++) {
      const x = attribute.getX(vertex), y = attribute.getY(vertex), z = attribute.getZ(vertex);
      expect(Number.isFinite(x + y + z)).toBe(true);
      expect(Math.abs(x)).toBeLessThanOrEqual(.700001);
      expect(y).toBeGreaterThanOrEqual(-.460001); expect(y).toBeLessThanOrEqual(1.650001);
      expect(z).toBeGreaterThan(-.17); expect(z).toBeLessThanOrEqual(1.280001);
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
