const assert = require('node:assert/strict');
const { buildArgs } = require('./electron-builder.cjs');
const hash = 'D90FF6C655C831F11CC50642E4EF8675905EAF79';
let selections = 0;
const select = () => { selections++; return hash; };
for (const args of [[], ['--mac', 'dir'], ['--mac', 'dmg', '--config', 'electron-builder.yml']]) {
  const result = buildArgs(args, 'darwin', select);
  assert.deepEqual(result.slice(0, args.length), args);
  assert.deepEqual(result.slice(-2), [`--config.mac.identity=${hash}`, '--config.mac.forceCodeSigning=true']);
}
assert.equal(selections, 3);
for (const platform of ['darwin', 'linux', 'win32']) {
  for (const args of [['--linux'], ['--win']]) {
    assert.deepEqual(buildArgs(args, platform, () => assert.fail('must not access keychain')), args);
  }
}
assert.deepEqual(buildArgs([], 'win32', () => assert.fail()), []);
assert.throws(() => buildArgs(['--mac'], 'linux', select), /macOS keychain/);
assert.throws(() => buildArgs(['--mac'], 'darwin', () => { throw new Error('missing G2'); }), /missing G2/);
console.log('Electron signing routing tests passed.');

// Exercise the installed builder's actual parser and schema: mixing --config FILE
// with dot-notation overrides produces a special intermediate representation.
// Array-shape checks alone miss duplicate-option and boolean-coercion failures.
async function testInstalledBuilderParser() {
  const builder = require('electron-builder/out/builder');
  const { validateConfiguration } = require('app-builder-lib/out/util/config/config');
  for (const args of [
    ['--mac', 'dir'],
    ['--mac', 'dmg', '--config', 'electron-builder.yml'],
  ]) {
    const parsed = builder.configureBuildCommand(builder.createYargs())
      .exitProcess(false).parse(buildArgs(args, 'darwin', () => hash));
    const { config, targets } = builder.normalizeOptions(parsed);
    assert.equal(config.mac.identity, hash);
    assert.equal(Array.isArray(config.mac.forceCodeSigning), false);
    if (args.includes('--config')) assert.equal(config.extends, 'electron-builder.yml');
    assert.ok([...targets.keys()].some(platform => platform.name === 'mac'));
    await validateConfiguration(config, { isEnabled: false });
    assert.equal(config.mac.forceCodeSigning, true);
  }
  console.log('Installed electron-builder CLI parsing and schema checks passed.');
}
testInstalledBuilderParser().catch(error => { console.error(error); process.exitCode = 1; });
