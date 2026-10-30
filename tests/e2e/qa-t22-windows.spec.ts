import { openBackupPage } from "./helpers/backup-restore";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { connect } from "node:net";
import type { TLSSocket } from "node:tls";
import { chromium, expect, test, type Page } from "@playwright/test";
import { sourceModuleUrl } from "./helpers/source-module-url";
import { selectChoice } from "./helpers/select-choice";

const repo = sourceModuleUrl("packages/local-db/src/index.ts");
const domain = sourceModuleUrl("packages/domain/src/index.ts");
const evidence = "test-results/qa/2026-10-27/evidence/T22-windows";
mkdirSync(evidence, { recursive: true });
const host = "keepany-storage.test";
const password = "T22 synthetic archive password 2026!";
const username = "t22-synthetic-user", appPassword = "t22-synthetic-app-password";
const expectedAuthorization = `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDZ0AAAAASUVORK5CYII=", "base64");

function testTls() {
	const script = `$ErrorActionPreference='Stop'; $rsa=[System.Security.Cryptography.RSA]::Create(2048); $request=[System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=${host}', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1); $san=[System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new(); $san.AddDnsName('${host}'); $request.CertificateExtensions.Add($san.Build()); $certificate=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5),[DateTimeOffset]::UtcNow.AddDays(1)); @{key=$rsa.ExportPkcs8PrivateKeyPem(); cert=$certificate.ExportCertificatePem()} | ConvertTo-Json -Compress`;
	return JSON.parse(execFileSync("pwsh", ["-NoProfile", "-Command", script], { encoding: "utf8", windowsHide: true })) as { key: string; cert: string };
}
async function storage(kind: "s3" | "webdav") {
	const requests: { method: string; path: string; status: number; bytes: number; authenticated: boolean; tls: string | null }[] = [];
	const state = { bytes: null as Buffer | null, deny: false, disconnectPut: false, corrupt: false, hold: false, waiting: false, connections: 0, tlsErrors: [] as string[], release: () => {} };
	const server: Server = createServer(testTls(), async (request, response) => {
		const url = new URL(request.url ?? "/", `https://${host}`), method = request.method ?? "GET";
		const headers = { "access-control-allow-origin": "http://127.0.0.1:4205", "access-control-allow-methods": "GET,PUT,OPTIONS", "access-control-allow-headers": "authorization,content-type", "access-control-allow-private-network": "true", "cache-control": "no-store" };
		for (const [key, value] of Object.entries(headers)) response.setHeader(key, value);
		if (method === "OPTIONS") { response.writeHead(204); response.end(); return; }
		const download = url.pathname === "/download.ka1" && url.searchParams.get("signature") === "download";
		const authenticated = !state.deny && (download || (kind === "webdav" ? request.headers.authorization === expectedAuthorization : url.searchParams.get("signature") === (method === "PUT" ? "write" : "read")));
		const log = (status: number, bytes = 0) => requests.push({ method, path: url.pathname, status, bytes, authenticated, tls: (request.socket as TLSSocket).getProtocol() });
		if (!authenticated) { log(401); response.writeHead(401); response.end(); return; }
		if (method === "PUT") {
			if (state.disconnectPut) { log(0); request.socket.destroy(); return; }
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(Buffer.from(chunk));
			state.bytes = Buffer.concat(chunks); log(201, state.bytes.length); response.writeHead(201); response.end(); return;
		}
		if (method === "GET" && state.bytes) {
			if (state.hold) { state.waiting = true; await new Promise<void>(resolve => { state.release = resolve; }); state.waiting = false; }
			const bytes = Buffer.from(state.bytes);
			if (state.corrupt) bytes[bytes.length - 1] ^= 1;
			log(200, bytes.length);
			response.writeHead(200, { "content-type": "application/octet-stream", "content-length": bytes.length, ...(download ? { "content-disposition": 'attachment; filename="T22-remote.ka1"' } : {}) });
			response.end(bytes); return;
		}
		log(404); response.writeHead(404); response.end();
	});
	server.on("connection", () => { state.connections++; });
	server.on("tlsClientError", error => { state.tlsErrors.push(error.message); });
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw Error("test storage did not listen");
	const proxy = createHttpServer((_request, response) => { response.writeHead(403); response.end(); });
	const tunnels = new Set<import("node:net").Socket>();
	proxy.on("connect", (request, downstream, head) => {
		if (request.url !== `${host}:${address.port}`) { downstream.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
		const upstream = connect(address.port, "127.0.0.1"); tunnels.add(upstream);
		upstream.on("close", () => tunnels.delete(upstream));
		upstream.on("error", () => downstream.destroy());
		downstream.on("error", () => upstream.destroy());
		upstream.on("connect", () => { downstream.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head.length) upstream.write(head); downstream.pipe(upstream); upstream.pipe(downstream); });
	});
	await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
	const proxyAddress = proxy.address();
	if (!proxyAddress || typeof proxyAddress === "string") throw Error("test proxy did not listen");
	return { state, requests, url: `https://${host}:${address.port}`, proxyUrl: `http://127.0.0.1:${proxyAddress.port}`, close: async () => { state.release(); for (const socket of tunnels) socket.destroy(); proxy.closeAllConnections(); server.closeAllConnections(); await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => proxy.close(() => resolve()))]); } };
}
async function snapshot(page: Page) {
	return page.evaluate(async path => {
		const { localRepository } = await import(path);
		const db = await localRepository();
		const rows = (await db.allRecords()).map(({ id, type, payload }: { id: string; type: string; payload: string }) => ({ id, type, payload })).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));
		const files = await Promise.all((await db.fileStore.blobs.toArray()).map(async (file: { id: string; name: string; blob: Blob }) => ({ id: file.id, name: file.name, type: file.blob.type, bytes: Array.from(new Uint8Array(await file.blob.arrayBuffer())) })));
		return { rows, files: files.sort((a, b) => a.id.localeCompare(b.id)) };
	}, repo);
}
async function openPanel(page: Page) {
	const section = page.locator("details.intake-secondary").filter({ has: page.locator(".remote-backup-panel") });
	if (await section.getAttribute("open") === null) await section.locator("summary").click();
	return section.locator(".remote-backup-panel");
}

for (const kind of ["s3", "webdav"] as const) for (const { locale, width } of [{ locale: "zh-CN", width: 390 }, { locale: "en-US", width: 1280 }] as const) {
	test(`${kind} ${locale} ${width}px T22 actual loopback HTTPS encryption, readback, failure and downloaded recovery`, async () => {
		test.setTimeout(130_000);
		const service = await storage(kind);
		const browser = await chromium.launch({ proxy: { server: service.proxyUrl, bypass: "127.0.0.1,localhost" } });
		const zh = locale === "zh-CN";
		const copy = { upload: zh ? "加密上传并核对" : "Encrypt, upload and verify", stored: zh ? "已上传并读回核对" : "Uploaded and checked", preview: zh ? "读取并预览远端备份" : "Read and preview remote backup", ready: zh ? "远端备份已核对" : "Remote backup verified", receipt: zh ? "保存校验凭条" : "Save receipt" };
		const contextOptions = { locale, viewport: { width, height: 900 }, acceptDownloads: true, ignoreHTTPSErrors: true };
		const source = await browser.newContext(contextOptions);
		await source.addInitScript(language => localStorage.setItem("keepany-language", language), zh ? "zh-CN" : "en");
		const page = await source.newPage();
		const errors: string[] = [];
		const networkFailures: string[] = [];
		page.on("pageerror", e => errors.push(e.message));
		page.on("requestfailed", request => networkFailures.push(`${new URL(request.url()).origin}${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
		page.on("console", message => { if (message.type() === "error") networkFailures.push(message.text()); });
		async function configure(target: Page, readOnly = false) {
			const panel = await openPanel(target);
			if (kind === "s3") { if (!readOnly) await panel.locator("#remote-put-url").fill(`${service.url}/object.ka1?signature=write`); await panel.locator("#remote-get-url").fill(`${service.url}/object.ka1?signature=read`); }
			else { await selectChoice(panel.locator("#remote-kind"), "webdav"); await panel.locator("#remote-dav-url").fill(`${service.url}/object.ka1`); await panel.locator("#remote-dav-user").fill(username); await panel.locator("#remote-dav-password").fill(appPassword); }
			return panel;
		}
		try {
			await page.goto("/intake");
			const fixture = await page.evaluate(async ({ repositoryPath, domainPath, image }) => {
				const { localRepository, saveBatch } = await import(repositoryPath);
				const { newAsset, taskSchema, relationSchema } = await import(domainPath);
				const db = await localRepository();
				const bytes = Uint8Array.from(atob(image), char => char.charCodeAt(0));
				const imageId = await db.putFile(new File([bytes], "T22-original.png", { type: "image/png" }));
				const project = { ...newAsset("project"), name: "T22 synthetic original project", attachments: [imageId] };
				const account = { ...newAsset("account"), name: "T22 synthetic related account" };
				const relation = relationSchema.parse({ id: crypto.randomUUID(), from: project.id, to: account.id, label: "T22 owner", source: "Synthetic record", createdAt: new Date().toISOString() });
				const task = taskSchema.parse({ id: crypto.randomUUID(), assetId: project.id, name: "T22 pending check", createdAt: new Date().toISOString() });
				await saveBatch([{ type: "asset", value: project }, { type: "asset", value: account }, { type: "relation", value: relation }, { type: "task", value: task }]);
				return { projectId: project.id, imageId };
			}, { repositoryPath: repo, domainPath: domain, image: png.toString("base64") });
			const baseline = await snapshot(page);
			await openBackupPage(page); await page.locator("#backup-password").fill(password);
			const panel = await configure(page);
			const notice = panel.locator(".notice[role=status]");
			// Authentication denial, actual socket disconnect, and corrupt readback.
			service.state.deny = true;
			await panel.getByRole("button", { name: copy.upload, exact: true }).click();
			await expect(notice).toBeVisible({ timeout: 35_000 }); await expect(notice).not.toContainText(copy.stored);
			await expect(panel.getByRole("link", { name: copy.receipt, exact: true })).toHaveCount(0);
			expect(service.requests.at(-1)?.status, JSON.stringify({ notice: await notice.textContent(), networkFailures, requests: service.requests, connections: service.state.connections, tlsErrors: service.state.tlsErrors })).toBe(401); service.state.deny = false;
			service.state.disconnectPut = true;
			await panel.getByRole("button", { name: copy.upload, exact: true }).click();
			await expect(notice).toBeVisible(); await expect(notice).not.toContainText(copy.stored);
			expect(service.requests.some(request => request.status === 0)).toBe(true);
			service.state.disconnectPut = false;
			service.state.corrupt = true;
			await panel.getByRole("button", { name: copy.upload, exact: true }).click();
			await expect(notice).toContainText(zh ? "校验凭条" : "receipt");
			await expect(panel.getByRole("link", { name: copy.receipt, exact: true })).toHaveCount(0);
			service.state.corrupt = false; service.state.hold = true;
			await panel.getByRole("button", { name: copy.upload, exact: true }).click();
			await expect.poll(() => service.state.waiting).toBe(true);
			await expect(panel.getByRole("button", { name: copy.upload, exact: true })).toBeDisabled();
			await expect(panel.getByRole("link", { name: copy.receipt, exact: true })).toHaveCount(0);
			await expect(notice).toHaveCount(0);
			service.state.hold = false; service.state.release();
			await expect(notice).toContainText(copy.stored);
			expect(service.state.bytes?.subarray(0, 8).toString()).toBe("KEEPANY1");
			expect(service.state.bytes?.includes(Buffer.from("T22 synthetic original project"))).toBe(false);
			expect(service.state.bytes?.includes(png)).toBe(false);
			const receiptDownload = page.waitForEvent("download");
			await panel.getByRole("link", { name: copy.receipt, exact: true }).click();
			const receiptPath = test.info().outputPath("T22-receipt.json"); await (await receiptDownload).saveAs(receiptPath);
			const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
			if (!service.state.bytes) throw Error("test storage ciphertext missing");
			expect(receipt.ciphertextSha256).toBe(createHash("sha256").update(service.state.bytes).digest("hex"));
			expect(receipt.ciphertextSize).toBe(service.state.bytes?.length);
			expect(readFileSync(receiptPath, "utf8")).not.toContain(appPassword);
			await page.reload();
			await expect(page.locator("#backup-password")).toHaveValue("");
			await expect(page.locator("#remote-receipt")).toHaveValue("");
			expect(await snapshot(page)).toEqual(baseline);
			// Invalid remote reads preserve an independent environment's local record.
			const target = await browser.newContext(contextOptions);
			await target.addInitScript(language => localStorage.setItem("keepany-language", language), zh ? "zh-CN" : "en");
			const targetPage = await target.newPage(); targetPage.on("pageerror", e => errors.push(e.message));
			await targetPage.goto("/intake");
			await targetPage.evaluate(async ([repositoryPath, domainPath]) => { const { save } = await import(repositoryPath); const { newAsset } = await import(domainPath); await save("asset", { ...newAsset("project"), name: "T22 local sentinel retained" }); }, [repo, domain]);
			const retained = await snapshot(targetPage);
			const targetPanel = await configure(targetPage, true);
			await targetPanel.locator("#remote-receipt-file").setInputFiles(receiptPath);
			await openBackupPage(targetPage); await targetPage.locator("#backup-password").fill("T22 wrong synthetic archive password");
			await targetPanel.getByRole("button", { name: copy.preview, exact: true }).click();
			await expect(targetPanel.locator(".notice")).toContainText(zh ? "无法解密" : "Could not decrypt");
			await expect(targetPanel.getByRole("button", { name: /^(确认|Confirm) ·/ })).toHaveCount(0);
			expect(await snapshot(targetPage)).toEqual(retained);
			await openBackupPage(targetPage); await targetPage.locator("#backup-password").fill(password); service.state.corrupt = true;
			await targetPanel.getByRole("button", { name: copy.preview, exact: true }).click();
			await expect(targetPanel.locator(".notice")).toContainText(zh ? "校验凭条" : "receipt");
			await expect(targetPanel.getByRole("button", { name: /^(确认|Confirm) ·/ })).toHaveCount(0);
			expect(await snapshot(targetPage)).toEqual(retained); service.state.corrupt = false;
			await targetPanel.getByRole("button", { name: copy.preview, exact: true }).click();
			await expect(targetPanel.locator(".notice")).toContainText(copy.ready);
			expect(await snapshot(targetPage)).toEqual(retained);
			if ((kind === "s3" && !zh) || (kind === "webdav" && zh)) await targetPanel.screenshot({ path: `${evidence}/T22-${kind}-${locale}-${width}.png` });
			// Obtain the actual encrypted object by native browser HTTPS download.
			const clean = await browser.newContext(contextOptions);
			await clean.addInitScript(language => localStorage.setItem("keepany-language", language), zh ? "zh-CN" : "en");
			const cleanPage = await clean.newPage(); cleanPage.on("pageerror", e => errors.push(e.message));
			const downloading = cleanPage.waitForEvent("download");
			await cleanPage.goto(`${service.url}/download.ka1?signature=download`).catch(() => {});
			const archivePath = test.info().outputPath("T22-actual-remote.ka1"); await (await downloading).saveAs(archivePath);
			expect(readFileSync(archivePath)).toEqual(service.state.bytes);
			await cleanPage.goto("/intake");
			await openBackupPage(cleanPage); await cleanPage.locator("#backup-password").fill(password);
			await cleanPage.locator("#restore-file").setInputFiles(archivePath);
			await cleanPage.getByRole("button", { name: zh ? "预览" : "Preview", exact: true }).first().click();
			await cleanPage.getByRole("button", { name: /^(确认|Confirm) ·/ }).click();
			await expect(cleanPage.getByText(zh ? /已恢复 \d+ 条记录/ : /Restored \d+ records/)).toBeVisible();
			expect(await snapshot(cleanPage)).toEqual(baseline);
			await cleanPage.reload(); expect(await snapshot(cleanPage)).toEqual(baseline);
			await cleanPage.goto(`/assets/project/${fixture.projectId}`);
			const material = cleanPage.locator("#asset-project-materials");
			if (await material.getAttribute("open") === null) await material.locator(":scope > summary").click();
			await expect(cleanPage.locator(".asset-attachments-card img")).toHaveCount(1);
			await expect(cleanPage.locator(".asset-attachments-card img")).toHaveJSProperty("naturalWidth", 1);
			expect(service.requests.filter(request => request.status > 0).every(request => request.tls?.startsWith("TLS"))).toBe(true);
			expect(service.requests.filter(request => request.status === 201 || request.status === 200).every(request => request.authenticated)).toBe(true);
			expect(errors).toEqual([]);
			writeFileSync(`${evidence}/T22-${kind}-${locale}-${width}-checks.json`, JSON.stringify({ kind, locale, width, fixture, ciphertextBytes: service.state.bytes?.length, ciphertextSha256: receipt.ciphertextSha256, requestLog: service.requests, originalImageBytes: png.length, restoredRows: baseline.rows.length, restoredFiles: baseline.files.length, pageErrors: errors, checks: ["401 rejected", "socket disconnect retried", "corrupt readback rejected", "no receipt before held GET completes", "ciphertext and receipt hash verified", "refresh clears credentials and receipt field", "bad password/tamper preserve local sentinel", "actual HTTPS object downloaded and restored with exact IDs/payloads/image bytes"] }, null, 2));
		} finally { await browser.close(); await service.close(); }
	});
}

