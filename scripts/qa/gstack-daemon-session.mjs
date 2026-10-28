import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
const exe = join(process.env.USERPROFILE, '.codex/toolchains/gstack/browse/dist/browse.exe');
const env = { ...process.env, BROWSE_STATE_FILE: resolve('test-results/ui-migration/gstack-browser/browse.json'), BROWSE_PARENT_PID: '0' };
console.log(execFileSync(exe, ['goto', 'about:blank'], { env, encoding: 'utf8', windowsHide: true }));
console.log('Owned gstack browser bootstrap is held by this session.');
setInterval(() => {}, 30000);
