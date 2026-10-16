import { expect, it } from 'vitest';
import { PAINTS, RIMS } from '../app/domain/config';
import { HELMET_COLORS, isHelmetColor } from '../app/domain/helmet';
import { visiblePalette, perceptualDistance } from '../app/domain/paletteView';

const rainbow = ['#e53935', '#f28c28', '#f1cf3a', '#36a85e', '#2878d4', '#494bb7', '#aa48c7'];
it.each([['paint', PAINTS], ['rims', RIMS], ['helmet', HELMET_COLORS]] as const)(
  'offers all seven distinct rainbow hues in the %s chooser without near duplicates', (_slot, options) => {
    const visible = visiblePalette(options);
    expect(visible.map(color => color.value)).toEqual(expect.arrayContaining(rainbow));
    for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++)
      expect(perceptualDistance(visible[i].value, visible[j].value)).toBeGreaterThanOrEqual(12);
  },
);
it('keeps a hidden legacy selected finish usable instead of deleting an owned color', () => {
  expect(isHelmetColor('#202324')).toBe(true);
  expect(visiblePalette(HELMET_COLORS, '#202324').some(color => color.value === '#202324')).toBe(true);
});
