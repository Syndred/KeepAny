import { build } from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist', 'public-site');
const renderer = join(root, 'dist', '.public-site-renderer.mjs');
const repositoryUrl = 'https://github.com/Syndred/KeepAny';

function publicUrl(value, name, trailingSlash = false) {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw Error(`${name} must be an HTTPS URL without credentials, query, or fragment`);
  }
  if (trailingSlash && !parsed.pathname.endsWith('/')) parsed.pathname += '/';
  return parsed.href;
}

const siteUrl = publicUrl(process.env.STACKPERCH_PUBLIC_SITE_URL ?? process.env.KEEPANY_PUBLIC_SITE_URL ?? 'https://syndred.github.io/KeepAny/', 'STACKPERCH_PUBLIC_SITE_URL / KEEPANY_PUBLIC_SITE_URL', true);
const downloadUrl = publicUrl(process.env.STACKPERCH_PUBLIC_DOWNLOAD_URL ?? process.env.KEEPANY_PUBLIC_DOWNLOAD_URL ?? `${repositoryUrl}/releases`, 'STACKPERCH_PUBLIC_DOWNLOAD_URL / KEEPANY_PUBLIC_DOWNLOAD_URL');
const screenshots = {
  en: resolve(root, process.env.STACKPERCH_PUBLIC_SCREENSHOT_EN ?? process.env.KEEPANY_PUBLIC_SCREENSHOT_EN ?? 'docs/evidence/2026-10-13/stackperch/onboarding-en-1280-sample.png'),
  zh: resolve(root, process.env.STACKPERCH_PUBLIC_SCREENSHOT_ZH ?? process.env.KEEPANY_PUBLIC_SCREENSHOT_ZH ?? 'docs/evidence/2026-10-13/stackperch/onboarding-zh-1280-sample.png'),
};

const screenshotSizes = Object.fromEntries(await Promise.all(Object.entries(screenshots).map(async ([locale, path]) => {
  const bytes = await readFile(path);
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Error(`Public screenshot must be a PNG: ${locale}`);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1) throw Error(`Invalid screenshot dimensions: ${locale}`);
  return [locale, { width, height }];
})));

const xmlText = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

// Publish only this generated documentation directory, never apps/web or release/web.
await rm(output, { recursive: true, force: true });
await mkdir(join(output, 'assets'), { recursive: true });
await mkdir(join(output, 'zh'), { recursive: true });

try {
  await build({
    entryPoints: [join(root, 'apps/public-site/page.tsx')],
    outfile: renderer,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node22',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    logLevel: 'warning',
  });
  const { renderPublicPage } = await import(pathToFileURL(renderer).href);
  await Promise.all([
    writeFile(join(output, 'index.html'), renderPublicPage('en', { siteUrl, downloadUrl, repositoryUrl, screenshotSize: screenshotSizes.en })),
    writeFile(join(output, 'zh/index.html'), renderPublicPage('zh-CN', { siteUrl, downloadUrl, repositoryUrl, screenshotSize: screenshotSizes.zh })),
    build({ entryPoints: [join(root, 'apps/public-site/styles.css')], outfile: join(output, 'assets/public.css'), bundle: true, minify: true, logLevel: 'warning' }),
    copyFile(screenshots.en, join(output, 'assets/overview-en.png')),
    copyFile(screenshots.zh, join(output, 'assets/overview-zh.png')),
    copyFile(join(root, 'apps/web/public/icons/keepany.svg'), join(output, 'assets/stackperch.svg')),
    copyFile(join(root, 'apps/web/public/icons/keepany.svg'), join(output, 'assets/keepany.svg')),
    writeFile(join(output, '.nojekyll'), ''),
  ]);

  const robots = `# Deployment template: robots.txt is effective only at the domain root.\n# On a project Pages URL, /KeepAny/robots.txt does not set the domain policy.\nUser-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: ChatGPT-User\nAllow: /\n\nUser-agent: GPTBot\nAllow: /\n\nUser-agent: *\nAllow: /\n\nSitemap: ${siteUrl}sitemap.xml\n`;
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${['', 'zh/'].map(path => `  <url>\n    <loc>${xmlText(`${siteUrl}${path}`)}</loc>\n    <xhtml:link rel="alternate" hreflang="en" href="${xmlText(siteUrl)}"/>\n    <xhtml:link rel="alternate" hreflang="zh-CN" href="${xmlText(`${siteUrl}zh/`)}"/>\n    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlText(siteUrl)}"/>\n  </url>`).join('\n')}\n</urlset>\n`;
  const llms = `# StackPerch\n\n> StackPerch, formerly KeepAny, is a local digital asset workspace for independent developers. It connects projects, domains recorded in project details, accounts, subscriptions, and maintenance.\n\n## Product facts\n\n- Local React application; English and Simplified Chinese interfaces.\n- Local use does not require registration or payment.\n- Source code uses AGPL-3.0-only; third-party materials retain their own licenses.\n- Portable preview requires Node.js 22+ and runs at http://127.0.0.1:4180/.\n- The repository, public website, downloads, and issue tracker keep the existing KeepAny addresses. New portable packages use the StackPerch name; older KeepAny packages remain available.\n- The rename preserves browser storage at the same origin and profile. Existing KeepAny .ka1 backups and .kdbx vaults remain usable with their original passwords.\n- Browser data is separated by origin and profile. Clearing site data can remove it. Download and verify encrypted .ka1 backups.\n- A separate encrypted KDBX vault stores passwords and persistent model keys. It is excluded from ordinary assets, global search, MCP, and asset sync.\n- AI is optional. The vault's explicitly approved full-text AI import sends the current list, which may include passwords and notes, to the selected provider. It does not send the existing vault or master password.\n- Early preview: not independently security-audited, and not verified on every device or browser.\n- Official cloud sync and paid services are not open. Optional hosting is planned; commercial expansion is paused.\n- Password autofill, cross-device password sync, background email, and closed-page push are not provided.\n- Experimental sync, account-binding, remote storage, and MCP are not necessary for local trial.\n\n## Public pages\n\n- [English product page](${siteUrl})\n- [中文产品介绍](${siteUrl}zh/)\n- [English README](${repositoryUrl}/blob/main/README.en.md)\n- [中文 README](${repositoryUrl}/blob/main/README.md)\n- [Trial guide](${repositoryUrl}/blob/main/docs/试用指南.md)\n- [Releases](${repositoryUrl}/releases)\n- [Security reporting](${repositoryUrl}/blob/main/SECURITY.md)\n- [Contributing](${repositoryUrl}/blob/main/CONTRIBUTING.md)\n\nThis file describes the public product documentation. It does not grant access to users' local records, passwords, backups, or private services, and does not promise search ranking or recommendations.\n`;
  await Promise.all([
    writeFile(join(output, 'robots.txt'), robots),
    writeFile(join(output, 'sitemap.xml'), sitemap),
    writeFile(join(output, 'llms.txt'), llms),
  ]);
  const html = await readFile(join(output, 'index.html'), 'utf8');
  if (html.includes('type="module"') || html.includes('service-worker') || !html.includes('<h1')) throw Error('Public page must contain readable static content without an app runtime');
  process.stdout.write(`Built public documentation: ${output}\nCanonical base: ${siteUrl}\nDownload link: ${downloadUrl}\nrobots.txt at this path is only a template; verify the domain-root policy after deployment.\n`);
} finally {
  await rm(renderer, { force: true });
}
