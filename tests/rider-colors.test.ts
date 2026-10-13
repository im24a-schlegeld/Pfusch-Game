import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { DARK_CARBON } from '../app/domain/carbon';
import { commitGarageEdit, garageAppearance, garageEditChanged, garageOffer } from '../app/domain/garageEdit';
import { guestInventory } from '../app/domain/guestInventory';
import { newPlayer } from '../app/domain/progression';
import { DEFAULT_PANTS_COLOR, DEFAULT_SHOES_COLOR, getPantsColor, getShoesColor, PANTS_COLORS, RIDER_COLORS } from '../app/domain/riderColors';
import { applySetup, saveSetup } from '../app/domain/setups';
import { createPreviewColorUpdater, previewGeometryKey } from '../app/game/previewAppearance';
import { decodePlayer } from '../app/services';
import { digitalPlayer } from '../app/services/shopifyCloud';
import { sanitizeDigitalPlayer } from '../server/shopify/playerValidation';

describe('separate rider wardrobe colours', () => {
  it('previews one part without saving or charging and equips only explicit valid selections', () => {
    const player = { ...newPlayer(), coins: 0 };
    const draft = { kind: 'pantsColor', value: '#627dac' } as const;
    expect(garageAppearance(player, draft, []).pantsColor).toBe('#627dac');
    expect(player.pantsColor).toBe(DEFAULT_PANTS_COLOR);
    expect(garageAppearance(player, null, [])).toBe(player);
    expect(garageOffer(player, draft, [])).toMatchObject({ price: 0, owned: true, blocked: null });
    const pants = commitGarageEdit(player, draft, [])!;
    expect(pants.pantsColor).toBe('#627dac');
    expect(pants.shoesColor).toBe(DEFAULT_SHOES_COLOR);
    const shoes = commitGarageEdit(pants, { kind: 'shoesColor', value: '#b83232' }, [])!;
    expect(shoes).toMatchObject({ pantsColor: '#627dac', shoesColor: '#b83232', coins: 0 });
    expect(shoes.ownedItems).toEqual(player.ownedItems);
    expect(garageEditChanged(shoes, { kind: 'shoesColor', value: '#b83232' }, [])).toBe(false);
    for (const value of [DARK_CARBON, '#abcdef', 'red', 'url(x)']) {
      expect(commitGarageEdit(player, { kind: 'pantsColor', value }, [])).toBeNull();
      expect(commitGarageEdit(player, { kind: 'shoesColor', value }, [])).toBeNull();
    }
    expect(RIDER_COLORS.some(color => String(color.value) === DARK_CARBON)).toBe(false);
  });

  it('offers only black, gray and denim trousers while keeping the full shoe palette', () => {
    const player = { ...newPlayer(), coins: 0 };
    const supported = ['#242d31', '#141c20', '#7a8389', '#315877', '#627dac'];
    expect(PANTS_COLORS.map(color => color.value)).toEqual(supported);
    for (const value of supported) {
      expect(garageOffer(player, { kind: 'pantsColor', value }, []).blocked).toBeNull();
      expect(commitGarageEdit(player, { kind: 'pantsColor', value }, [])).toMatchObject({ pantsColor: value, coins: 0 });
    }
    for (const value of ['#e6e4dd', '#c7ad85', '#6e7856', '#7461a5', '#b83232', '#dc632e', '#d1b345']) {
      expect(garageOffer(player, { kind: 'pantsColor', value }, []).blocked).not.toBeNull();
      expect(commitGarageEdit(player, { kind: 'pantsColor', value }, [])).toBeNull();
      expect(getPantsColor({ pantsColor: value })).toBe(DEFAULT_PANTS_COLOR);
      expect(commitGarageEdit(player, { kind: 'shoesColor', value }, [])).toMatchObject({ shoesColor: value, coins: 0 });
    }
  });

  it('migrates schema1 independently, preserves guest/cloud colours and rejects unsupported server input', () => {
    const legacy = { ...newPlayer(), coins: 872, highScore: 64000 };
    delete legacy.pantsColor; delete legacy.shoesColor;
    for (const recovered of [decodePlayer(JSON.stringify(legacy)), sanitizeDigitalPlayer(legacy, '123')]) {
      expect(recovered).toMatchObject({ version: 1, coins: 872, highScore: 64000,
        pantsColor: DEFAULT_PANTS_COLOR, shoesColor: DEFAULT_SHOES_COLOR });
    }
    expect(getPantsColor({})).toBe(DEFAULT_PANTS_COLOR);
    expect(getShoesColor({})).toBe(DEFAULT_SHOES_COLOR);
    const selected = { ...legacy, pantsColor: '#315877', shoesColor: '#dc632e' };
    const saved = decodePlayer(JSON.stringify(selected));
    for (const next of [saved, guestInventory(saved, []), sanitizeDigitalPlayer(digitalPlayer(saved, '123'), '123')]) {
      expect(next).toMatchObject({ pantsColor: '#315877', shoesColor: '#dc632e', coins: 872, highScore: 64000 });
    }
    expect(decodePlayer(JSON.stringify({ ...selected, pantsColor: DARK_CARBON })).pantsColor).toBe(DEFAULT_PANTS_COLOR);
    expect(decodePlayer(JSON.stringify({ ...selected, pantsColor: DARK_CARBON })).shoesColor).toBe('#dc632e');
    expect(decodePlayer(JSON.stringify({ ...selected, pantsColor: '#7461a5', shoesColor: '#7461a5' })))
      .toMatchObject({ version: 1, pantsColor: DEFAULT_PANTS_COLOR, shoesColor: '#7461a5', coins: 872, highScore: 64000 });
    expect(() => sanitizeDigitalPlayer({ ...selected, shoesColor: DARK_CARBON }, '123')).toThrow();
  });

  it('captures both committed colours in setups and supports old setups without colour fields', () => {
    const original = { ...newPlayer(), pantsColor: '#627dac', shoesColor: '#c7ad85' };
    const saved = saveSetup(original, 'Farben', 'colors')!;
    const cloud = sanitizeDigitalPlayer(saved, '123');
    const changed = { ...cloud, pantsColor: '#b83232', shoesColor: '#141c20', coins: 950 };
    expect(applySetup(changed, 'colors', [])).toMatchObject({ pantsColor: '#627dac', shoesColor: '#c7ad85', coins: 950 });
    delete saved.savedSetups[0].appearance.pantsColor;
    delete saved.savedSetups[0].appearance.shoesColor;
    expect(applySetup(saved, 'colors', [])).toMatchObject({ pantsColor: DEFAULT_PANTS_COLOR, shoesColor: DEFAULT_SHOES_COLOR });
  });

  it('normalizes an old colorful trouser selection without losing its saved setup or progress', () => {
    const saved = saveSetup({ ...newPlayer(), coins: 872, highScore: 64000, shoesColor: '#7461a5' }, 'Altes Outfit', 'legacy')!;
    saved.savedSetups[0].appearance.pantsColor = '#b83232';
    const recovered = decodePlayer(JSON.stringify(saved));
    expect(recovered.savedSetups).toHaveLength(1);
    expect(recovered.savedSetups[0]).toMatchObject({ id: 'legacy', name: 'Altes Outfit',
      appearance: { pantsColor: DEFAULT_PANTS_COLOR, shoesColor: '#7461a5' } });
    expect(applySetup(recovered, 'legacy', [])).toMatchObject({ version: 1, coins: 872, highScore: 64000,
      pantsColor: DEFAULT_PANTS_COLOR, shoesColor: '#7461a5' });
  });

  it('updates only tagged pants/shoe materials without changing geometry, gloves or sole detail', () => {
    const player = newPlayer();
    const body = new Group(), rider = new Group();
    body.add(rider);
    const geometry = new BoxGeometry();
    const pants = new MeshStandardMaterial({ color: DEFAULT_PANTS_COLOR });
    const shoes = new MeshStandardMaterial({ color: DEFAULT_SHOES_COLOR });
    const gloves = new MeshStandardMaterial({ color: '#141c20' });
    const soles = new MeshStandardMaterial({ color: '#b6b3a9' });
    pants.userData.appearanceColorSlot = 'pantsColor';
    shoes.userData.appearanceColorSlot = 'shoesColor';
    for (const material of [pants, shoes, gloves, soles]) rider.add(new Mesh(geometry, material));
    const update = createPreviewColorUpdater(body, rider, player);
    const selected = { ...player, pantsColor: '#627dac', shoesColor: '#b83232' };
    expect(previewGeometryKey(selected)).toBe(previewGeometryKey(player));
    expect(update(selected)).toBe(true);
    expect(update(selected)).toBe(false);
    expect(pants.color.getHexString()).toBe('627dac');
    expect(shoes.color.getHexString()).toBe('b83232');
    expect(gloves.color.getHexString()).toBe('141c20');
    expect(soles.color.getHexString()).toBe('b6b3a9');
    expect(rider.children.every(child => (child as Mesh).geometry === geometry)).toBe(true);
    update({ ...selected, pantsColor: '#7461a5', shoesColor: '#7461a5' });
    expect(pants.color.getHexString()).toBe(DEFAULT_PANTS_COLOR.slice(1));
    expect(shoes.color.getHexString()).toBe('7461a5');
    const legacy = { ...player }; delete legacy.pantsColor; delete legacy.shoesColor;
    update(legacy);
    expect(pants.color.getHexString()).toBe(DEFAULT_PANTS_COLOR.slice(1));
    expect(shoes.color.getHexString()).toBe(DEFAULT_SHOES_COLOR.slice(1));
    geometry.dispose();
    for (const material of [pants, shoes, gloves, soles]) material.dispose();
  });
});
