import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/@capacitor/cli/bin/capacitor', import.meta.url));
const args = process.argv.slice(2);
if (!args.length) throw Error('Usage: node scripts/mobile-cli.mjs sync|open|build|doctor ...');
execFileSync(process.execPath, [cli, ...args], { cwd: `${root}/apps/mobile`, stdio: 'inherit' });
