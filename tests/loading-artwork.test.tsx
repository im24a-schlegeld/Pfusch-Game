import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LoadingScreen from '../app/ui/LoadingScreen';
import artwork from '../app/ui/loadingArtwork.json';
import { artworkReferences, replaceLoadingArtwork } from '../scripts/loading-art-assets.mjs';
import { isCoreOfflineAsset } from '../scripts/offline-assets.mjs';

const desktop = readFileSync(new URL(`../public${artwork.desktop}`, import.meta.url));
const portrait = readFileSync(new URL(`../public${artwork.portrait}`, import.meta.url));

describe('one current loading artwork for every entry point', () => {
  it('gives each crop an immutable content address, changing only the modified image', () => {
    const first = artworkReferences(desktop, portrait);
    expect(first).toEqual(artwork);
    expect(artworkReferences(desktop, portrait)).toEqual(first);
    const changed = artworkReferences(Buffer.concat([desktop, Buffer.from('new art')]), portrait);
    expect(changed.desktop).not.toBe(first.desktop);
    expect(changed.portrait).toBe(first.portrait);
  });

  it('uses those same existing images in React, boot picture, preloads and social cards', () => {
    for (const path of [artwork.desktop, artwork.portrait]) {
      const bytes = readFileSync(new URL(`../public${path}`, import.meta.url));
      const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 10);
      expect(path).toContain(`.${hash}.webp`);
      expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
    }
    const react = renderToStaticMarkup(<LoadingScreen fullScreen />);
    const html = replaceLoadingArtwork(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), artwork);
    expect(react).toContain(`src="${artwork.desktop}"`);
    expect(react.toLowerCase()).toContain(`srcset="${artwork.portrait}"`);
    expect(html).not.toMatch(/__PFUSCH_LOADING_/);
    expect(html).toContain(`class="boot-art" src="${artwork.desktop}"`);
    expect(html).toContain(`srcset="${artwork.portrait}"`);
    expect(html).toContain(`as="image" href="${artwork.desktop}"`);
    expect(html).toContain(`as="image" href="${artwork.portrait}"`);
    expect(html).toContain(`property="og:image" content="https://game.pfusch-clothing.ch${artwork.desktop}"`);
    expect(html).toContain(`name="twitter:image" content="https://game.pfusch-clothing.ch${artwork.desktop}"`);
  });

  it('caches only the referenced crops, so a previous phone loading image cannot remain current', () => {
    const current = new Set([artwork.desktop, artwork.portrait]);
    expect(isCoreOfflineAsset(artwork.desktop, current)).toBe(true);
    expect(isCoreOfflineAsset(artwork.portrait, current)).toBe(true);
    expect(isCoreOfflineAsset('/branding/loading-trailer-portrait.aaaaaaaaaa.webp', current)).toBe(false);
    expect(isCoreOfflineAsset('/branding/loading-trailer.webp', current)).toBe(false);
    expect(isCoreOfflineAsset('/branding/loading-wheelie-portrait.webp', current)).toBe(false);
    expect(isCoreOfflineAsset('/models/fs450/model.bin', current)).toBe(true);
  });
});
