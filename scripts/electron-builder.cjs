#!/usr/bin/env node
// Pin macOS signing only; Windows/Linux commands and explicitly unsigned scripts stay unchanged.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/** Select the current G2 identity through the same validated policy as native releases. */
function selectIdentity() {
  const helper = path.join(__dirname, 'lib', 'developer-id.sh');
  const result = spawnSync('bash', ['-c',
    'source "$1"; select_developer_id || exit $?; printf "%s" "$DEVELOPER_ID_HASH"', 'bash', helper],
  { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr || result.error?.message || 'Developer ID selection failed.');
  }
  const hash = result.stdout.trim();
  if (!/^[0-9A-F]{40}$/.test(hash)) throw new Error('Invalid Developer ID fingerprint.');
  return hash;
}

/** Add an exact identity only for macOS targets, including the host-default macOS target. */
function buildArgs(argv, platform, chooseIdentity = selectIdentity) {
  const mac = argv.some(arg => arg === '--mac' || arg === '-m' || arg.startsWith('--mac='));
  const other = argv.some(arg => ['--win', '-w', '--linux', '-l'].includes(arg)
    || arg.startsWith('--win=') || arg.startsWith('--linux='));
  if (!mac && (other || platform !== 'darwin')) return [...argv];
  if (platform !== 'darwin') throw new Error('Signed macOS packaging requires the macOS keychain.');
  return [...argv, `--config.mac.identity=${chooseIdentity()}`, '--config.mac.forceCodeSigning=true'];
}

/** Invoke the installed electron-builder CLI directly, without shell interpolation. */
function main() {
  try {
    const args = buildArgs(process.argv.slice(2), process.platform);
    const cli = require.resolve('electron-builder/cli.js');
    const result = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

module.exports = { buildArgs };
if (require.main === module) main();
