// Runs the TypeScript compiler through Node directly, forwarding every
// argument: `node scripts/tsc.mjs -p src/renderer`. The npm scripts use this
// instead of the node_modules/.bin/tsc shim, whose symlink Dropbox strips
// (see scripts/resolve-tsc.mjs).

import { spawnSync } from 'node:child_process';
import { resolveTscPath } from './resolve-tsc.mjs';

const result = spawnSync(process.execPath, [resolveTscPath(), ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) {
  console.error(`Could not run tsc: ${result.error.message}`);
}
process.exit(result.status ?? 1);
