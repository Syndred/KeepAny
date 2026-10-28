import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

// Native gstack browser commands, with its deadline and publish-before-probe log.
// Use only with the owned localhost fixture described by the run's charter.
const [run, hypothesis, ...browserArgs] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(run ?? '') || !hypothesis || !browserArgs.length) throw Error('run hypothesis command [args]');
const report = resolve('test-results/ui-migration', run);
const root = join(process.env.USERPROFILE, '.codex/toolchains/gstack');
const bun = join(process.env.USERPROFILE, '.codex/toolchains/bun/node_modules/bun/bin/bun.exe');
const deadlineTool = join(root, 'bin/gstack-qa-deadline');
const browser = join(root, 'browse/dist/browse.exe');
const deadline = join(report, 'deadline.json');
const lastFile = join(report, 'last.json');
mkdirSync(report, { recursive: true });
const env = { ...process.env, BROWSE_STATE_FILE: resolve('test-results/ui-migration/gstack-browser/browse.json') };
const call = (exe, args) => execFileSync(exe, args, { env, encoding: 'utf8', timeout: 60000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
if (!existsSync(deadline)) call(bun, [deadlineTool, 'start', deadline, '900']);
const status = call(bun, [deadlineTool, 'status', deadline]);
if (JSON.parse(status.trim().replace(/^QA_DEADLINE\s+/, '')).expired) throw Error('gstack run deadline expired');
const previous = existsSync(lastFile) ? JSON.parse(readFileSync(lastFile, 'utf8')) : null;
const id = String((previous?.index ?? 0) + 1).padStart(3, '0');
const command = [bun, deadlineTool, 'run', deadline, '--', browser, ...browserArgs];
if (previous) writeFileSync(join(report, `exploration-${id}.json`), JSON.stringify({ observationCommand: previous.command, observed: previous.output, hypothesis, nextCommand: command }, null, 2));
let output = '', exitCode = 0;
try { output = call(command[0], command.slice(1)); }
catch (error) { output = `${error.stdout ?? ''}${error.stderr ?? ''}`; exitCode = error.status ?? 1; }
const receipt = { index: Number(id), command, exitCode, output };
writeFileSync(join(report, `probe-${id}.json`), JSON.stringify(receipt, null, 2));
writeFileSync(lastFile, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ id, exitCode, output }));
process.exitCode = exitCode;
