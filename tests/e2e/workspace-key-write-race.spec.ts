import { expect, test } from "@playwright/test";
import path from "node:path";
import type { KeyEnvelopeClient } from "../../packages/sync-client/src";

type RaceHarness = {
	config: (accountId: string, workspaceId: string) => void;
	holdGet: boolean;
	holdWrite: boolean;
	getWaiting: boolean;
	getReturned: boolean;
	writeWaiting: boolean;
	writeReturned: boolean;
	onRecoveredCalls: number;
	releaseGet: () => void;
	releaseWrite: () => void;
	writes: string[];
};

declare global {
	interface Window { keyRaceHarness: RaceHarness }
}

test("a recovered key cannot write after the account or workspace changes during retrieval or local acceptance", async ({ page }) => {
	await page.goto("/settings");
	await page.evaluate(async cryptoPath => {
		const load = <T,>(path: string): Promise<T> => import(/* @vite-ignore */ path);
		const reactModule = await load<Partial<typeof import("react")> & { default?: typeof import("react") }>("/@id/react");
		const React = reactModule.default ?? reactModule;
		if (typeof React.createElement !== "function") throw Error("react-create-element-unavailable");
		const createElement = React.createElement;
		const domModule = await load<Partial<typeof import("react-dom/client")> & { default?: typeof import("react-dom/client") }>("/@id/react-dom/client");
		const createRoot = domModule.createRoot ?? domModule.default?.createRoot;
		if (!createRoot) throw Error("react-create-root-unavailable");
		const { WorkspaceKeyPanel } = await load<typeof import("../../apps/web/src/components/WorkspaceKeyPanel")>("/src/components/WorkspaceKeyPanel.tsx");
		const { createRecoveryCredential, wrapForRecovery } = await load<typeof import("../../packages/crypto/src")>(cryptoPath);
		const accountId = "account-a";
		const workspaceId = crypto.randomUUID();
		const credential = await createRecoveryCredential();
		const key = new Uint8Array(32).fill(23);
		const wrap = await wrapForRecovery(key, credential, workspaceId, 1);
		const keyFingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", key)),
			value => value.toString(16).padStart(2, "0")).join("");
		const envelope = { envelopeId: crypto.randomUUID(), kind: "recovery", keyEpoch: 1, keyFingerprint,
			createdAt: new Date().toISOString(), expiresAt: null, wrap };
		const mount = document.createElement("div");
		mount.id = "key-race-mount";
		document.body.append(mount);
		const root = createRoot(mount);
		let resolveGet: (() => void) | undefined;
		let resolveWrite: (() => void) | undefined;
		const harness: RaceHarness = {
			holdGet: false, holdWrite: false, getWaiting: false, getReturned: false,
			writeWaiting: false, writeReturned: false, onRecoveredCalls: 0, writes: [],
			config(nextAccountId, nextWorkspaceId) {
				root.render(createElement(WorkspaceKeyPanel, {
					endpoint: "https://sync.example.test", accountId: nextAccountId, accessMode: "session", accessToken: "",
					hasAccess: true, workspaceId: nextWorkspaceId, workspaceKey: "", canIssue: false, otherBusy: false,
					onBusyChange: () => {},
					openClient: async () => ({
						verifyTarget: async () => ({ accountId, workspaceId }),
						list: async () => [envelope],
						get: async () => {
							if (harness.holdGet) {
								harness.getWaiting = true;
								await new Promise<void>(resolve => { resolveGet = resolve; });
							}
							harness.getReturned = true;
							return envelope;
						},
					}) as unknown as KeyEnvelopeClient,
					onRecovered: async (recoveredKey: string, _accountId: string, isCurrent: () => boolean) => {
					harness.onRecoveredCalls++;
					if (!isCurrent()) return;
					if (harness.holdWrite) {
						harness.writeWaiting = true;
						await new Promise<void>(resolve => { resolveWrite = resolve; });
					}
					harness.writeReturned = true;
					if (isCurrent()) harness.writes.push(recoveredKey);
				},
				}));
			},
			releaseGet: () => resolveGet?.(),
			releaseWrite: () => resolveWrite?.(),
		};
		window.keyRaceHarness = harness;
		harness.config(accountId, workspaceId);
		(mount as HTMLElement).dataset.credential = credential;
		(mount as HTMLElement).dataset.workspaceId = workspaceId;
	}, `/@fs${path.resolve("packages/crypto/src/index.ts")}`);
	const mount = page.locator("#key-race-mount");
	const credential = await mount.getAttribute("data-credential") ?? "";
	const unlock = async () => {
		await mount.getByLabel("Recovery or join credential").fill(credential);
		await mount.getByRole("button", { name: "Check credential and key" }).click();
		await expect(mount.getByLabel("I checked the account, workspace and key fingerprint")).toBeVisible();
		await mount.getByLabel("I checked the account, workspace and key fingerprint").check();
	};
	await unlock();
	await page.evaluate(() => { window.keyRaceHarness.holdGet = true; });
	await mount.getByRole("button", { name: "Use this key, then sync manually" }).click();
	await expect.poll(() => page.evaluate(() => window.keyRaceHarness.getWaiting)).toBe(true);
	await page.evaluate(() => window.keyRaceHarness.config("account-b", crypto.randomUUID()));
	await expect(mount).toContainText("account-b");
	await page.evaluate(() => window.keyRaceHarness.releaseGet());
	await expect.poll(() => page.evaluate(() => window.keyRaceHarness.getReturned)).toBe(true);
	await expect(mount.getByLabel("Recovery or join credential")).toHaveValue("");
	await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
	await expect.poll(() => page.evaluate(() => window.keyRaceHarness.onRecoveredCalls)).toBe(0);

	await page.evaluate(() => {
		window.keyRaceHarness.holdGet = false;
		window.keyRaceHarness.getWaiting = false;
		window.keyRaceHarness.config("account-a", document.querySelector<HTMLElement>("#key-race-mount")?.dataset.workspaceId ?? "");
	});
	await expect(mount).toContainText("account-a");
	await unlock();
	await page.evaluate(() => { window.keyRaceHarness.holdWrite = true; });
	await mount.getByRole("button", { name: "Use this key, then sync manually" }).click();
	await expect.poll(() => page.evaluate(() => window.keyRaceHarness.writeWaiting)).toBe(true);
	await page.evaluate(() => window.keyRaceHarness.config("account-b", crypto.randomUUID()));
	await expect(mount).toContainText("account-b");
	await page.evaluate(() => window.keyRaceHarness.releaseWrite());
	await expect.poll(() => page.evaluate(() => window.keyRaceHarness.writeReturned)).toBe(true);
	await expect(mount.getByLabel("Recovery or join credential")).toHaveValue("");
	await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
	await expect.poll(() => page.evaluate(() => window.keyRaceHarness.writes.length)).toBe(0);

	await page.evaluate(() => {
		window.keyRaceHarness.holdWrite = false;
		window.keyRaceHarness.config("account-a", document.querySelector<HTMLElement>("#key-race-mount")?.dataset.workspaceId ?? "");
	});
	await expect(mount).toContainText("account-a");
	await unlock();
	await mount.getByRole("button", { name: "Use this key, then sync manually" }).click();
	await expect.poll(() => page.evaluate(() => window.keyRaceHarness.writes.length)).toBe(1);
	await expect(mount.getByLabel("Recovery or join credential")).toHaveValue("");
});
