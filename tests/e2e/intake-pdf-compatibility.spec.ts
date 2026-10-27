import { expect, test, type BrowserContext } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { pdf } from './fixtures/pdf';
import { selectChoice } from './helpers/select-choice';
import { sourceModuleUrl } from './helpers/source-module-url';

type Capabilities = { mapComputed: string; fromBase64: string; withResolvers: string };
type ObservedRecord = { type: string; payload: { id: string; kind: string; name: string; description: string } };
declare global { interface Window { pdfCompatibility: { before: Capabilities; workers: { stage: string; capabilities: Capabilities }[]; workerStarts: number; workerMapErrors: number; workerPromiseErrors: number } } }

/** Only remove the two APIs missing on the actual N16 Chrome133 WebView.
 * Real PDF.js module/worker, PDF bytes, extraction and repository writes remain intact.
 */
async function simulateN16MissingApis(context: BrowserContext, promiseGap: 'none' | 'both' | 'worker' = 'none') {
  await context.addInitScript(promiseGap => {
    Reflect.deleteProperty(Map.prototype, 'getOrInsertComputed');
    Reflect.deleteProperty(Uint8Array, 'fromBase64');
    if (promiseGap === 'both') Reflect.deleteProperty(Promise, 'withResolvers');
    const capabilities = () => ({ mapComputed: typeof Reflect.get(Map.prototype, 'getOrInsertComputed'),
      fromBase64: typeof Reflect.get(Uint8Array, 'fromBase64'), withResolvers: typeof Reflect.get(Promise, 'withResolvers') });
    window.pdfCompatibility = { before: capabilities(), workers: [], workerStarts: 0, workerMapErrors: 0, workerPromiseErrors: 0 };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        const workerUrl = new URL(url, location.href);
        if (/pdf\.worker(?:\.min)?\.mjs$/.test(workerUrl.pathname)) workerUrl.searchParams.set('keepany_pdf_test_worker', '1');
        super(workerUrl, options);
        window.pdfCompatibility.workerStarts++;
        this.addEventListener('error', event => {
          if (event.message.includes('withResolvers')) window.pdfCompatibility.workerPromiseErrors++;
        });
        this.addEventListener('message', event => {
          if (event.data?.__keepanyPdfCompatibility) window.pdfCompatibility.workers.push(event.data.__keepanyPdfCompatibility);
          const message = event.data?.reason?.message ?? event.data?.error?.message;
          if (typeof message === 'string' && message.includes('getOrInsertComputed')) window.pdfCompatibility.workerMapErrors++;
        });
      }
    };
  }, promiseGap);
  await context.route(/pdf\.worker(?:\.min)?\.mjs(?:\?.*)?$/, async route => {
    // Only the actual test-owned Worker constructor adds this marker. Vite's
    // ?url importer and PDF.js page-thread fallback never receive the prefix.
    if (new URL(route.request().url()).searchParams.get('keepany_pdf_test_worker') !== '1') {
      await route.continue(); return;
    }
    const response = await route.fetch();
    const probe = (stage: string) => `globalThis.postMessage({__keepanyPdfCompatibility:{stage:${JSON.stringify(stage)},capabilities:{mapComputed:typeof Map.prototype.getOrInsertComputed,fromBase64:typeof Uint8Array.fromBase64,withResolvers:typeof Promise.withResolvers}}});\n`;
    const before = `Reflect.deleteProperty(Map.prototype,'getOrInsertComputed');Reflect.deleteProperty(Uint8Array,'fromBase64');${promiseGap === 'none' ? '' : "Reflect.deleteProperty(Promise,'withResolvers');"}\n${probe('before')}`;
    await route.fulfill({ response, body: `${before}${await response.text()}\n${probe('after')}` });
  });
}

for (const language of ['zh-CN', 'en'] as const) test(`PDF N16 missing APIs ${language} 390 real text/worker/review/error paths`, async ({ browser }, testInfo) => {
  const context = await browser.newContext({ locale: language, viewport: { width: 390, height: 844 }, hasTouch: true });
  await simulateN16MissingApis(context);
  await context.addInitScript(value => localStorage.setItem('keepany-language', value), language);
  const page = await context.newPage(); const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const zh = language === 'zh-CN';
  const records = (): Promise<ObservedRecord[]> => page.evaluate(async module => {
    const { allRecords } = await import(module);
    return (await allRecords()).filter((row: { type: string }) => row.type === 'asset' || row.type === 'history')
      .map((row: { type: string; payload: string }) => ({ type: row.type, payload: JSON.parse(row.payload) }));
  }, sourceModuleUrl('packages/local-db/src/index.ts'));
  try {
    await page.goto('/intake');
    await page.getByRole('button', { name: zh ? 'PDF 文档' : 'PDF document', exact: true }).click();
    const before = await page.evaluate(() => window.pdfCompatibility.before);
    expect(before).toEqual({ mapComputed: 'undefined', fromBase64: 'undefined', withResolvers: 'function' });
    const file = pdf(['Synthetic invoice reference 123', 'Service total USD 12.00'], false, { inheritedResources: true });
    await page.locator('#csv-file').setInputFiles({ name: 'compatibility-invoice.pdf', mimeType: 'application/pdf', buffer: file });
    const rows = page.locator('.intake-review-row');
    await expect(rows).toHaveCount(1);
    const row = rows.first(); const batch = page.locator('.intake-review-batch').filter({ has: row });
    await batch.getByText(zh ? '查看提取原文' : 'View extracted text', { exact: true }).click();
    await expect(batch.locator('.intake-review-original pre')).toContainText('Service total USD 12.00');
    const extracted = await batch.locator('.intake-review-original pre').textContent();
    expect(extracted).toMatch(/Synthetic invoice reference 123\s+Service total USD 12\.00/);
    expect(await records()).toEqual([]);
    const confirm = row.getByRole('button', { name: zh ? '确认入库' : 'Confirm and save', exact: true });
    await expect(confirm).toBeDisabled();
    await expect.poll(() => page.evaluate(() => window.pdfCompatibility.workers.length)).toBeGreaterThanOrEqual(2);
    const probes = await page.evaluate(() => window.pdfCompatibility.workers);
    expect(probes.find(probe => probe.stage === 'before')?.capabilities).toEqual(before);
    await testInfo.attach('worker-and-main-capabilities', { body: JSON.stringify({ before, probes }), contentType: 'application/json' });
    await page.screenshot({ path: testInfo.outputPath(`pdf-compatibility-preview-${language}.png`), fullPage: true });
    await selectChoice(row.getByLabel(zh ? '资料类型' : 'Record type'), 'project');
    await row.getByLabel(zh ? '名称' : 'Name', { exact: true }).fill('Synthetic reviewed PDF project');
    await confirm.click(); await expect(row).toContainText(zh ? '已确认' : 'Confirmed');
    const saved = await records(); expect(saved).toHaveLength(1); expect(saved[0].type).toBe('asset');
    expect(saved[0].payload).toMatchObject({ kind: 'project', name: 'Synthetic reviewed PDF project', description: extracted });
    const originalId = saved[0].payload.id;
    await page.reload(); await page.getByRole('button', { name: zh ? 'PDF 文档' : 'PDF document', exact: true }).click();
    await page.locator('#csv-file').setInputFiles({ name: 'same-bytes-renamed.pdf', mimeType: 'application/pdf', buffer: file });
    await expect(page.locator('#csv-file')).toBeEnabled();
    await expect(rows).toHaveCount(1); await expect(rows.first()).toContainText(zh ? '已确认' : 'Confirmed');
    expect((await records()).map(row => row.payload.id)).toEqual([originalId]);
    const chinese = pdf(['中文账单服务费用'], true);
    await page.locator('#csv-file').setInputFiles({ name: 'compatibility-chinese.pdf', mimeType: 'application/pdf', buffer: chinese });
    const chineseRow = page.getByRole('region', { name: 'compatibility-chinese.pdf', exact: true }).locator('.intake-review-row');
    await expect(chineseRow.getByLabel(zh ? '简短描述' : 'Short description')).toHaveValue('中文账单服务费用');
    await chineseRow.getByRole('button', { name: zh ? '忽略' : 'Ignore', exact: true }).click(); await expect(chineseRow).toContainText(zh ? '已忽略' : 'Ignored');
    await page.locator('#csv-file').setInputFiles({ name: 'same-chinese.pdf', mimeType: 'application/pdf', buffer: chinese });
    await expect(page.locator('#csv-file')).toBeEnabled();
    await expect(rows).toHaveCount(2); await expect(chineseRow).toContainText(zh ? '已忽略' : 'Ignored');
    for (const [name, buffer, message] of [
      ['blank.pdf', pdf([]), zh ? '未读取到文字' : 'no readable text'],
      ['image-only.pdf', pdf([], false, { imageOnly: true }), zh ? '未读取到文字' : 'no readable text'],
      ['broken.pdf', Buffer.from('%PDF-1.4\n'), zh ? '未生成候选' : 'No candidate'],
      ['oversize.pdf', Buffer.alloc(10 * 1024 * 1024 + 1), '10 MB'],
      ['too-many-pages.pdf', pdf(['Synthetic repeated page'], false, { pageCount: 21 }), zh ? '20 页' : '20 pages'],
      ['too-much-text.pdf', pdf(['X'.repeat(20001)], false, { fontSize: 0.01 }), zh ? '2 万文字' : '20,000'],
    ] as const) {
      await page.locator('#csv-file').setInputFiles({ name, mimeType: 'application/pdf', buffer });
      await expect(page.locator('.notice[role="status"]')).toContainText(message); await expect(rows).toHaveCount(2);
      expect((await records()).map(row => row.payload.id)).toEqual([originalId]);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.pdfCompatibility.workerMapErrors)).toBe(0);
    expect(probes.find(probe => probe.stage === 'after')?.capabilities).toEqual({ mapComputed: 'function', fromBase64: 'function', withResolvers: 'function' });
    await page.screenshot({ path: testInfo.outputPath(`pdf-compatibility-final-${language}.png`), fullPage: true });
  } finally {
    await testInfo.attach('page-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    await testInfo.attach('capability-observations', { body: JSON.stringify(await page.evaluate(() => window.pdfCompatibility).catch(() => null)), contentType: 'application/json' });
    const observed = { capabilities: await page.evaluate(() => window.pdfCompatibility).catch(() => null),
      mainAfter: await page.evaluate(() => ({ mapComputed: typeof Reflect.get(Map.prototype, 'getOrInsertComputed'), fromBase64: typeof Reflect.get(Uint8Array, 'fromBase64'), withResolvers: typeof Reflect.get(Promise, 'withResolvers') })).catch(() => null),
      notice: await page.locator('.notice[role="status"]').textContent().catch(() => null),
      records: await records().then(rows => rows.length).catch(() => null), errors };
    const observationPath = testInfo.outputPath('runtime-observations.json'); writeFileSync(observationPath, JSON.stringify(observed, null, 2));
    await testInfo.attach('runtime-observations', { path: observationPath, contentType: 'application/json' });
    await context.close();
  }
});

test('PDF inherited parent resources control with native browser APIs is a readable valid PDF', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en', viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => localStorage.setItem('keepany-language', 'en'));
  const page = await context.newPage();
  try {
    await page.goto('/intake'); await page.getByRole('button', { name: 'PDF document', exact: true }).click();
    await page.locator('#csv-file').setInputFiles({ name: 'inherited-resources-control.pdf', mimeType: 'application/pdf', buffer: pdf(['Synthetic valid inherited resource text'], false, { inheritedResources: true }) });
    await expect(page.locator('.intake-review-row')).toHaveCount(1);
    await expect(page.locator('.intake-review-row').getByLabel('Short description')).toHaveValue('Synthetic valid inherited resource text');
  } finally { await context.close(); }
});

// The app still advertises WebView111/iOS16.4. Keep this contract as a real
// expected-success test; a legacy label does not waive missing Promise support.
for (const gap of ['both', 'worker'] as const) test(`PDF minimum-runtime Promise gap ${gap} must still preview valid inherited PDF`, async ({ browser }, testInfo) => {
  const context = await browser.newContext({ locale: 'en', viewport: { width: 390, height: 844 } });
  await simulateN16MissingApis(context, gap);
  await context.addInitScript(() => localStorage.setItem('keepany-language', 'en'));
  const page = await context.newPage(); const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const buffer = pdf(['Synthetic valid inherited resource text'], false, { inheritedResources: true });
  try {
    await page.goto('/intake'); await page.getByRole('button', { name: 'PDF document', exact: true }).click();
    expect((await page.evaluate(() => window.pdfCompatibility.before)).withResolvers).toBe(gap === 'both' ? 'undefined' : 'function');
    await page.locator('#csv-file').setInputFiles({ name: 'minimum-runtime-valid.pdf', mimeType: 'application/pdf', buffer });
    await expect(page.locator('.intake-review-row')).toHaveCount(1);
    await expect(page.locator('.intake-review-row').getByLabel('Short description')).toHaveValue('Synthetic valid inherited resource text');
  } finally {
    const directRead = await page.evaluate(async ({ module, bytes }) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          (async () => {
            try { const { readPdfText } = await import(module); await readPdfText(new File([new Uint8Array(bytes)], 'same-synthetic.pdf', { type: 'application/pdf' })); return { outcome: 'read' }; }
            catch (error) { return { outcome: 'rejected', name: error instanceof Error ? error.name : 'unknown', message: error instanceof Error ? error.message : 'unknown' }; }
          })(),
          new Promise(resolve => { timer = setTimeout(() => resolve({ outcome: 'probe-pending' }), 3000); }),
        ]);
      } finally { clearTimeout(timer); }
    }, { module: sourceModuleUrl('apps/web/src/intake-pdf.ts'), bytes: Array.from(buffer) }).catch(() => ({ outcome: 'probe-unavailable' }));
    const observed = { gap, capabilities: await page.evaluate(() => window.pdfCompatibility).catch(() => null),
      notice: await page.locator('.notice[role="status"]').textContent().catch(() => null), errors, directRead };
    const observedPath = testInfo.outputPath('minimum-runtime-observations.json'); writeFileSync(observedPath, JSON.stringify(observed, null, 2));
    await testInfo.attach('minimum-runtime-observations', { path: observedPath, contentType: 'application/json' });
    await context.close();
  }
});
