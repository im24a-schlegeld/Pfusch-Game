import { spawnSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Reuse checked-in immutable loading assets for an update that changes ONLY
// access, reward logic, sticker-workshop UI and tests; render afresh for other files.
async function canReuseArtwork() {
  if (process.env.GITHUB_ACTIONS !== 'true') return false;
  const change = spawnSync('git', ['diff', '--name-only', 'HEAD^', 'HEAD'], { encoding: 'utf8' });
  if (change.status !== 0 || !change.stdout.trim()) return false;
  const safe = /^(?:server\/|tests\/|docs\/|app\/services\/|app\/ui\/(?:GameApp|SaveAccessGate|RealRewardCard|StickerWorkshop)\.tsx$|scripts\/verify-oxygen-build\.mjs$|\.github\/workflows\/oxygen-deployment-1000181783\.yml$)/;
  if (!change.stdout.trim().split('\n').every(file => safe.test(file.trim()))) return false;
  try {
    const data = JSON.parse(await readFile('app/ui/loadingArtwork.json', 'utf8'));
    for (const value of [data.desktop, data.portrait]) {
      if (typeof value !== 'string' || !/^\/branding\/loading-trailer(?:-portrait)?\.[a-f0-9]{10}\.webp$/.test(value)) return false;
      await access(resolve('public' + value));
    }
    return true;
  } catch { return false; }
}

const steps = [
  ...((await canReuseArtwork()) ? [] : [['node', ['scripts/render-loading-art.mjs']]]),
  ['npm', ['run', 'build:oxygen']],
  ['npx', ['playwright', 'test', '--config=playwright.offline.config.ts']],
];
for (const [command, args] of steps) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true });
  if (result.error) console.error(result.error.message);
  if (result.error || result.status !== 0) process.exit(result.status ?? 1);
}
