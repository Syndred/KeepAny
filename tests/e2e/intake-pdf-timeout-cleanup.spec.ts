import { expect, test, type BrowserContext } from "@playwright/test";
import { pdf } from "./fixtures/pdf";
import { sourceModuleUrl } from "./helpers/source-module-url";

type PdfFault = "none" | "text-and-terminate" | "terminate" | "handshake";
type PdfWorkerEvent = { workerId: number; direction: "to-worker" | "from-worker"; action: string; blocked: boolean; at: number };
type PdfTimeoutProbe = { fault: PdfFault; workers: { id: number; terminated: boolean }[]; events: PdfWorkerEvent[]; unhandled: number };
declare global { interface Window { pdfTimeoutProbe: PdfTimeoutProbe } }

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

const ordinaryRecordCount = async (page: import("@playwright/test").Page) => page.evaluate(async (module) => {
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
