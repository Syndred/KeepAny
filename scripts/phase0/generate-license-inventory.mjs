import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const grouped = JSON.parse(execFileSync('pnpm', ['licenses', 'list', '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
const lock = await readFile(resolve(root, 'pnpm-lock.yaml'));
const packages = [];
for (const [declaredLicense, entries] of Object.entries(grouped)) {
  for (const entry of entries) {
    for (let i = 0; i < entry.versions.length; i++) {
      const directory = entry.paths[i];
      const names = await readdir(directory).catch(() => []);
      const licenseFiles = names.filter(name => /^(license|licence|copying|notice)(\.|$)/i.test(name));
      packages.push({
        name: entry.name,
        version: entry.versions[i],
        declaredLicense,
        licenseFiles,
        licenseTextPresent: licenseFiles.some(name => /^(license|licence|copying)(\.|$)/i.test(name)),
      });
    }
  }
}
packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const output = {
  generatedAt: new Date().toISOString(),
  generator: 'pnpm licenses list --json plus installed package root file inspection',
  lockSha256: createHash('sha256').update(lock).digest('hex'),
  caveat: 'Declared package metadata and file presence are inventory evidence, not a complete review of bundled files, subdependencies, copyright notices, or release license compatibility.',
  packageCount: packages.length,
  missingLicenseText: packages.filter(item => !item.licenseTextPresent).map(item => `${item.name}@${item.version}`),
  packages,
};
const directory = resolve(root, 'tests/phase0/evidence');
await mkdir(directory, { recursive: true });
await writeFile(join(directory, 'dependency-license-inventory.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(`Inventoried ${packages.length} package versions; ${output.missingLicenseText.length} installed roots lack a license text file.`);
