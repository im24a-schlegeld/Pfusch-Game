import { readFile, rm, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeOfflineBundle } from './offline-assets.mjs';
import { loadingArtworkPlugin } from './loading-art-assets.mjs';

// Build the existing game unchanged and package only its server adapter for Oxygen.
// --verify uses this workspace's isolated dependency installation, never for deploys.
const root = fileURLToPath(new URL('../', import.meta.url));
const verify = process.argv.includes('--verify');
const { build } = await import(verify
  ? pathToFileURL(resolve(root, '.build-check/node_modules/vite/dist/node/index.js')).href
  : 'vite');
const clientDirectory = resolve(root, 'dist/client');
const shellFile = resolve(clientDirectory, 'index.html');
await build({
  root,
  configFile: resolve(root, verify ? '.build-check/vite.app.verify.config.ts' : 'vite.config.ts'),
  ...(verify ? { plugins: [loadingArtworkPlugin()] } : {}),
  base: '/',
  build: { outDir: clientDirectory, emptyOutDir: true, sourcemap: false },
});
await writeOfflineBundle(clientDirectory, { oxygen: true });
const shell = await readFile(shellFile, 'utf8');
await build({
  root,
  configFile: false,
  publicDir: false,
  plugins: [{
    name: 'wheelie-oxygen-shell',
    resolveId(id) {
      if (id === 'virtual:wheelie-shell') return '\0wheelie-shell';
      if (id.startsWith('node:')) throw new Error(`Node-only import in Oxygen worker: ${id}`);
    },
    load(id) { if (id === '\0wheelie-shell') return `export default ${JSON.stringify(shell)};`; },
  }],
  ssr: { target: 'webworker', noExternal: true },
  build: {
    target: 'es2022',
    ssr: resolve(root, 'server/oxygen/index.ts'),
    outDir: resolve(root, 'dist/server'),
    emptyOutDir: true,
    sourcemap: false,
    minify: true,
    rolldownOptions: { output: { entryFileNames: 'index.js', inlineDynamicImports: true } },
  },
});
const workerFile = resolve(root, 'dist/server/index.js');
if ((await stat(workerFile)).size > 10 * 1024 * 1024) throw new Error('Oxygen worker exceeds 10 MB');
// Root HTML must pass through the worker, which adds the public runtime mode and
// security headers. An asset copy could bypass that initialization.
await rm(shellFile);
console.log('Oxygen package ready: dist/client assets + dist/server/index.js worker');
