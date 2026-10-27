import { expect, test, type BrowserContext } from "@playwright/test";
import { pdf } from "./fixtures/pdf";
import { sourceModuleUrl } from "./helpers/source-module-url";

type PdfWorkerEvent = { direction: "to-worker" | "from-worker"; action: string; blocked: boolean; at: number };
type PdfTimeoutProbe = { fault: boolean; workers: { id: number; terminated: boolean }[]; events: PdfWorkerEvent[] };
declare global { interface Window { pdfTimeoutProbe: PdfTimeoutProbe } }

async function observeRealPdfWorker(context: BrowserContext, fault: boolean) {
	await context.addInitScript((dropMessages) => {
		if (location.protocol === "http:" || location.protocol === "https:") localStorage.setItem("keepany-language", "en");
		window.pdfTimeoutProbe = { fault: dropMessages, workers: [], events: [] };
		const NativeWorker = window.Worker;
		window.Worker = class extends NativeWorker {
			private pdfId?: number;
			constructor(url: string | URL, options?: WorkerOptions) {
				super(url, options);
				if (!/pdf[.-]worker/.test(new URL(url, location.href).pathname) || options?.type !== "module") return;
				this.pdfId = window.pdfTimeoutProbe.workers.length;
				window.pdfTimeoutProbe.workers.push({ id: this.pdfId, terminated: false });
				this.addEventListener("message", (event) => {
					if (typeof event.data?.action === "string") window.pdfTimeoutProbe.events.push({
						direction: "from-worker", action: event.data.action, blocked: false, at: performance.now(),
					});
				});
			}
			override postMessage(message: unknown, transferOrOptions: Transferable[] | StructuredSerializeOptions = []) {
				if (this.pdfId !== undefined && message && typeof message === "object" && "action" in message && typeof message.action === "string") {
					const blocked = dropMessages && ["GetTextContent", "Terminate"].includes(message.action);
					window.pdfTimeoutProbe.events.push({ direction: "to-worker", action: message.action, blocked, at: performance.now() });
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

const ordinaryRecordCount = async (page: import("@playwright/test").Page) => page.evaluate(async (module) => {
	const { allRecords } = await import(module);
	return (await allRecords()).filter((row: { type: string }) => row.type === "asset" || row.type === "history").length;
}, sourceModuleUrl("packages/local-db/src/index.ts"));

test("legal synthetic PDF uses the official worker and closes it after text extraction", async ({ browser }, info) => {
	const context = await browser.newContext({ viewport: { width: 412, height: 820 } });
	await observeRealPdfWorker(context, false);
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
		await info.attach("real-worker-control", { body: JSON.stringify(probe), contentType: "application/json" });
	} finally {
		await info.attach("real-worker-final", { body: JSON.stringify(await page.evaluate(() => window.pdfTimeoutProbe).catch(() => null)), contentType: "application/json" });
		await context.close();
	}
});

test("PDF text and termination message loss still returns the original 30s timeout and releases the worker and loader", async ({ browser }, info) => {
	test.setTimeout(60_000);
	const context = await browser.newContext({ viewport: { width: 412, height: 820 } });
	await observeRealPdfWorker(context, true);
	const page = await context.newPage();
	try {
		await page.goto("/intake");
		await page.getByRole("button", { name: "PDF document", exact: true }).click();
		const startedAt = Date.now();
		await page.locator("#csv-file").setInputFiles({ name: "worker-message-loss.pdf", mimeType: "application/pdf",
			buffer: pdf(["Synthetic timeout cleanup control"], false, { inheritedResources: true }) });
		await expect.poll(() => page.evaluate(() => window.pdfTimeoutProbe.events.some(event => event.action === "GetTextContent" && event.blocked))).toBe(true);
		await expect(page.locator("#csv-file")).toBeDisabled();
		const timeoutNotice = page.locator('.notice[role="status"]').filter({ hasText: /Reading the PDF timed out/ });
		// This is an observation allowance around the real, unchanged 30s
		// product deadline. No fake timers, sped-up clock or parser replacement.
		const returnedWithinBudget = await timeoutNotice.waitFor({ state: "visible", timeout: Math.max(1, 35_000 - (Date.now() - startedAt)) })
			.then(() => true, () => false);
		const probe = await page.evaluate(() => window.pdfTimeoutProbe);
		const observed = { elapsedMs: Date.now() - startedAt, returnedWithinBudget, probe,
			inputEnabled: await page.locator("#csv-file").isEnabled(), ordinaryRecords: await ordinaryRecordCount(page),
			reviewRows: await page.locator(".intake-review-row").count(), notice: await page.locator('.notice[role="status"]').allTextContents() };
		await info.attach("worker-timeout-cleanup-observation", { body: JSON.stringify(observed, null, 2), contentType: "application/json" });
		await page.screenshot({ path: info.outputPath("pdf-message-loss-after-real-deadline.png"), fullPage: true, timeout: 5_000 });
		expect(probe.workers).toHaveLength(1);
		expect(probe.events.some(event => event.direction === "from-worker" && event.action === "GetDoc")).toBe(true);
		expect(probe.events.filter(event => event.action === "GetTextContent" && event.blocked)).toHaveLength(1);
		expect(probe.events.filter(event => event.action === "Terminate" && event.blocked)).toHaveLength(1);
		expect(observed.ordinaryRecords).toBe(0);
		expect(observed.reviewRows).toBe(0);
		expect(returnedWithinBudget, "A non-acknowledging worker must not extend the original PDF timeout indefinitely").toBe(true);
		expect(observed.inputEnabled).toBe(true);
		expect(probe.workers.every(worker => worker.terminated), "The product must release its own real worker before finishing the timeout").toBe(true);
	} finally {
		await info.attach("real-worker-final", { body: JSON.stringify(await page.evaluate(() => window.pdfTimeoutProbe).catch(() => null)), contentType: "application/json" });
		await context.close();
	}
});
