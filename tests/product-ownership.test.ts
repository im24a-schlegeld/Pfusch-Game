import { describe, expect, it } from 'vitest';
import type { Product } from '../app/domain/types';
import { newPlayer } from '../app/domain/progression';
import { commitGarageEdit, garageOffer } from '../app/domain/garageEdit';
import { equipConfiguration, initialConfiguration } from '../app/domain/preview';
import { migrateProductInventory, ownsProductColor, productColorKey } from '../app/domain/productOwnership';
import { DEFAULT_HELMET_COLOR, DEFAULT_VISOR_COLOR, equipHelmet, helmetOptionPrice, migrateHelmetInventory } from '../app/domain/helmet';

const product: Product = { id: '123', title: 'Shirt', handle: 'shirt', category: 'upper', price: 30, currency: 'CHF',
  image: '', images: [], url: '', type: '', description: '', baseColor: '#000000', available: true,
  options: [{ name: 'Color', values: ['Black', 'White'] }, { name: 'Size', values: ['S', 'M'] }],
  variants: ['9007199254740993', '9007199254740994', '9007199254740995'].map((id, index) => ({ id,
    title: id, available: true, price: 30, options: index < 2 ? ['Black', index ? 'M' : 'S'] : ['White', 'S'] })) };
const [blackS, blackM, white] = product.variants.map(variant => variant.id);
const edit = (variantId: string) => ({ kind: 'product' as const, productId: product.id, configuration: { productId: product.id, variantId } });

describe('color-specific ownership', () => {
  it('charges once per color, shares sizes, and never unlocks another color through Equip', () => {
    const player = { ...newPlayer(), coins: 500 };
    const black = commitGarageEdit(player, edit(blackS), [product])!;
    expect(black.coins).toBe(350);
    expect(ownsProductColor(black, product, blackM)).toBe(true);
    expect(commitGarageEdit(black, edit(blackM), [product])!.coins).toBe(350);
    expect(ownsProductColor(black, product, white)).toBe(false);
    expect(equipConfiguration(black, product, edit(white).configuration)).toBeNull();
    expect(garageOffer(black, edit(white), [product]).owned).toBe(false);
    const both = commitGarageEdit(black, edit(white), [product])!;
    expect(both.coins).toBe(200);
    expect(ownsProductColor(both, product, blackS)).toBe(true);
    expect(commitGarageEdit(both, edit(white), [product])!.coins).toBe(200);
  });
  it('migrates only the remembered legacy color, keeping string variant IDs intact', () => {
    const legacy = { ...newPlayer(), ownedItems: [product.id], variants: { [product.id]: white } };
    const migrated = migrateProductInventory(legacy, [product]);
    expect(migrated.ownedItems).toContain(productColorKey(product, white));
    expect(ownsProductColor(migrated, product, blackS)).toBe(false);
    expect(migrateProductInventory(migrated, [product])).toBe(migrated);
  });
  it('equips the purchased shop color for free while other colors remain paid', () => {
    const player = { ...newPlayer(), coins: 0, irlItems: [product.id, productColorKey(product, white)] };
    expect(initialConfiguration(player, product).variantId).toBe(white);
    expect(commitGarageEdit(player, edit(white), [product])!.coins).toBe(0);
    expect(commitGarageEdit(player, edit(blackS), [product])).toBeNull();
  });
});

describe('helmet prices', () => {
  it('keeps the integral and default finish free, atomically charges paid selections once', () => {
    const free = { helmet: 'fullface' as const, helmetColor: DEFAULT_HELMET_COLOR, helmetVisor: DEFAULT_VISOR_COLOR };
    expect(equipHelmet({ ...newPlayer(), coins: 0 }, free)?.coins).toBe(0);
    const selection = { helmet: 'motocross' as const, helmetColor: '#202324', helmetVisor: '#287a9d' };
    expect(equipHelmet({ ...newPlayer(), coins: 249 }, selection)).toBeNull();
    const paid = equipHelmet({ ...newPlayer(), coins: 250 }, selection)!;
    expect(paid.coins).toBe(0);
    expect(equipHelmet(paid, selection)).toEqual(paid);
    expect(helmetOptionPrice('helmetColor', 'carbon-dark')).toBe(1000);
  });
  it('grandfathers only already equipped legacy helmet options once', () => {
    const legacy = { ...newPlayer(), ownedItems: [], helmet: 'motocross' as const, helmetColor: '#202324' };
    const migrated = migrateHelmetInventory(legacy);
    expect(migrated.ownedItems).toEqual(expect.arrayContaining(['helmet:motocross', 'helmetColor:#202324']));
    expect(migrateHelmetInventory(migrated)).toBe(migrated);
  });
});
