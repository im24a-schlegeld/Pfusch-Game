import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-wasm';
import { expect, it } from 'vitest';
import { writeOfflineBundle } from '../scripts/offline-assets.mjs';

it('ships the supplied Wheelie Escape title in square icons with opaque, safe maskable margins', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'pfusch-app-icon-'));
  try {
    for (const path of ['images/artwork/signs.png', 'images/stop-sign.png', 'branding/wheelie-escape-wordmark-a.png']) {
      await mkdir(resolve(directory, path, '..'), { recursive: true });
      await writeFile(resolve(directory, path), await readFile(resolve('public', path)));
    }
    await writeFile(resolve(directory, 'index.html'), '<head></head><img src="/branding/loading-trailer.123abc.webp"><img src="/branding/loading-trailer-portrait.123abc.webp">');
    await writeFile(resolve(directory, 'sw.js'), 'const manifest = /* PFUSCH_OFFLINE_BUILD */ null;');
    await writeOfflineBundle(directory);
    for (const size of [192, 512]) {
      const png = await readFile(resolve(directory, `app-icon-${size}.png`));
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size]);
      const decoder = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><image width="${size}" height="${size}" href="data:image/png;base64,${png.toString('base64')}"/></svg>`);
      const decoded = decoder.render();
      const pixels = decoded.pixels;
      let titlePixels = 0, unsafeArtworkPixels = 0, transparentPixels = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const offset = (y * size + x) * 4;
        const [r, g, b, a] = pixels.slice(offset, offset + 4);
        if (a !== 255) transparentPixels++;
        if (y > size * .64 && y < size * .74 && r > 220 && g > 220 && b > 220) titlePixels++;
        if (Math.hypot(x - size / 2, y - size / 2) > size * .4 + 1 && (r !== 50 || g !== 50 || b !== 50)) unsafeArtworkPixels++;
      }
      expect(titlePixels).toBeGreaterThan(size);
      expect(transparentPixels).toBe(0);
      expect(unsafeArtworkPixels).toBe(0);
      if (size === 512) {
        // The STOP artwork has rectangular source corners; GameBrand clips it
        // to an octagon. Its exposed top-right corner must reveal the canvas.
        const corner = (264 * size + 430) * 4;
        expect(Array.from(pixels.subarray(corner, corner + 4))).toEqual([50, 50, 50, 255]);
        let red = 0, white = 0;
        for (let y = 266; y < 284; y++) for (let x = 414; x < 428; x++) {
          const offset = (y * size + x) * 4;
          if (pixels[offset] > 130 && pixels[offset + 1] < 80 && pixels[offset + 2] < 80) red++;
          if (pixels[offset] > 220 && pixels[offset + 1] > 220 && pixels[offset + 2] > 220) white++;
        }
        expect(red).toBeGreaterThan(25);
        expect(white).toBeGreaterThan(5);
      }
      decoded.free(); decoder.free();
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
