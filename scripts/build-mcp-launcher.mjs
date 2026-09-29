import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist', 'mcp-launcher');
const executable = join(output, 'bin', 'keepany-mcp.mjs');
const rootPackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const dependencies = Object.fromEntries(
  ['@modelcontextprotocol/server', '@noble/hashes', 'zod']
    .map(name => [name, rootPackage.dependencies[name]]),
);
if (Object.values(dependencies).some(version => typeof version !== 'string')) {
  throw Error('mcp-runtime-dependency-missing');
}

await rm(output, { recursive: true, force: true });
await mkdir(dirname(executable), { recursive: true });
const result = await build({
  entryPoints: [join(root, 'apps', 'mcp-launcher', 'src', 'main.ts')],
  outfile: executable,
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node20.19',
  metafile: true,
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'warning',
});
const imports = Object.values(result.metafile.outputs).flatMap(file => file.imports);
for (const item of imports) {
  if (!item.external || item.path.startsWith('node:')) continue;
  if (!Object.keys(dependencies).some(name => item.path === name || item.path.startsWith(`${name}/`))) {
    throw Error(`mcp-unexpected-external:${item.path}`);
  }
}
await chmod(executable, 0o755);
await writeFile(join(output, 'package.json'), `${JSON.stringify({
  name: '@keepany/mcp-launcher',
  version: rootPackage.version,
  private: true,
  description: 'KeepAny local MCP stdio launcher',
  type: 'module',
  bin: { 'keepany-mcp': './bin/keepany-mcp.mjs' },
  files: ['bin', 'LICENSE', 'NOTICE.md', 'README.md'],
  engines: { node: '>=20.19.0' },
  dependencies,
}, null, 2)}\n`);
await Promise.all([
  copyFile(join(root, 'LICENSE'), join(output, 'LICENSE')),
  copyFile(join(root, 'NOTICE.md'), join(output, 'NOTICE.md')),
  copyFile(join(root, 'apps', 'mcp-launcher', 'README.md'), join(output, 'README.md')),
]);
process.stdout.write(`Built ${output}\n`);
