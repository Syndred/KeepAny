import { expect, test, type BrowserContext } from "@playwright/test";
import { pdf } from "./fixtures/pdf";
import { sourceModuleUrl } from "./helpers/source-module-url";

type PdfFault = "none" | "text-and-terminate" | "terminate" | "handshake";
type PdfWorkerEvent = { workerId: number; direction: "to-worker" | "from-worker"; action: string; blocked: boolean; at: number };
type PdfTimeoutProbe = { fault: PdfFault; workers: { id: number; terminated: boolean }[]; events: PdfWorkerEvent[]; unhandled: number };
declare global { interface Window { pdfTimeoutProbe: PdfTimeoutProbe } }
declare global { interface Window { pdfFallbackProbe: { faults: number; terminated: number } } }

async function observeRealPdfWorker(context: BrowserContext, fault: PdfFault) {
	await context.addInitScript((dropMessages) => {
		if (location.protocol === "http:" || location.protocol === "https:") localStorage.setItem("keepany-language", "en");
		window.pdfTimeoutProbe = { fault: dropMessages, workers: [], events: [], unhandled: 0 };
		window.addEventListener("unhandledrejection", () => { window.pdfTimeoutProbe.unhandled++; });
		const NativeWorker = window.Worker;
		window.Worker = class extends NativeWorker {
			private pdfId?: number;
			constructor(url: string | URL, options?: WorkerOptions) {
				super(url, options);
				if (!/pdf[.-]worker/.test(new URL(url, location.href).pathname) || options?.type !== "module") return;
				this.pdfId = window.pdfTimeoutProbe.workers.length;
				window.pdfTimeoutProbe.workers.push({ id: this.pdfId, terminated: false });
				const workerId = this.pdfId;
				this.addEventListener("message", (event) => {
					if (typeof event.data?.action === "string") window.pdfTimeoutProbe.events.push({
						workerId, direction: "from-worker", action: event.data.action, blocked: false, at: performance.now(),
					});
				});
			}
			override postMessage(message: unknown, transferOrOptions: Transferable[] | StructuredSerializeOptions = []) {
				if (this.pdfId !== undefined && message && typeof message === "object" && "action" in message && typeof message.action === "string") {
					const mode = window.pdfTimeoutProbe.fault;
					const blocked = (mode === "text-and-terminate" || mode === "terminate") && message.action === "Terminate"
						|| mode === "text-and-terminate" && message.action === "GetTextContent"
						|| mode === "handshake" && message.action === "test";
					window.pdfTimeoutProbe.events.push({ workerId: this.pdfId, direction: "to-worker", action: message.action, blocked, at: performance.now() });
					// Lose only these outbound messages. All document loading, page
					// parsing and other replies still use the official real worker.
					if (blocked) return;
				}
				if (Array.isArray(transferOrOptions)) super.postMessage(message, transferOrOptions);
				else super.postMessage(message, transferOrOptions);
			}
			override terminate() {
				if (this.pdfId !== undefined) window.pdfTimeoutProbe.workers[this.pdfId].terminated = true;
				super.terminate();
			}
		};
	}, fault);
}

const ordinaryRecordCount = async (page: import("@playwright/test").Page) => process.env.KEEPANY_PDF_RELEASE === "1" ? page.evaluate(async () => {
	// Production has no source-module URLs. Inspect the existing RxDB Dexie
	// records database read-only; never create a missing database or write rows.
	const name = "rxdb-dexie-keepany-v1--0--records";
	if (!(await indexedDB.databases()).some(database => database.name === name)) throw Error("records database missing");
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(name);
		request.onupgradeneeded = () => { request.transaction?.abort(); reject(Error("unexpected database creation")); };
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
	});
	try {
		return await new Promise<number>((resolve, reject) => {
			const request = database.transaction("docs", "readonly").objectStore("docs").getAll();
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result.filter((row: { type: string; _deleted: boolean | number }) =>
				!row._deleted && (row.type === "asset" || row.type === "history")).length);
		});
	} finally { database.close(); }
}) : page.evaluate(async (module) => {
	const { allRecords } = await import(module);
	return (await allRecords()).filter((row: { type: string }) => row.type === "asset" || row.type === "history").length;
}, sourceModuleUrl("packages/local-db/src/index.ts"));

test("legal synthetic PDF uses the official worker and closes it after text extraction", async ({ browser }, info) => {
	const context = await browser.newContext({ viewport: { width: 412, height: 820 } });
	await observeRealPdfWorker(context, "none");
	const page = await context.newPage();
	try {
		await page.goto("/intake");
		await page.getByRole("button", { name: "PDF document", exact: true }).click();
		await page.locator("#csv-file").setInputFiles({ name: "worker-timeout-control.pdf", mimeType: "application/pdf",
			buffer: pdf(["Synthetic timeout cleanup control"], false, { inheritedResources: true }) });
		await expect(page.locator(".intake-review-row")).toHaveCount(1);
		await expect(page.locator(".intake-review-row").getByLabel("Short description")).toHaveValue("Synthetic timeout cleanup control");
		await expect(page.locator("#csv-file")).toBeEnabled();
		const probe = await page.evaluate(() => window.pdfTimeoutProbe);
		expect(probe.workers).toHaveLength(1);
		expect(probe.events.some(event => event.direction === "from-worker" && event.action === "GetDoc")).toBe(true);
		expect(probe.events.some(event => event.action === "GetTextContent" && !event.blocked)).toBe(true);
		expect(probe.events.some(event => event.action === "Terminate" && !event.blocked)).toBe(true);
		expect(probe.workers.every(worker => worker.terminated)).toBe(true);
		expect(await ordinaryRecordCount(page)).toBe(0);
		expect(probe.unhandled).toBe(0);
		await info.attach("real-worker-control", { body: JSON.stringify(probe), contentType: "application/json" });
	} finally {
		await info.attach("real-worker-final", { body: JSON.stringify(await page.evaluate(() => window.pdfTimeoutProbe).catch(() => null)), contentType: "application/json" });
		await context.close();
	}
});

test("PDF initialization handshake loss returns the original 30s timeout and terminates the created worker", async ({ browser }, info) => {
	const context = await browser.newContext({ viewport: { width: 412, height: 820 } });
	await observeRealPdfWorker(context, "handshake");
	const page = await context.newPage();
	try {
		await page.goto("/intake");
		await page.getByRole("button", { name: "PDF document", exact: true }).click();
		await expect(page.locator("#csv-file")).toBeEnabled();
		const startedAt = Date.now();
		await page.locator("#csv-file").setInputFiles({ name: "worker-handshake-loss.pdf", mimeType: "application/pdf",
			buffer: pdf(["Synthetic initialization ownership control"], false, { inheritedResources: true }) });
		// The unmodified worker module must actually announce ready. Only its
		// outbound test requests are lost; no parsed data or reply is fabricated.
		await expect.poll(() => page.evaluate(() => window.pdfTimeoutProbe.events.some(event => event.direction === "from-worker" && event.action === "ready"))).toBe(true);
		await expect(page.locator("#csv-file")).toBeDisabled();
		const timeoutNotice = page.locator('.notice[role="status"]').filter({ hasText: /Reading the PDF timed out/ });
		const returnedWithinBudget = await timeoutNotice.waitFor({ state: "visible", timeout: Math.max(1, 35_000 - (Date.now() - startedAt)) })
			.then(() => true, () => false);
		const probe = await page.evaluate(() => window.pdfTimeoutProbe);
		const observed = { fault: "handshake", elapsedMs: Date.now() - startedAt, returnedWithinBudget, probe,
			inputEnabled: await page.locator("#csv-file").isEnabled(), ordinaryRecords: await ordinaryRecordCount(page),
			reviewRows: await page.locator(".intake-review-row").count(), notice: await page.locator('.notice[role="status"]').allTextContents() };
		await info.attach("worker-handshake-timeout-observation", { body: JSON.stringify(observed, null, 2), contentType: "application/json" });
		await page.screenshot({ path: info.outputPath("pdf-handshake-after-real-deadline.png"), fullPage: true, timeout: 5_000 });
		expect(probe.workers).toHaveLength(1);
		expect(probe.events.filter(event => event.action === "test" && event.blocked).length).toBeGreaterThanOrEqual(1);
		expect(probe.events.some(event => event.direction === "from-worker" && event.action === "ready")).toBe(true);
		expect(probe.events.some(event => event.action === "GetDoc")).toBe(false);
		expect(observed.elapsedMs).toBeGreaterThanOrEqual(29_500);
		expect(returnedWithinBudget).toBe(true);
		expect(observed.inputEnabled).toBe(true);
		expect(observed.ordinaryRecords).toBe(0);
		expect(observed.reviewRows).toBe(0);
		expect(probe.workers.every(worker => worker.terminated), "The product must own and terminate the raw worker even before the initialization handshake completes").toBe(true);
		expect(probe.unhandled).toBe(0);
	} finally {
		await info.attach("real-worker-final", { body: JSON.stringify(await page.evaluate(() => window.pdfTimeoutProbe).catch(() => null)), contentType: "application/json" });
		await context.close();
	}
});

for (const fault of ["text-and-terminate", "terminate"] as const) test(`PDF ${fault} message loss returns the original 30s timeout, releases resources and permits a new read`, async ({ browser }, info) => {
	test.setTimeout(100_000);
	const context = await browser.newContext({ viewport: { width: 412, height: 820 } });
	await observeRealPdfWorker(context, fault);
	const page = await context.newPage();
	try {
		await page.goto("/intake");
		await page.getByRole("button", { name: "PDF document", exact: true }).click();
		const attempts = fault === "text-and-terminate" ? 2 : 1;
		for (let attempt = 0; attempt < attempts; attempt++) {
			const startedAt = Date.now();
			await page.locator("#csv-file").setInputFiles({ name: `worker-message-loss-${attempt}.pdf`, mimeType: "application/pdf",
				buffer: pdf(["Synthetic timeout cleanup control"], false, { inheritedResources: true }) });
			await expect.poll(() => page.evaluate((id) => window.pdfTimeoutProbe.events.some(event => event.workerId === id && event.action === "GetTextContent"), attempt)).toBe(true);
			await expect(page.locator("#csv-file")).toBeDisabled();
			const timeoutNotice = page.locator('.notice[role="status"]').filter({ hasText: /Reading the PDF timed out/ });
			// The 5s allowance observes the real 30s product deadline. No fake
			// timers, sped-up clock or parser replacement are used.
			const returnedWithinBudget = await timeoutNotice.waitFor({ state: "visible", timeout: Math.max(1, 35_000 - (Date.now() - startedAt)) })
				.then(() => true, () => false);
			const probe = await page.evaluate(() => window.pdfTimeoutProbe);
			const events = probe.events.filter(event => event.workerId === attempt);
			const observed = { fault, attempt, elapsedMs: Date.now() - startedAt, returnedWithinBudget, probe,
				inputEnabled: await page.locator("#csv-file").isEnabled(), ordinaryRecords: await ordinaryRecordCount(page),
				reviewRows: await page.locator(".intake-review-row").count(), notice: await page.locator('.notice[role="status"]').allTextContents() };
			await info.attach(`worker-timeout-cleanup-observation-${attempt}`, { body: JSON.stringify(observed, null, 2), contentType: "application/json" });
			await page.screenshot({ path: info.outputPath(`pdf-${fault}-attempt-${attempt}-after-real-deadline.png`), fullPage: true, timeout: 5_000 });
			expect(probe.workers).toHaveLength(attempt + 1);
			expect(events.some(event => event.direction === "from-worker" && event.action === "GetDoc")).toBe(true);
			expect(events.filter(event => event.action === "GetTextContent" && event.blocked)).toHaveLength(fault === "text-and-terminate" ? 1 : 0);
			expect(events.filter(event => event.action === "Terminate" && event.blocked)).toHaveLength(1);
			expect(observed.ordinaryRecords).toBe(0);
			expect(observed.reviewRows).toBe(0);
			expect(observed.elapsedMs).toBeGreaterThanOrEqual(29_500);
			expect(returnedWithinBudget, "A non-acknowledging worker must not extend the original PDF timeout indefinitely").toBe(true);
			expect(observed.inputEnabled).toBe(true);
			expect(probe.workers.every(worker => worker.terminated), "Only the product may release its own real workers before timeout completion").toBe(true);
			expect(probe.unhandled).toBe(0);
		}
		await page.evaluate(() => { window.pdfTimeoutProbe.fault = "none"; });
		await page.locator("#csv-file").setInputFiles({ name: "worker-recovered.pdf", mimeType: "application/pdf",
			buffer: pdf(["Synthetic recovered worker text"], false, { inheritedResources: true }) });
		await expect(page.locator(".intake-review-row")).toHaveCount(1);
		await expect(page.locator(".intake-review-row").getByLabel("Short description")).toHaveValue("Synthetic recovered worker text");
		await expect(page.locator("#csv-file")).toBeEnabled();
		const recovered = await page.evaluate(() => window.pdfTimeoutProbe);
		expect(recovered.workers).toHaveLength(attempts + 1);
		expect(recovered.workers.every(worker => worker.terminated)).toBe(true);
		expect(recovered.unhandled).toBe(0);
		expect(await ordinaryRecordCount(page)).toBe(0);
		await info.attach("same-context-recovered", { body: JSON.stringify(recovered), contentType: "application/json" });
	} finally {
		await info.attach("real-worker-final", { body: JSON.stringify(await page.evaluate(() => window.pdfTimeoutProbe).catch(() => null)), contentType: "application/json" });
		await context.close();
	}
});

for (const fault of ["constructor", "module"] as const) test(`PDF official fallback remains usable after a real worker ${fault} failure`, async ({ browser }, info) => {
	const context = await browser.newContext({ viewport: { width: 412, height: 820 } });
	await context.addInitScript((mode) => {
		if (location.protocol === "http:" || location.protocol === "https:") localStorage.setItem("keepany-language", "en");
		window.pdfFallbackProbe = { faults: 0, terminated: 0 };
		const NativeWorker = window.Worker;
		window.Worker = class extends NativeWorker {
			private pdfWorker: boolean;
			constructor(url: string | URL, options?: WorkerOptions) {
				const pdfWorker = /pdf[.-]worker/.test(new URL(url, location.href).pathname) && options?.type === "module";
				if (pdfWorker && mode === "constructor") {
					window.pdfFallbackProbe.faults++;
					throw new DOMException("Synthetic worker constructor failure", "SecurityError");
				}
				// A real missing module causes the native Worker error event. The
				// official main-thread fallback still imports its unmodified URL.
				super(pdfWorker && mode === "module" ? new URL("/synthetic-missing-pdf-worker.js", location.href) : url, options);
				this.pdfWorker = pdfWorker;
				if (pdfWorker) this.addEventListener("error", () => { window.pdfFallbackProbe.faults++; });
			}
			override terminate() {
				if (this.pdfWorker) window.pdfFallbackProbe.terminated++;
				super.terminate();
			}
		};
	}, fault);
	const page = await context.newPage();
	try {
		await page.goto("/intake");
		await page.getByRole("button", { name: "PDF document", exact: true }).click();
		await expect(page.locator("#csv-file")).toBeEnabled();
		await page.locator("#csv-file").setInputFiles({ name: `official-fallback-${fault}.pdf`, mimeType: "application/pdf",
			buffer: pdf(["Synthetic official fallback text"], false, { inheritedResources: true }) });
		await expect.poll(() => page.evaluate(() => window.pdfFallbackProbe.faults)).toBe(1);
		await expect(page.locator("#csv-file")).toBeEnabled({ timeout: 35_000 });
		await expect(page.locator(".intake-review-row")).toHaveCount(1);
		await expect(page.locator(".intake-review-row").getByLabel("Short description")).toHaveValue("Synthetic official fallback text");
		await expect(page.locator("#csv-file")).toBeEnabled();
		const probe = await page.evaluate(() => window.pdfFallbackProbe);
		const mainThreadHandler = await page.evaluate(() => typeof (window as typeof window & {
			pdfjsWorker?: { WorkerMessageHandler?: { setup?: unknown } };
		}).pdfjsWorker?.WorkerMessageHandler?.setup === "function");
		const ordinaryRecords = await ordinaryRecordCount(page);
		await info.attach(`official-fallback-${fault}`, { body: JSON.stringify({ probe, mainThreadHandler, ordinaryRecords,
			inputEnabled: await page.locator("#csv-file").isEnabled(), reviewRows: await page.locator(".intake-review-row").count() }), contentType: "application/json" });
		await page.screenshot({ path: info.outputPath(`official-fallback-${fault}-preview-en.png`), fullPage: true });
		expect(probe.faults).toBe(1);
		expect(probe.terminated).toBe(fault === "module" ? 1 : 0);
		expect(mainThreadHandler).toBe(true);
		expect(ordinaryRecords).toBe(0);
	} finally {
		await info.attach(`official-fallback-${fault}-final`, { body: JSON.stringify(await page.evaluate(() => ({
			probe: window.pdfFallbackProbe,
			inputEnabled: !(document.querySelector<HTMLInputElement>("#csv-file")?.disabled ?? true),
			notice: Array.from(document.querySelectorAll('.notice[role="status"]'), element => element.textContent),
		})).catch(() => null)), contentType: "application/json" });
		await context.close();
	}
});
