import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = resolve(root, 'app/ui/loadingArtwork.json');
const imageHash = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 10);

/** The two crops change independently, including installed offline copies. */
export function artworkReferences(desktop, portrait) {
  return {
    desktop: `/branding/loading-trailer.${imageHash(desktop)}.webp`,
    portrait: `/branding/loading-trailer-portrait.${imageHash(portrait)}.webp`,
  };
}

export function replaceLoadingArtwork(html, artwork) {
  for (const key of ['desktop', 'portrait'])
    if (!/^\/branding\/loading-trailer(?:-portrait)?\.[a-f0-9]{10}\.webp$/.test(artwork[key]))
      throw new Error(`Invalid loading artwork reference: ${key}`);
  return html.replaceAll('__PFUSCH_LOADING_DESKTOP__', artwork.desktop)
    .replaceAll('__PFUSCH_LOADING_PORTRAIT__', artwork.portrait);
}

/** HTML and the React JSON import share this manifest; CI never edits HTML/TSX.
 * @returns {import('vite').Plugin}
 */
export function loadingArtworkPlugin() {
  return {
    name: 'pfusch-loading-artwork',
    transformIndexHtml: {
      order: 'pre',
      async handler(html) {
        const artwork = JSON.parse(await readFile(manifestPath, 'utf8'));
        return replaceLoadingArtwork(html, artwork);
      },
    },
  };
}

export async function writeLoadingArtwork(desktop, portrait, artifactDirectory) {
  const artwork = artworkReferences(desktop, portrait);
  await mkdir(artifactDirectory, { recursive: true });
  for (const [key, bytes] of [['desktop', desktop], ['portrait', portrait]]) {
    if (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.length < 10000)
      throw new Error(`Loading ${key} export is not a complete WebP image`);
    await writeFile(resolve(root, 'public' + artwork[key]), bytes);
    await writeFile(resolve(artifactDirectory, basename(artwork[key])), bytes);
  }
  const json = JSON.stringify(artwork, null, 2) + '\n';
  await writeFile(manifestPath, json);
  await writeFile(resolve(artifactDirectory, 'loadingArtwork.json'), json);
  return artwork;
}
