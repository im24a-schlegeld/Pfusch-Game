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
  it('uses the untouched catalog artwork and exact interior UV crop on both sides', () => {
    const { mesh, texture, loader } = cape();
    expect(loader).toHaveBeenCalledWith(product.preview!.artwork!.localImage);
    expect(texture.offset.toArray()).toEqual([.0775, .24]);
    expect(texture.repeat.toArray()).toEqual([.86, .5175]);
    expect(texture.flipY).toBe(true);
    expect(mesh.material.side).toBe(DoubleSide);
    expect(mesh.material.color.getHexString()).toBe('ffffff');
    expect(mesh.geometry.getAttribute('position').count).toBe(525);
    expect(mesh.geometry.index!.count / 3).toBe(960);
    expect(flagCapeUv({ ...product.preview!.artwork!, crop: { x: 0, y: 0, width: 3000, height: 1 } })).toBeNull();
  });
  it('keeps every neck attachment fixed through wind, steering, wheelies and landings', () => {
    const { bike, torso, mesh, update } = cape();
    const attribute = mesh.geometry.getAttribute('position');
    const positions = attribute.array as Float32Array;
    const attachment = Array.from(positions.slice(0, (FLAG_CAPE.columns + 1) * 3));
    const skeletonPosition = torso.position.toArray();
    for (let frame = 0; frame < 240; frame++) {
      bike.rotation.x = Math.sin(frame / 60) * 1.1; bike.rotation.z = Math.sin(frame / 30) * .2;
      update({ speed: 55, lateralAcceleration: Math.sin(frame / 18) * 18, landing: frame === 80 ? 1 : 0 }, 1 / 60);
      expect(Array.from(positions.slice(0, attachment.length))).toEqual(attachment);
      expect(torso.position.toArray()).toEqual(skeletonPosition);
    }
    expect(attribute.array).toBe(positions);
    for (let vertex = 0; vertex < attribute.count; vertex++) {
      const x = attribute.getX(vertex), y = attribute.getY(vertex), z = attribute.getZ(vertex);
      expect(Number.isFinite(x + y + z)).toBe(true);
      expect(Math.abs(x)).toBeLessThanOrEqual(.700001);
      expect(y).toBeGreaterThanOrEqual(-.065001); expect(y).toBeLessThanOrEqual(1.350001);
      expect(z).toBeGreaterThan(.10); expect(z).toBeLessThanOrEqual(1.150001);
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
