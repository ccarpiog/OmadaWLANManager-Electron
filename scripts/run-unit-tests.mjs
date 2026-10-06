// Unit-test runner (`npm test`). Steps:
//   1. type-check the tests and the modules they import (tsc -p tests, no emit);
//   2. bundle every tests/unit/**/*.test.ts with esbuild into a fresh temp
//      directory (never into dist/, so no test code can be packaged; JSON
//      fixtures are inlined). The bundle FAILS if anything imports `electron`:
//      the code under test must run in plain Node;
//   3. run the bundles with node:test, with HOME/USERPROFILE pointed at another
//      fresh temp directory, so even an accidental os.homedir() lookup can never
//      reach the user's real ~/.omada-wlan-manager/ config.
// Usage: node scripts/run-unit-tests.mjs

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unitDir = path.join(projectRoot, 'tests', 'unit');

/**
 * Recursively lists the *.test.ts files below a directory.
 * @param {string} dir - Directory to scan.
 * @returns {string[]} Absolute paths of the test files, sorted.
 */
function findTestFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }
  return files.sort();
} // End of function findTestFiles()

/**
 * esbuild plugin that rejects any import of `electron`: unit tests must run
 * without Electron, so the modules they reach have to stay Electron-free.
 * @type {import('esbuild').Plugin}
 */
const forbidElectronPlugin = {
  name: 'forbid-electron',
  /**
   * Registers the resolve hook that fails the build on `electron` imports.
   * @param {import('esbuild').PluginBuild} build - The esbuild build handle.
   */
  setup(build) {
    build.onResolve({ filter: /^electron(\/.*)?$/ }, (args) => ({
      errors: [{ text: `Unit tests must not import Electron (imported by ${path.relative(projectRoot, args.importer)})` }],
    }));
  },
};

/**
 * Runs `tsc -p tests` through Node directly (node_modules/.bin may be broken
 * by Dropbox, which strips symlinks).
 * @returns {boolean} True when the type-check passed.
 */
function typeCheck() {
  const tscPath = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  const result = spawnSync(process.execPath, [tscPath, '-p', 'tests'], { cwd: projectRoot, stdio: 'inherit' });
  return result.status === 0;
}

/**
 * Type-checks, bundles and runs the unit tests; exits with the test status.
 * @returns {Promise<void>}
 */
async function main() {
  const testFiles = findTestFiles(unitDir);
  if (testFiles.length === 0) {
    console.error('No unit tests found under tests/unit');
    process.exitCode = 1;
    return;
  }

  if (!typeCheck()) {
    console.error('Unit-test type-check failed (tsc -p tests)');
    process.exitCode = 1;
    return;
  }

  const outDir = mkdtempSync(path.join(os.tmpdir(), 'omada-unit-build-'));
  const fakeHome = mkdtempSync(path.join(os.tmpdir(), 'omada-unit-home-'));
  try {
    await esbuild.build({
      absWorkingDir: projectRoot,
      entryPoints: testFiles,
      outbase: unitDir,
      outdir: outDir,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node18',
      sourcemap: 'inline',
      logLevel: 'warning',
      plugins: [forbidElectronPlugin],
    });

    const bundles = testFiles.map((file) =>
      path.join(outDir, path.relative(unitDir, file).replace(/\.ts$/, '.js'))
    );
    const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
    const result = spawnSync(
      process.execPath,
      ['--enable-source-maps', '--test', '--test-reporter=spec', ...bundles],
      { cwd: projectRoot, stdio: 'inherit', env }
    );
    process.exitCode = result.status ?? 1;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  }
} // End of function main()

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
