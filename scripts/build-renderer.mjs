// Bundles the renderer for the browser: src/renderer/renderer.ts and every
// module it imports become ONE classic IIFE script, dist/renderer/renderer.js,
// which index.html loads with <script src="renderer.js">. The output contains
// no inline code, eval, or extra chunks, so the CSP (script-src 'self') holds.
// esbuild only strips types: type-checking is `tsc -p src/renderer`, which
// runs first in `npm run build`.
//
// Usage:
//   node scripts/build-renderer.mjs           one-off build (part of npm run build)
//   node scripts/build-renderer.mjs --watch   rebuild on change (npm run watch:renderer),
//                                             with `tsc -p src/renderer --watch` running alongside

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rendererOutDir = path.join(projectRoot, 'dist', 'renderer');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  absWorkingDir: projectRoot,
  entryPoints: ['src/renderer/renderer.ts'],
  outfile: 'dist/renderer/renderer.js',
  // The renderer tsconfig enables `strict`, so esbuild emits "use strict" at
  // the top of the bundle, like the tsc output this bundle replaces
  tsconfig: 'src/renderer/tsconfig.json',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  // Electron 28 ships Chromium 120
  target: 'chrome120',
  // Linked source map for DevTools; build.files in package.json keeps *.map
  // out of the packaged app
  sourcemap: true,
  logLevel: 'info',
};

/**
 * Starts `tsc -p src/renderer --watch` as a child process so watch mode keeps
 * type-checking the renderer (esbuild alone would emit code with type errors).
 * tsc is run through Node directly rather than node_modules/.bin, which
 * Dropbox breaks by stripping symlinks. The child is stopped when this script
 * exits.
 * @returns {void}
 */
function startTypeCheckWatcher() {
  const tscPath = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  const typeChecker = spawn(
    process.execPath,
    [tscPath, '-p', 'src/renderer', '--watch', '--preserveWatchOutput'],
    { cwd: projectRoot, stdio: 'inherit' }
  );
  process.on('exit', () => typeChecker.kill());
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => process.exit());
  }
}

/**
 * Builds the renderer bundle once, or starts esbuild's watch mode (plus the
 * renderer type-check watcher) when the script runs with --watch. A one-off
 * build first deletes dist/renderer, so a stale script from an earlier build
 * (e.g. the per-file tsc output that used to land there) can never be loaded
 * instead of the bundle; `npm run copy-static` copies index.html and
 * styles.css back afterwards. Watch mode leaves the directory alone, so an
 * already-built dist/ keeps working.
 * @returns {Promise<void>}
 */
async function main() {
  if (process.argv.includes('--watch')) {
    startTypeCheckWatcher();
    const context = await esbuild.context(buildOptions);
    await context.watch();
    return;
  }
  rmSync(rendererOutDir, { recursive: true, force: true });
  await esbuild.build(buildOptions);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
