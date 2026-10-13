import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { writeLoadingArtwork } from './loading-art-assets.mjs';

const output = resolve('outputs/loading-art');
const server = await createServer({ server: { host: '127.0.0.1', port: 5190, strictPort: true, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('http://127.0.0.1:5190/scripts/loading-art.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.body.dataset.ready === 'true', undefined, { timeout: 90000 });
  await mkdir(output, { recursive: true });
  const exports = [];
  for (const portrait of [false, true]) {
    const art = await page.evaluate(isPortrait => window.exportLoadingArt(isPortrait), portrait);
    const { proof } = art;
    const verticalLimit = portrait ? 0.44 : 0.58;
    if (proof.cartoon !== 'cartoon' || proof.outlines < 1 || proof.outlines > 32 || proof.contours > 10 ||
      !proof.headlightMaskContour || !proof.ankle || !proof.street ||
      proof.bounds[0] < -0.76 || proof.bounds[2] > 0.76 || proof.bounds[1] < -verticalLimit || proof.bounds[3] > verticalLimit)
      throw new Error('Loading artwork did not fit the current cartoon rider/street: ' + JSON.stringify(proof));
    const webp = Buffer.from(art.webp.split(',')[1], 'base64');
    await writeFile(resolve(output, portrait ? 'loading-portrait.png' : 'loading-desktop.png'), Buffer.from(art.png.split(',')[1], 'base64'));
    exports.push({ webp, proof });
  }
  if (errors.length) throw new Error('Loading artwork renderer failed: ' + errors.join('; '));
  const references = await writeLoadingArtwork(exports[0].webp, exports[1].webp, output);
  await writeFile(resolve(output, 'render-proof.json'), JSON.stringify({ references, crops: exports.map(art => art.proof) }, null, 2) + '\n');
  console.log('Current cartoon loading artwork:', references);
} finally {
  await browser?.close();
  await server.close();
}
