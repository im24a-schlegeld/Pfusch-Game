import { resolve } from 'node:path';
import { writeAppIcons } from './offline-assets.mjs';

// CPU-only; normal Vite/Oxygen builds also generate these through writeOfflineBundle.
await writeAppIcons(resolve('public'));
