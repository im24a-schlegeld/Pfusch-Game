import { describe, expect, it } from 'vitest';
import { splitSignArtworkPixels } from '../app/game/signArtwork';

describe('original PFUSCH print edges', () => {
  it('keeps red neighbouring print pixels out of collected blue U/C circles', () => {
    const width = 9, source = new Uint8ClampedArray(width * 4);
    for (let x = 0; x < width; x++) source.set([20, 80, 190, 255], x * 4);
    source.set([240, 15, 10, 181], 1 * 4);
    source.set([210, 20, 15, 207], 6 * 4);
    const masks = Array.from({ length: 6 }, () => new Uint8ClampedArray(source.length));
    masks[2][1 * 4 + 3] = 255;
    masks[4][6 * 4 + 3] = 255;
    const layers = splitSignArtworkPixels(width, 1, source, masks);
    const at = (index: number, x: number) => {
      const layer = layers[index], offset = ((-layer.y) * layer.width + x - layer.x) * 4;
      return Array.from(layer.pixels.slice(offset, offset + 4));
    };
    expect(at(1, 1)).toEqual([240, 15, 10, 181]);
    expect(at(3, 6)).toEqual([210, 20, 15, 207]);
    expect(at(2, 1)[3]).toBe(0);
    expect(at(4, 6)[3]).toBe(0);
  });
  it('reassembles every original edge and overlap pixel exactly, without double alpha', () => {
    const width = 4, height = 3;
    const source = new Uint8ClampedArray(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel++) {
      source.set([20 + pixel, 60 + pixel, 100 + pixel, pixel % 2 ? 77 : 255], pixel * 4);
    }
    const masks = Array.from({ length: 6 }, () => new Uint8ClampedArray(source.length));
    // Approximate paths omit the print's translucent top/bottom outlines.
    masks[0][(width + 0) * 4 + 3] = 255;
    masks[1][(width + 1) * 4 + 3] = 128;
    masks[2][(width + 1) * 4 + 3] = 128;
    masks[5][(width + 3) * 4 + 3] = 255;
    const layers = splitSignArtworkPixels(width, height, source, masks);
    const reconstructed = new Uint8ClampedArray(source.length);
    const ownership = new Uint8Array(width * height);
    layers.forEach(layer => {
      for (let y = 0; y < layer.height; y++) for (let x = 0; x < layer.width; x++) {
        const offset = (y * layer.width + x) * 4;
        if (!layer.pixels[offset + 3]) continue;
        const pixel = (y + layer.y) * width + x + layer.x;
        ownership[pixel]++;
        reconstructed.set(layer.pixels.subarray(offset, offset + 4), pixel * 4);
      }
    });
    expect(reconstructed).toEqual(source);
    expect([...ownership]).toEqual(Array(width * height).fill(1));
    // The U above F owns the original overlap pixel; F cannot brighten it.
    const colorAt = (index: number, x: number, y: number) => {
      const layer = layers[index], offset = ((y - layer.y) * layer.width + x - layer.x) * 4;
      return Array.from(layer.pixels.slice(offset, offset + 4));
    };
    expect(colorAt(2, 1, 1)).toEqual(Array.from(source.slice(20, 24)));
    expect(layers[1].pixels.every(value => value === 0)).toBe(true);
    expect(layers[0].x).toBeLessThan(0);
    expect(layers[0].y).toBeLessThan(0);
  });
});
