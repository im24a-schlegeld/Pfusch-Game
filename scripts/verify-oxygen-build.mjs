import { spawnSync } from 'node:child_process';

// Oxygen deploys these exact built files only after the real offline browser check.
for (const [command, args] of [
  ['npm', ['run', 'build:oxygen']],
  ['npx', ['playwright', 'test', '--config=playwright.offline.config.ts']],
]) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true });
  if (result.error) console.error(result.error.message);
  if (result.error || result.status !== 0) process.exit(result.status ?? 1);
}
