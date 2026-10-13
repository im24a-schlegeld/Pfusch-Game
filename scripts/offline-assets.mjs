import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 20);
const publicAsset = /\.(?:js|css|woff2|png|jpe?g|webp|svg|json|bin|webmanifest)$/i;
export function isCoreOfflineAsset(url, loadingImages) {
  return /^\/assets\/.*\.(js|css)$/.test(url) || /^\/fonts\/.*\.woff2$/.test(url)
    || /^\/models\/(ciao|moped|fs450|r6|nitro)\/.*\.(json|bin|png|jpe?g|webp)$/.test(url)
    || /^\/assets\/signs\/.*\.png$/.test(url)
    || (/^\/branding\/loading-trailer(?:-portrait)?\.[a-f0-9]+\.webp$/.test(url) && (!loadingImages || loadingImages.has(url)))
    || ['/offline.html', '/manifest.webmanifest', '/app-icon-192.png', '/app-icon-512.png', '/branding/pfusch-logo.webp',
      '/branding/wheelie-escape-wordmark-a.png', '/images/artwork/signs.png', '/images/stop-sign.png',
      '/textures/carbon-dark.jpg', '/catalog/products.json'].includes(url);
}
export function isOptionalOfflineAsset(url) {
  return /^\/images\/[\w/.-]+\.(png|jpe?g|webp)$/.test(url);
}

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else result.push(path);
  }
  return result;
}

/** Emit a public shell: the raw build has no customer ID, tokens or server response. */
let renderer;
export async function writeOfflineBundle(directory, { oxygen = false } = {}) {
  const html = await readFile(resolve(directory, 'index.html'), 'utf8');
  const runtime = '<script type="application/json" id="pfusch-runtime-config">{"version":1,"mode":"oxygen"}</script>';
  await writeFile(resolve(directory, 'offline.html'), oxygen ? html.replace('</head>', `${runtime}</head>`) : html);
  // Reuse supplied artwork without generating or changing the brand image.
  const artwork = (await readFile(resolve(directory, 'images/artwork/signs.png'))).toString('base64');
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="80" fill="#323232"/><image href="data:image/png;base64,${artwork}" x="38" y="170" width="436" height="145"/></svg>`;
  renderer ??= readFile(fileURLToPath(import.meta.resolve('@resvg/resvg-wasm/index_bg.wasm'))).then(initWasm);
  await renderer;
  for (const size of [192, 512]) {
    const image = new Resvg(icon, { fitTo: { mode: 'width', value: size } });
    const rendered = image.render();
    await writeFile(resolve(directory, `app-icon-${size}.png`), rendered.asPng());
    rendered.free(); image.free();
  }
  const core = [], optional = [];
  // Keep only the two crops actually shipped in the shell, even when the public
  // directory retains older immutable exports for existing deployments.
  const loadingImages = new Set(html.match(/\/branding\/loading-trailer(?:-portrait)?\.[a-f0-9]+\.webp/g) ?? []);
  if (loadingImages.size !== 2) throw new Error('Offline shell must reference both current loading crops.');
  for (const path of await files(directory)) {
    const url = '/' + relative(directory, path).split(sep).join('/');
    if (!publicAsset.test(url) && url !== '/offline.html') continue;
    const target = isCoreOfflineAsset(url, loadingImages) ? core : isOptionalOfflineAsset(url) ? optional : null;
    if (!target) continue;
    const bytes = await readFile(path);
    target.push({ url, revision: hash(bytes), bytes: bytes.length });
  }
  core.sort((a, b) => a.url.localeCompare(b.url));
  optional.sort((a, b) => a.url.localeCompare(b.url));
  const coreBytes = core.reduce((sum, file) => sum + file.bytes, 0);
  const optionalBytes = optional.reduce((sum, file) => sum + file.bytes, 0);
  if (core.length > 160 || coreBytes > 32 * 1024 * 1024 || optional.length > 256 || optionalBytes > 40 * 1024 * 1024)
    throw new Error('Offline package exceeds its bounded asset budget; review newly added files.');
  const manifest = { version: hash(JSON.stringify({ core, optional })), core, optional, coreBytes };
  const swPath = resolve(directory, 'sw.js');
  const source = await readFile(swPath, 'utf8');
  if (!source.includes('/* PFUSCH_OFFLINE_BUILD */ null')) throw new Error('Offline worker build marker missing.');
  await writeFile(swPath, source.replace('/* PFUSCH_OFFLINE_BUILD */ null', JSON.stringify(manifest)));
}

/** Normal static builds remain local-only; Oxygen supplies its public mode separately.
 * @returns {import('vite').Plugin}
 */
export function offlineAssetsPlugin() {
  let output;
  return {
    name: 'pfusch-offline-assets', apply: 'build', enforce: 'post',
    configResolved(config) { output = resolve(config.root, config.build.outDir); },
    async closeBundle() {
      // build-oxygen writes its bundle after adding the Oxygen runtime marker.
      if (!process.argv.some((argument) => argument.endsWith('build-oxygen.mjs'))) await writeOfflineBundle(output);
    },
  };
}
