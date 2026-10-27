/**
 * Technical rasterization of this repository's apps/web/public/icons/keepany.svg.
 * Uses locked Playwright Chromium; no added dependency or copied business source.
 * Run: node scripts/generate-mobile-icons.mjs [--check]
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = 'apps/web/public/icons/keepany.svg';
const source = await readFile(resolve(project, sourcePath), 'utf8');
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(argument => argument !== '--check')) throw Error('Usage: node scripts/generate-mobile-icons.mjs [--check]');
const android = 'apps/mobile/android/app/src/main/res';
const ios = 'apps/mobile/ios/App/App/Assets.xcassets';
const background = '#fff9ec';
const outputs = [];
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

for (const [density, factor] of Object.entries(densities)) {
  outputs.push({ path: `${android}/mipmap-${density}/ic_launcher.png`, size: 48 * factor, mode: 'opaque' });
  outputs.push({ path: `${android}/mipmap-${density}/ic_launcher_round.png`, size: 48 * factor, mode: 'round' });
  // Android foreground is 108dp; the original mark is centered in 72dp. Its
  // existing padding keeps the K itself inside the 66dp adaptive safe zone.
  outputs.push({ path: `${android}/mipmap-${density}/ic_launcher_foreground.png`, size: 108 * factor, mode: 'foreground' });
}
outputs.push({ path: `${android}/drawable-nodpi/keepany_launch_mark.png`, size: 512, mode: 'opaque' });
outputs.push({ path: `${ios}/AppIcon.appiconset/AppIcon-512@2x.png`, size: 1024, mode: 'opaque' });
for (const scale of [1, 2, 3]) outputs.push({ path: `${ios}/Splash.imageset/keepany-splash-${scale}x.png`, size: 128 * scale, mode: 'opaque' });

function destination(path) {
  if (![`${android}/`, `${ios}/`].some(root => path.startsWith(root))) throw Error('mobile-icon-output');
  const absolute = resolve(project, path), within = relative(project, absolute);
  if (isAbsolute(within) || within === '..' || within.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) throw Error('mobile-icon-output');
  return absolute;
}

const browser = await chromium.launch({ headless: true });
const receipt = [];
try {
  const page = await browser.newPage();
  // Offline conversion; this browser never opens the product or user profile.
  await page.route('**/*', route => route.abort());
  for (const output of outputs) {
    await page.setViewportSize({ width: output.size, height: output.size });
    const encoded = await page.evaluate(async ({ svg, size, mode, background }) => {
      const image = new Image();
      image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d', { alpha: mode !== 'opaque' });
      if (!context) throw Error('canvas-unavailable');
      if (mode === 'opaque') {
        context.fillStyle = background; context.fillRect(0, 0, size, size);
      } else if (mode === 'round') {
        context.beginPath(); context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); context.clip();
        context.fillStyle = background; context.fillRect(0, 0, size, size);
      }
      const mark = mode === 'foreground' ? size * 2 / 3 : size;
      context.drawImage(image, (size - mark) / 2, (size - mark) / 2, mark, mark);
      if (mode === 'opaque') {
        document.documentElement.style.background = background;
        document.body.style.cssText = `margin:0;padding:0;background:${background}`;
        canvas.style.display = 'block';
        document.body.replaceChildren(canvas);
        return null;
      }
      return canvas.toDataURL('image/png').split(',')[1];
    }, { svg: source, size: output.size, mode: output.mode, background });
    // Canvas PNG always has an alpha channel in Chromium. Its opaque screenshot
    // encoder emits RGB, so iOS gets an actual no-alpha PNG without another codec.
    const png = output.mode === 'opaque' ? await page.screenshot({ type: 'png', omitBackground: false }) : Buffer.from(encoded, 'base64');
    if (png.subarray(1, 4).toString() !== 'PNG' || png.readUInt32BE(16) !== output.size || png.readUInt32BE(20) !== output.size) throw Error(`mobile-icon-dimensions: ${output.path}`);
    // PNG color type 2 is RGB without an alpha channel, including the iOS icon.
    if (output.mode === 'opaque' && png[25] !== 2) throw Error(`mobile-icon-alpha: ${output.path}`);
    const path = destination(output.path);
    if (check) {
      if (!(await readFile(path)).equals(png)) throw Error(`mobile-icon-stale: ${output.path}`);
    } else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, png);
    }
    receipt.push({ path: output.path, size: output.size, rgb: png[25] === 2, bytes: png.length, sha256: createHash('sha256').update(png).digest('hex') });
  }
} finally { await browser.close(); }

console.log(JSON.stringify({ mode: check ? 'check' : 'generate', source: sourcePath, sourceSha256: createHash('sha256').update(source).digest('hex'), background, count: receipt.length, totalBytes: receipt.reduce((sum, output) => sum + output.bytes, 0), outputs: receipt }, null, 2));
