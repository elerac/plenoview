import { build } from 'vite';
import { spawnSync } from 'node:child_process';

// Set the build flag in Node so npm run build:e2e also works in Windows shells.
process.env.VITE_E2E = 'true';
await build();
const result = spawnSync(process.execPath, ['scripts/verify-web-assets.mjs'], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
