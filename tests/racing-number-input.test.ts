import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RacingNumberInput, { normalizeRacingNumber } from '../app/ui/RacingNumberInput';

describe('cross-device racing number entry', () => {
  it('provides a mobile numeric keyboard and editable, 2-digit text field', () => {
    const html = renderToStaticMarkup(createElement(RacingNumberInput, { label: 'Racing Zipper Nummer', value: '07', onChange: () => {} }));
    expect(html).toContain('<input');
    expect(html).toMatch(/inputmode="numeric"/i);
    expect(html).toMatch(/maxlength="2"/i);
    expect(html).toMatch(/type="text"/);
    expect(html).toContain('value="07"');
    expect(html).not.toContain('disabled');
  });
  it('supports empty drafts, single digits and leading zeros', () => {
    const html = renderToStaticMarkup(createElement(RacingNumberInput, { label: 'Racing Nummer', value: '', onChange: () => {} }));
    expect(html).toContain('value=""');
    expect(normalizeRacingNumber('')).toBe('');
    expect(normalizeRacingNumber('0')).toBe('0');
    expect(normalizeRacingNumber('07')).toBe('07');
    expect(normalizeRacingNumber('99')).toBe('99');
  });
  it('strips other characters and limits paste to two ASCII digits', () => {
    expect(normalizeRacingNumber('a0-7-99')).toBe('07');
    expect(normalizeRacingNumber('1234')).toBe('12');
    expect(normalizeRacingNumber('§ab')).toBe('');
  });
});
