import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import type { Product } from '../app/domain/types';
import { newPlayer } from '../app/domain/progression';
import { decodePlayer } from '../app/services';
import {
  canEquip,
  equipConfiguration,
  initialConfiguration,
  previewLoadout,
  validConfiguration,
} from '../app/domain/preview';
const products: Product[] = JSON.parse(
  readFileSync('public/catalog/products.json', 'utf8'),
);
describe('temporary preview and explicit equip', () => {
  it('every locked wearable can be tried without changing coins, ownership or saved fields', () => {
    const player = { ...newPlayer(), coins: 0 };
    const original = structuredClone(player);
    for (const product of products.filter(
      (p) => p.category !== 'collectible',
    )) {
      const config = initialConfiguration(player, product);
      const preview = previewLoadout(player, product, config);
      expect(preview.equipped[product.category]).toBe(product.id);
      expect(preview.coins).toBe(0);
      expect(canEquip(player, product)).toBe(false);
      expect(equipConfiguration(player, product, config)).toBeNull();
    }
    expect(player).toEqual(original);
  });
  it('owned and IRL items require valid variants and numbers, with persistence after Equip', () => {
    const product = products.find((p) => p.handle === 'racing-zipper')!;
    const player = newPlayer();
    player.irlItems.push(product.id);
    const config = {
      ...initialConfiguration(player, product),
      customNumber: '07',
    };
    for (const number of ['', '123', 'A', '1.5'])
      expect(
        validConfiguration(product, { ...config, customNumber: number }),
      ).toBe(false);
    expect(
      equipConfiguration(player, product, {
        ...config,
        variantId: 'not-a-variant',
      }),
    ).toBeNull();
    const equipped = equipConfiguration(player, product, config)!;
    expect(
      decodePlayer(JSON.stringify(equipped)).customizations[product.id]
        .customNumber,
    ).toBe('07');
    expect(player.equipped.upper).toBeUndefined();
  });
  it('old v1 saves migrate additively, discarding invalid custom numbers', () => {
    const legacy = { ...newPlayer(), customizations: undefined };
    expect(decodePlayer(JSON.stringify(legacy)).customizations).toEqual({});
    expect(
      decodePlayer(
        JSON.stringify({
          ...legacy,
          customizations: {
            a: { customNumber: '72' },
            b: { customNumber: 'oops' },
          },
        }),
      ).customizations,
    ).toEqual({ a: { customNumber: '72' } });
  });
  it('every real variant has exactly one appearance and all mapped photos exist locally', () => {
    for (const product of products) {
      expect(
        product.preview!.colors.flatMap((c) => c.variantIds).sort(),
      ).toEqual(product.variants.map((v) => v.id).sort());
      for (const color of product.preview!.colors) {
        expect(color.front).toBeTruthy();
        for (const photo of [color.front, color.back])
          if (photo) expect(existsSync(`public${photo.localImage}`)).toBe(true);
      }
    }
  });
});
