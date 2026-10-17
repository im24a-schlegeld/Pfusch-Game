import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RacingNumberInput from '../app/ui/RacingNumberInput';

describe('native racing number selection', () => {
  it('offers a touch-native picker including zero, two digits and existing leading zeros', () => {
    const html = renderToStaticMarkup(createElement(RacingNumberInput, { label: 'Racing Nummer', value: '07', onChange: () => {} }));
    expect(html).toContain('<select');
    expect(html).toContain('value="0"');
    expect(html).toContain('value="99"');
    expect(html).toContain('value="07" selected=""');
    expect(html).not.toContain('disabled=""');
  });
  it('preserves an empty preview until a number is explicitly chosen', () => {
    const html = renderToStaticMarkup(createElement(RacingNumberInput, { label: 'Racing Nummer', value: '', onChange: () => {} }));
    expect(html).toContain('value="" selected=""');
  });
});
