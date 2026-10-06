// Locates the TypeScript compiler's launcher script so build/test scripts can
// run it through Node directly (`node <tsc> ...`) instead of through
// node_modules/.bin, whose symlinks Dropbox strips.
//
// `require.resolve('typescript/bin/tsc')` no longer works: TypeScript 7's
// package.json has an `exports` map that does not export ./bin/tsc. The
// package.json itself is exported, so the launcher path is read from its
// `bin` field instead.

import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Returns the absolute path of the `tsc` launcher declared in the installed
 * typescript package's package.json `bin` field.
 * @returns {string} Absolute path of the tsc launcher script.
 * @throws {Error} When the package declares no tsc launcher.
 */
export function resolveTscPath() {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve('typescript/package.json');
  const { bin } = require(packageJsonPath);
  const tscBin = typeof bin === 'string' ? bin : bin && bin.tsc;
  if (typeof tscBin !== 'string') {
    throw new Error(`The typescript package declares no tsc launcher (${packageJsonPath})`);
  }
  return path.join(path.dirname(packageJsonPath), tscBin);
}
