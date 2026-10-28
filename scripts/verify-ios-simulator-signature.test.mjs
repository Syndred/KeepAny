import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { simulatorSections, verifySimulatorSignature } from './verify-ios-simulator-signature.mjs';

const ID = 'io.github.syndred.keepany';
const BUILT = 'test-results/ios-derived/Build/Products/Debug-iphonesimulator/App.app';
const XCENT = 'test-results/ios-derived/Build/Intermediates.noindex/App.build/Debug-iphonesimulator/App.build/App.app-Simulated.xcent';
const XML = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>application-identifier</key><string>${ID}</string></dict></plist>`);
// This is deliberately an opaque test sentinel: mock derq, NOT a claim of
// Apple DER/signing/Simulator execution on the Windows test host.
const DER = Buffer.from('mock-sdk-der');
const ok = (stdout = '', stderr = '') => ({ status: 0, stdout, stderr });

function fixture(t, options = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'keepany-ios-signature-')));
  t.onTestFinished(() => {
    assert.ok(path.basename(root).startsWith('keepany-ios-signature-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const put = (name, bytes) => { fs.mkdirSync(path.dirname(name), { recursive: true }); fs.writeFileSync(name, bytes); };
  const built = path.join(root, BUILT), installed = path.join(root, 'installed/App.app');
  const arches = options.arches ?? ['arm64', 'x86_64'];
  const slices = new Map();
  for (const arch of arches) {
    const xml = options.xml?.(arch) ?? XML, der = options.der?.(arch) ?? DER;
    const bytes = Buffer.alloc(64 + xml.length + der.length);
    bytes.writeUInt32LE(0xfeedfacf); bytes.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4);
    xml.copy(bytes, 64); der.copy(bytes, 64 + xml.length);
    const section = (name, offset, size, seg = '__TEXT') => `  Section\n    sectname ${name}\n     segname ${seg}\n        addr 0x1000\n        size 0x${size.toString(16)}\n      offset ${offset}\n       align 2^0\n`;
    let load = section('__entitlements', 64, xml.length) + section('__ents_der', 64 + xml.length, der.length);
    if (options.missingXML) load = section('__ents_der', 64 + xml.length, der.length);
    if (options.missingDER) load = section('__entitlements', 64, xml.length);
    if (options.duplicate) load += section('__entitlements', 64, xml.length);
    if (options.outOfBounds) load = load.replace(`offset ${64 + xml.length}`, 'offset 99999999');
    if (options.overlap) load = load.replace(`offset ${64 + xml.length}`, 'offset 64');
    if (options.wrongSegment) load = load.replace('segname __TEXT', 'segname __DATA');
    slices.set(arch, { bytes, load });
  }
  const fat = Buffer.from('synthetic-fat-main-public-identity');
  const main = options.thin ? slices.get(arches[0]).bytes : fat;
  for (const app of [built, installed]) {
    put(path.join(app, 'App'), main);
    put(path.join(app, 'Info.plist'), '<plist/>');
    if (!options.noBody) put(path.join(app, 'App.debug.dylib'), Buffer.from('synthetic-public-debug-body'));
  }
  if (options.installedBodyMismatch) put(path.join(installed, 'App.debug.dylib'), Buffer.from('different-body'));
  if (options.installedBodyMissing) fs.unlinkSync(path.join(installed, 'App.debug.dylib'));
  if (options.installedMainMismatch) put(path.join(installed, 'App'), Buffer.from('different-main'));
  const xcent = path.join(root, XCENT);
  put(xcent, XML); put(`${xcent}.der`, options.sdkDER ?? DER);
  const calls = [];
  function runTool(command, args, input) {
    calls.push({ command, args });
    if (options.toolFailure === command) return { status: 1, stdout: '', stderr: 'private diagnostic must never be echoed' };
    if (command === 'codesign') {
      if (args.includes('--verify')) return ok();
      if (args.includes('--verbose=4')) return ok('', `Signature=${options.notAdHoc && !args.at(-1).endsWith('App.debug.dylib') ? 'adhoc-invalid' : 'adhoc'}\n`);
      return ok(options.hostEmptyOutput ? '' : '<?xml version="1.0"?><plist><dict/></plist>');
    }
    if (command === '/usr/libexec/PlistBuddy') return ok(args[1].includes('CFBundleIdentifier') ? `${options.bundle ?? ID}\n` : 'App\n');
    if (command === 'plutil') {
      const text = Buffer.from(input).toString('utf8');
      if (!text.includes('<plist')) return { status: 1, stdout: '', stderr: 'invalid fixture xml' };
      if (text.includes('<dict/>')) return ok(JSON.stringify(options.host ?? {}));
      return ok(JSON.stringify({ 'application-identifier': /<string>([^<]+)<\/string>/.exec(text)?.[1] }));
    }
    if (command === '/usr/bin/derq') { put(args[args.indexOf('-o') + 1], DER); return ok(); }
    if (command === 'xcrun' && args[0] === 'lipo') {
      if (args[1] === '-archs') {
        const match = /App-(arm64|x86_64)$/.exec(args[2]);
        return ok(match ? match[1] : arches.join(' '));
      }
      const arch = args[args.indexOf('-thin') + 1];
      put(args[args.indexOf('-output') + 1], slices.get(arch).bytes); return ok();
    }
    if (command === 'xcrun' && args[0] === 'otool') {
      const arch = /App-(arm64|x86_64)$/.exec(args[2])?.[1] ?? arches[0];
      return ok(slices.get(arch).load);
    }
    throw Error('unexpected-mock-command');
  }
  const verify = phase => verifySimulatorSignature({ app: phase.startsWith('installed') ? installed : BUILT, phase, workspace: root, runTool });
  const result = phase => JSON.parse(fs.readFileSync(path.join(root, `test-results/ios/signature-${phase}.json`)));
  const scratchClean = () => assert.equal(fs.readdirSync(path.join(root, 'test-results/ios')).some(name => name.startsWith('.signature-')), false);
  return { root, built, installed, calls, verify, result, scratchClean, slices };
}

for (const phase of ['compile', 'test', 'installed-before', 'installed-after']) test(`mock Apple tool contract ${phase}: empty host dict + precise two-architecture Simulator sections passes metadata only`, t => {
  const f = fixture(t); const result = f.verify(phase);
  assert.equal(result.metadataVerified, true); assert.equal(result.hostEntitlements.applicationIdentifier, null);
  assert.equal(result.simulatedEntitlements.slices.length, 2); assert.equal(result.debugBodyMatchesBuild, true);
  assert.equal(result.simulatedEntitlements.source, 'main-macho-sections');
  assert.equal(f.result(phase).metadataVerified, true); f.scratchClean();
});

test('mock thin main and no debug body are accepted based on actual presence', t => {
  const f = fixture(t, { thin: true, arches: ['arm64'], noBody: true, hostEmptyOutput: true });
  const result = f.verify('compile'); assert.equal(result.debugBodyPresent, false); assert.equal(result.metadataVerified, true);
  assert.equal(f.calls.some(call => call.args.includes('-thin')), false); f.scratchClean();
});

const rejected = [
  ['main XML missing', { missingXML: true }, 'simulated-section-missing'],
  ['DER missing', { missingDER: true }, 'simulated-section-missing'],
  ['wrong identity', { xml: () => Buffer.from(XML.toString().replace(ID, 'different.app')) }, 'simulated-identity-invalid'],
  ['second architecture differs', { xml: arch => arch === 'x86_64' ? Buffer.from(XML.toString().replace(ID, 'different.app')) : XML }, 'simulated-identity-invalid'],
  ['embedded DER differs', { der: () => Buffer.from('different-der') }, 'simulated-section-mismatch'],
  ['SDK DER differs from actual derq regeneration', { sdkDER: Buffer.from('stale-sdk-der') }, 'sdk-der-mismatch'],
  ['duplicate section', { duplicate: true }, 'section-format-invalid'],
  ['wrong segment', { wrongSegment: true }, 'section-format-invalid'],
  ['overlapping sections', { overlap: true }, 'section-bounds-invalid'],
  ['out of bounds section', { outOfBounds: true }, 'section-bounds-invalid'],
  ['duplicate architecture', { arches: ['arm64', 'arm64'] }, 'architecture-invalid'],
  ['unknown architecture', { arches: ['unexpected'] }, 'architecture-invalid'],
  ['non ad-hoc signature', { notAdHoc: true }, 'signature-identity-invalid'],
  ['wrong bundle', { bundle: 'different.app' }, 'signature-identity-invalid'],
  ['unexpected host identity', { host: { 'application-identifier': 'different.app' } }, 'host-entitlements-invalid'],
  ['shared Keychain group', { host: { 'keychain-access-groups': ['other.group'] } }, 'host-entitlements-invalid'],
  ['shared App group', { host: { 'com.apple.security.application-groups': ['other.group'] } }, 'host-entitlements-invalid'],
  ['unexpected host Team entitlement', { host: { 'com.apple.developer.team-identifier': 'invented' } }, 'host-entitlements-invalid'],
  ['otool failure is not ignored', { toolFailure: 'xcrun' }, 'signature-tool-failed'],
  ['plist conversion failure is not ignored', { toolFailure: 'plutil' }, 'signature-tool-failed'],
  ['duplicate XML keys even if converter would collapse them', { xml: () => Buffer.from(XML.toString().replace('</dict>', `<key>application-identifier</key><string>${ID}</string></dict>`)) }, 'simulated-entitlements-invalid'],
];
for (const [name, options, code] of rejected) test(`mock negative: ${name}`, t => {
  const f = fixture(t, options);
  assert.throws(() => f.verify('compile'), { message: `ios-simulator-${code}` });
  const result = f.result('compile'); assert.equal(result.metadataVerified, false); assert.equal(result.error, `ios-simulator-${code}`);
  assert.equal(JSON.stringify(result).includes('private diagnostic'), false); f.scratchClean();
});

for (const [name, options, code] of [
  ['debug body changed', { installedBodyMismatch: true }, 'signature-identity-invalid'],
  ['debug body disappeared', { installedBodyMissing: true }, 'debug-body-mismatch'],
  ['main changed', { installedMainMismatch: true }, 'signature-identity-invalid'],
]) test(`mock installed negative: ${name}`, t => {
  const f = fixture(t, options);
  assert.throws(() => f.verify('installed-after'), { message: `ios-simulator-${code}` });
  assert.equal(f.result('installed-after').metadataVerified, false); f.scratchClean();
});

test('section parser refuses ambiguous duplicate header values', () => {
  assert.throws(() => simulatorSections('Section\nsectname __entitlements\nsegname __TEXT\nsegname __TEXT\nsize 0x1\noffset 32', Buffer.alloc(100)), { message: 'ios-simulator-section-format-invalid' });
});
