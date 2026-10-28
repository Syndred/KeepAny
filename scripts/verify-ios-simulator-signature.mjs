import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const BUNDLE = 'io.github.syndred.keepany';
const BUILT = 'test-results/ios-derived/Build/Products/Debug-iphonesimulator/App.app';
const XCENT = 'test-results/ios-derived/Build/Intermediates.noindex/App.build/Debug-iphonesimulator/App.build/App.app-Simulated.xcent';
const PHASES = ['compile', 'test', 'installed-before', 'installed-after'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const reject = code => { throw Error(`ios-simulator-${code}`); };

function normalTool(command, args, input) {
  return spawnSync(command, args, { input, encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
}

// Exact __TEXT section offsets in a THIN Mach-O. Never reinterpret otool's
// endian-sensitive hex-word presentation as bytes or concatenate fat slices.
export function simulatorSections(loadCommands, bytes) {
  const sections = new Map();
  for (const block of loadCommands.split(/^\s*Section\s*$/m).slice(1)) {
    // Only inspect the section header, before any later load command.
    const header = block.split(/^Load command \d+/m)[0];
    const field = key => {
      const found = [...header.matchAll(new RegExp(`^\\s*${key}\\s+(\\S+)\\s*$`, 'gm'))];
      if (found.length !== 1) reject('section-format-invalid');
      return found[0][1];
    };
    const name = /^\s*sectname\s+(\S+)\s*$/m.exec(header)?.[1];
    if (!['__entitlements', '__ents_der'].includes(name)) continue;
    if (field('segname') !== '__TEXT' || sections.has(name)) reject('section-format-invalid');
    const sizeText = field('size'), offsetText = field('offset');
    if (!/^0x[0-9a-f]+$/i.test(sizeText) || !/^\d+$/.test(offsetText)) reject('section-format-invalid');
    const size = Number.parseInt(sizeText, 16), offset = Number(offsetText);
    if (!Number.isSafeInteger(size) || size < 1 || size > 65536 || !Number.isSafeInteger(offset) || offset < 32 || offset + size > bytes.length) reject('section-bounds-invalid');
    sections.set(name, { bytes: bytes.subarray(offset, offset + size), offset, size });
  }
  if (sections.size !== 2) reject('simulated-section-missing');
  const xml = sections.get('__entitlements'), der = sections.get('__ents_der');
  if (xml.offset < der.offset + der.size && der.offset < xml.offset + xml.size) reject('section-bounds-invalid');
  return { xml: xml.bytes, der: der.bytes };
}

export function verifySimulatorSignature({ app, phase, workspace = process.cwd(), runTool = normalTool }) {
  const root = path.resolve(workspace), built = path.resolve(root, BUILT);
  const output = path.join(root, 'test-results/ios');
  fs.mkdirSync(output, { recursive: true });
  const result = { phase: PHASES.includes(phase) ? phase : 'invalid', signatureVerified: false, adHoc: false, bundleMatches: false, binaryMatchesBuild: false,
    debugBodyPresent: false, debugBodyMatchesBuild: false, hostEntitlements: null, simulatedEntitlements: null, metadataVerified: false };
  let scratch;
  const run = (command, args, input) => {
    const value = runTool(command, args, input);
    if (value?.status !== 0 || value.error || typeof value.stdout !== 'string' || typeof value.stderr !== 'string') reject('signature-tool-failed');
    return value;
  };
  const regular = filename => {
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) reject('executable-invalid');
    return fs.readFileSync(filename);
  };
  const present = filename => {
    try { fs.lstatSync(filename); return true; }
    catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
  };
  const jsonPlist = bytes => {
    const parsed = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', '-'], bytes).stdout);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) reject('entitlements-invalid');
    return parsed;
  };
  const simulated = bytes => {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (bytes.length > 65536 || !/^\s*<\?xml\b/.test(text) || [...text.matchAll(/<key\b[^>]*>/g)].length !== 1) reject('simulated-entitlements-invalid');
    const value = jsonPlist(bytes);
    if (Object.keys(value).length !== 1 || value['application-identifier'] !== BUNDLE) reject('simulated-identity-invalid');
    return value;
  };
  try {
    const installed = ['installed-before', 'installed-after'].includes(phase);
    if (!PHASES.includes(phase) || typeof app !== 'string' || (installed ? !path.isAbsolute(app) || path.basename(app) !== 'App.app' : app !== BUILT)) reject('signature-input');
    const actual = installed ? path.resolve(app) : built;
    if (!fs.lstatSync(actual).isDirectory() || fs.lstatSync(actual).isSymbolicLink()) reject('signature-input');
    run('codesign', ['--verify', '--strict', actual]); result.signatureVerified = true;
    result.adHoc = /^Signature=adhoc$/m.test(run('codesign', ['--display', '--verbose=4', actual]).stderr);
    const bundle = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', path.join(actual, 'Info.plist')]).stdout.trim();
    result.bundleMatches = bundle === BUNDLE;
    if (run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', path.join(actual, 'Info.plist')]).stdout.trim() !== 'App') reject('executable-invalid');
    const main = regular(path.join(actual, 'App')), builtMain = regular(path.join(built, 'App'));
    result.binaryMatchesBuild = main.equals(builtMain); result.binarySha256 = hash(main);
    const body = path.join(actual, 'App.debug.dylib'), builtBody = path.join(built, 'App.debug.dylib');
    result.debugBodyPresent = present(body);
    if (result.debugBodyPresent !== present(builtBody)) reject('debug-body-mismatch');
    result.debugBodyMatchesBuild = !result.debugBodyPresent;
    if (result.debugBodyPresent) {
      const bytes = regular(body), builtBytes = regular(builtBody);
      result.debugBodyMatchesBuild = bytes.equals(builtBytes); result.debugBodySha256 = hash(bytes);
      run('codesign', ['--verify', '--strict', body]);
      if (!/^Signature=adhoc$/m.test(run('codesign', ['--display', '--verbose=4', body]).stderr)) reject('debug-body-signature-invalid');
    }
    if (!result.signatureVerified || !result.adHoc || !result.bundleMatches || !result.binaryMatchesBuild || !result.debugBodyMatchesBuild) reject('signature-identity-invalid');

    // macOS host signing entitlements and Simulator entitlements are different
    // inputs. Empty host XML is valid; unexpected identity/shared groups are not.
    const signed = run('codesign', ['--display', '--entitlements', ':-', actual]).stdout;
    const host = signed.trim() ? jsonPlist(Buffer.from(signed)) : {};
    const identity = host['application-identifier'], groups = host['keychain-access-groups'], appGroups = host['com.apple.security.application-groups'];
    const hostAllowed = ['application-identifier', 'keychain-access-groups', 'com.apple.security.application-groups', 'get-task-allow', 'com.apple.security.get-task-allow'];
    if (Object.keys(host).some(key => !hostAllowed.includes(key)) || identity !== undefined && identity !== BUNDLE || groups !== undefined && (!Array.isArray(groups) || groups.some(group => group !== BUNDLE)) || appGroups !== undefined && (!Array.isArray(appGroups) || appGroups.length !== 0)) reject('host-entitlements-invalid');
    if (['get-task-allow', 'com.apple.security.get-task-allow'].some(key => Object.hasOwn(host, key) && typeof host[key] !== 'boolean')) reject('host-entitlements-invalid');
    result.hostEntitlements = { keys: Object.keys(host).sort(), applicationIdentifier: identity ?? null, noSharedGroups: true,
      getTaskAllow: { present: Object.hasOwn(host, 'get-task-allow'), value: host['get-task-allow'] ?? null },
      macGetTaskAllow: { present: Object.hasOwn(host, 'com.apple.security.get-task-allow'), value: host['com.apple.security.get-task-allow'] ?? null } };

    scratch = fs.mkdtempSync(path.join(output, '.signature-'));
    const xcent = path.resolve(root, XCENT), sdkXML = regular(xcent), sdkDER = regular(`${xcent}.der`);
    simulated(sdkXML);
    result.sdkEntitlements = { xmlSha256: hash(sdkXML), derSha256: hash(sdkDER) };
    const derived = path.join(scratch, 'sdk.der');
    run('/usr/bin/derq', ['query', '-f', 'xml', '-i', xcent, '-o', derived, '--raw']);
    if (!sdkDER.length || !sdkDER.equals(regular(derived))) reject('sdk-der-mismatch');
    const architectureText = run('xcrun', ['lipo', '-archs', path.join(actual, 'App')]).stdout.trim();
    const architectures = architectureText.split(/\s+/);
    if (!architectures.length || architectures.some(arch => !['arm64', 'x86_64'].includes(arch)) || new Set(architectures).size !== architectures.length) reject('architecture-invalid');
    const slices = [];
    result.simulatedEntitlements = { source: 'main-macho-sections', noSharedGroups: false, sdkMatched: false, slices };
    for (const arch of architectures) {
      let thin = path.join(actual, 'App');
      if (!(main.length >= 4 && main.readUInt32LE(0) === 0xfeedfacf && architectures.length === 1)) {
        thin = path.join(scratch, `App-${arch}`);
        run('xcrun', ['lipo', path.join(actual, 'App'), '-thin', arch, '-output', thin]);
      }
      const thinBytes = regular(thin);
      if (thinBytes.length < 32 || thinBytes.readUInt32LE(0) !== 0xfeedfacf || run('xcrun', ['lipo', '-archs', thin]).stdout.trim() !== arch) reject('architecture-invalid');
      const sections = simulatorSections(run('xcrun', ['otool', '-l', thin]).stdout, thinBytes);
      const slice = { arch, xmlSha256: hash(sections.xml), derSha256: hash(sections.der), xmlBytes: sections.xml.length, derBytes: sections.der.length, sdkMatched: false };
      slices.push(slice);
      simulated(sections.xml);
      if (!sections.xml.equals(sdkXML) || !sections.der.equals(sdkDER)) reject('simulated-section-mismatch');
      slice.applicationIdentifier = BUNDLE; slice.sdkMatched = true;
      // Only the validated minimal public identity and its DER, never App data.
      fs.writeFileSync(path.join(output, `signature-${phase}-${arch}.plist`), sections.xml);
      fs.writeFileSync(path.join(output, `signature-${phase}-${arch}.der`), sections.der);
    }
    result.simulatedEntitlements = { source: 'main-macho-sections', noSharedGroups: true, sdkMatched: true, slices };
    result.metadataVerified = true;
    fs.writeFileSync(path.join(output, `signature-${phase}.json`), JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    const code = /^ios-simulator-[a-z-]+$/.test(error?.message) ? error.message : 'ios-simulator-signature-inspection-failed';
    fs.writeFileSync(path.join(output, `signature-${result.phase}.json`), JSON.stringify({ ...result, error: code }, null, 2));
    throw Error(code);
  } finally {
    // Only the exact directory created by this invocation, never App products.
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(verifySimulatorSignature({ app: process.argv[2], phase: process.argv[3] }))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
