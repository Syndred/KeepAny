import { expect, test, type Page } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import { serve } from "@hono/node-server";
import { once } from "node:events";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { PostgresSyncService, type SqlPool } from "../../packages/sync-core/src/postgres";
import { createPostgresSyncApp } from "../../apps/sync-server/src/app";
import { selectChoice } from "./helpers/select-choice";

const token = "workspace-key-e2e".padEnd(40, "x");
const otherToken = "other-account-e2e".padEnd(40, "y");
const key = Buffer.from(new Uint8Array(32).fill(17)).toString("base64url");
const webOrigin = `http://127.0.0.1:${process.env.KEEPANY_E2E_PORT ?? "4173"}`;

async function fixture() {
	const pg = new PGlite();
	for (const id of ["001_sync", "003_change_operation_id", "008_key_envelopes"]) {
		await pg.exec(await readFile(new URL(`../../apps/sync-server/migrations/${id}.sql`, import.meta.url), "utf8"));
	}
	let available = Promise.resolve();
	const pool: SqlPool = { connect: async () => {
		const previous = available;
		let release = () => {};
		available = new Promise<void>(resolve => { release = resolve; });
		await previous;
		return { query: (sql, values) => pg.query(sql, values), release };
	} };
	const service = new PostgresSyncService(pool);
	const workspaceId = await service.createWorkspace("self-host-owner");
	const app = createPostgresSyncApp(service, async authorization =>
		authorization === `Bearer ${token}` ? "self-host-owner" : authorization === `Bearer ${otherToken}` ? "other" : null,
		undefined, { webOrigin });
	const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
	if (!server.listening) await once(server, "listening");
	const address = server.address() as AddressInfo;
	return { pg, server, workspaceId, endpoint: `http://127.0.0.1:${address.port}` };
}

async function configure(page: Page, endpoint: string, workspaceId: string, withKey = false, accessToken = token) {
	await page.goto("/settings");
	const inputs = page.locator(".sync-panel .form-grid input");
	await inputs.nth(0).fill(endpoint);
	await inputs.nth(1).fill(accessToken);
	await inputs.nth(2).fill(workspaceId);
	if (withKey) await inputs.nth(3).fill(key);
}

function issued(panel: ReturnType<Page["locator"]>, label: string) {
	const notice = panel.locator(".notice").filter({ hasText: label });
	return {
		id: notice.locator("p").filter({ hasText: "Credential ID" }).locator("code"),
		credential: notice.locator("p").filter({ hasText: "Recovery or join credential" }).locator("code"),
		fingerprint: notice.locator("p").filter({ hasText: "Workspace key fingerprint" }).locator("code"),
	};
}

async function addProject(page: Page) {
	await page.goto("/assets/project");
	await page.getByRole("button", { name: "Add", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name", { exact: true }).fill("Device join proof project");
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(dialog).toBeHidden();
}

async function unlock(page: Page, kind: "join" | "recovery", credential: string, id = "") {
	const panel = page.locator(".key-access-panel");
	await selectChoice(panel.getByLabel("Method"), kind);
	if (kind === "join") await panel.getByLabel("Credential ID").fill(id);
	await panel.getByLabel("Recovery or join credential").fill(credential);
	await panel.getByRole("button", { name: "Check credential and key" }).click();
	return panel;
}

test("join and independent recovery across isolated browsers with a real local ciphertext server", async ({ browser }) => {
	test.setTimeout(180_000);
	const { pg, server, workspaceId, endpoint } = await fixture();
	const sourceContext = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
	const joinContext = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 } });
	const errors: string[] = [];
	const source = await sourceContext.newPage();
	const target = await joinContext.newPage();
	source.on("pageerror", error => errors.push(`source: ${error.message}`));
	target.on("pageerror", error => errors.push(`target: ${error.message}`));
	try {
		await addProject(source);
		await configure(source, endpoint, workspaceId, true);
		await source.locator(".sync-panel").getByRole("button", { name: "Sync now" }).click();
		await expect(source.locator(".sync-panel .notice")).toHaveText("This sync completed");
		const sourcePanel = source.locator(".key-access-panel");
		await sourcePanel.getByRole("button", { name: "Create recovery credential" }).click();
		const recovery = issued(sourcePanel, "Save this recovery credential");
		const recoveryCredential = await recovery.credential.textContent() ?? "";
		const recoveryFingerprint = await recovery.fingerprint.textContent() ?? "";
		expect(recoveryCredential).toMatch(/^ka1_/);
		await sourcePanel.getByRole("button", { name: "Create 10-minute join credential" }).click();
		const join = issued(sourcePanel, "Give the join ID");
		const joinId = await join.id.textContent() ?? "";
		const joinCredential = await join.credential.textContent() ?? "";
		expect(await join.fingerprint.textContent()).toBe(recoveryFingerprint);

		await configure(target, endpoint, workspaceId);
		await target.locator(".sync-panel .form-grid input").nth(1).fill(otherToken);
		let panel = await unlock(target, "join", joinCredential, joinId);
		await expect(panel).toContainText("This account or workspace is not authorized");
		await target.locator(".sync-panel .form-grid input").nth(1).fill(token);
		await sourcePanel.getByRole("button", { name: "Create 10-minute join credential" }).click();
		const revokedJoin = issued(sourcePanel, "Give the join ID");
		await expect.poll(() => revokedJoin.id.textContent()).not.toBe(joinId);
		const revokedId = await revokedJoin.id.textContent() ?? "";
		const revokedCredential = await revokedJoin.credential.textContent() ?? "";
		await sourcePanel.locator(".key-access-list .notice").filter({ hasText: revokedId })
			.getByRole("button", { name: "Revoke future retrieval" }).click();
		panel = await unlock(target, "join", revokedCredential, revokedId);
		await expect(panel).toContainText("Credential unavailable, incorrect, expired or revoked");
		await sourcePanel.getByRole("button", { name: "Create 10-minute join credential" }).click();
		const expiredJoin = issued(sourcePanel, "Give the join ID");
		await expect.poll(() => expiredJoin.id.textContent()).not.toBe(revokedId);
		const expiredId = await expiredJoin.id.textContent() ?? "";
		const expiredCredential = await expiredJoin.credential.textContent() ?? "";
		await pg.query("UPDATE sync_key_envelopes SET expires_at=now()-interval '1 second' WHERE envelope_id=$1", [expiredId]);
		panel = await unlock(target, "join", expiredCredential, expiredId);
		await expect(panel).toContainText("Credential unavailable, incorrect, expired or revoked");
		await sourcePanel.getByRole("button", { name: "Create 10-minute join credential" }).click();
		const lateRevoked = issued(sourcePanel, "Give the join ID");
		await expect.poll(() => lateRevoked.id.textContent()).not.toBe(expiredId);
		const lateRevokedId = await lateRevoked.id.textContent() ?? "";
		const lateRevokedCredential = await lateRevoked.credential.textContent() ?? "";
		panel = await unlock(target, "join", lateRevokedCredential, lateRevokedId);
		await expect(panel).toContainText(recoveryFingerprint);
		await panel.getByLabel("I checked the account, workspace and key fingerprint").check();
		await sourcePanel.locator(".key-access-list .notice").filter({ hasText: lateRevokedId })
			.getByRole("button", { name: "Revoke future retrieval" }).click();
		await panel.getByRole("button", { name: "Use this key, then sync manually" }).click();
		await expect(panel).toContainText("Credential unavailable, incorrect, expired or revoked");
		await expect(target.locator(".sync-panel .form-grid input").nth(3)).toHaveValue("");
		panel = await unlock(target, "join", `ka1_${"a".repeat(43)}`, joinId);
		await expect(panel).toContainText("Credential unavailable, incorrect, expired or revoked");
		await expect(target.locator(".sync-panel .form-grid input").nth(3)).toHaveValue("");
		panel = await unlock(target, "join", joinCredential, joinId);
		await expect(panel).toContainText(`account self-host-owner · workspace ${workspaceId}`);
		await expect(panel).toContainText(recoveryFingerprint);
		await mkdir(path.resolve("docs/evidence/2026-09-29"), { recursive: true });
		await panel.screenshot({ path: path.resolve("docs/evidence/2026-09-29/key-join-en-390-confirm.png") });
		await panel.getByLabel("I checked the account, workspace and key fingerprint").check();
		await panel.getByRole("button", { name: "Use this key, then sync manually" }).click();
		await expect(target.locator(".sync-panel .form-grid input").nth(3)).toHaveValue(key);
		await target.locator(".sync-panel").getByRole("button", { name: "Sync now" }).click();
		await expect(target.locator(".sync-panel .notice")).toHaveText("This sync completed");
		await mkdir(path.resolve("docs/evidence/2026-09-29"), { recursive: true });
		await panel.screenshot({ path: path.resolve("docs/evidence/2026-09-29/key-join-en-390.png") });
		await target.goto("/assets/project");
		await expect(target.getByText("Device join proof project")).toBeVisible();
		await target.reload();
		await expect(target.getByText("Device join proof project")).toBeVisible();

		const rows = await pg.query<{ wrap: unknown }>("SELECT wrap FROM sync_key_envelopes WHERE workspace_id=$1", [workspaceId]);
		for (const row of rows.rows) {
			expect(JSON.stringify(row.wrap)).not.toContain(recoveryCredential);
			expect(JSON.stringify(row.wrap)).not.toContain(joinCredential);
			expect(JSON.stringify(row.wrap)).not.toContain(key);
		}

		await sourceContext.close();
		const recoveryContext = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
		const recovered = await recoveryContext.newPage();
		recovered.on("pageerror", error => errors.push(`recovered: ${error.message}`));
		try {
			await configure(recovered, endpoint, workspaceId);
			const recoveryPanel = await unlock(recovered, "recovery", recoveryCredential);
			await expect(recoveryPanel).toContainText(recoveryFingerprint);
			await recoveryPanel.getByLabel("I checked the account, workspace and key fingerprint").check();
			await recoveryPanel.getByRole("button", { name: "Use this key, then sync manually" }).click();
			await recovered.locator(".sync-panel").getByRole("button", { name: "Sync now" }).click();
			await expect(recovered.locator(".sync-panel .notice")).toHaveText("This sync completed");
			await recoveryPanel.screenshot({ path: path.resolve("docs/evidence/2026-09-29/key-recovery-en-1280.png") });
			await recovered.goto("/assets/project");
			await expect(recovered.getByText("Device join proof project")).toBeVisible();
		} finally { await recoveryContext.close(); }
		const zhContext = await browser.newContext({ locale: "zh-CN", viewport: { width: 390, height: 844 } });
		const zhPage = await zhContext.newPage();
		zhPage.on("pageerror", error => errors.push(`zh: ${error.message}`));
		try {
			await configure(zhPage, endpoint, workspaceId);
			const zhPanel = zhPage.locator(".key-access-panel");
			await zhPanel.getByLabel("恢复或加入凭据").fill(recoveryCredential);
			await zhPanel.getByRole("button", { name: "核对凭据与密钥" }).click();
			await expect(zhPanel).toContainText(recoveryFingerprint);
			await zhPanel.screenshot({ path: path.resolve("docs/evidence/2026-09-29/key-recovery-zh-390-confirm.png") });
			await zhPanel.getByLabel("我已核对账号、工作区和密钥指纹").check();
			await zhPanel.getByRole("button", { name: "使用此密钥，随后手动同步" }).click();
			await zhPage.locator(".sync-panel").getByRole("button", { name: "立即同步" }).click();
			await expect(zhPage.locator(".sync-panel .notice")).toHaveText("本次同步已完成");
			await zhPanel.screenshot({ path: path.resolve("docs/evidence/2026-09-29/key-recovery-zh-390.png") });
			await zhPage.goto("/assets/project");
			await expect(zhPage.getByText("Device join proof project")).toBeVisible();
			expect(await zhPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		} finally { await zhContext.close(); }
		const dirtyContext = await browser.newContext({ locale: "en-US" });
		const dirty = await dirtyContext.newPage();
		dirty.on("pageerror", error => errors.push(`dirty: ${error.message}`));
		try {
			await addProject(dirty);
			await configure(dirty, endpoint, workspaceId);
			const dirtyPanel = await unlock(dirty, "recovery", recoveryCredential);
			await expect(dirtyPanel).toContainText(recoveryFingerprint);
			await dirtyPanel.getByLabel("I checked the account, workspace and key fingerprint").check();
			await dirtyPanel.getByRole("button", { name: "Use this key, then sync manually" }).click();
			await expect(dirtyPanel).toContainText("This browser already has another dataset or binding");
			await expect(dirty.locator(".sync-panel .form-grid input").nth(3)).toHaveValue("");
		} finally { await dirtyContext.close(); }
		expect(errors).toEqual([]);
	} finally {
		await sourceContext.close().catch(() => {});
		await joinContext.close();
		server.close();
		await pg.close();
	}
});
