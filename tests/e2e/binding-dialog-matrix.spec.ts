import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const issuer = process.env.VITE_KEEPANY_BINDING_ISSUER;
const bridge = process.env.VITE_KEEPANY_BINDING_BRIDGE_ORIGIN;
const configured = Boolean(issuer && bridge);
const repositoryModuleUrl = `/@fs${process.cwd()}/packages/binding/src/store.ts`;
const preview = process.env.KEEPANY_PREVIEW === "1";

async function localBindingState(page: Page, bindingId: string) {
	return page.evaluate(async (id) => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open("keepany-binding-v1");
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			const read = (store: "bindings" | "credentials") =>
				new Promise<unknown>((resolve, reject) => {
					const request = db.transaction(store).objectStore(store).get(id);
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				});
			const binding = (await read("bindings")) as
				| { status: string }
				| undefined;
			return {
				status: binding?.status,
				credential: Boolean(await read("credentials")),
			};
		} finally {
			db.close();
		}
	}, bindingId);
}

const copies = {
	en: {
		add: "Add",
		name: "Name",
		save: "Save",
		start: "Start connecting",
		connected: "Connection saved on this device",
		remove: "Remove from this device",
		cancel: "Cancel",
		close: "Close",
		warning:
			"This removes the local connection only. Revoke device access in your account settings.",
		removed: "Connection removed from this device",
	},
	"zh-CN": {
		add: "新增",
		name: "名称",
		save: "保存",
		start: "开始连接",
		connected: "本机已保存账号连接",
		remove: "从本机移除",
		cancel: "取消",
		close: "关闭",
		warning: "仅移除本机连接。要撤销设备授权，请到账号页面操作。",
		removed: "已从本机移除连接",
	},
} as const;

for (const language of ["en", "zh-CN"] as const) {
	for (const width of [360, 390, 768, 1280, 1440]) {
		test(`${language} local binding removal dialog at ${width}px`, async ({
			browser,
		}) => {
			test.skip(!configured, "Configure isolated issuer and bridge origins");
			const copy = copies[language];
			const context = await browser.newContext({
				locale: language === "en" ? "en-US" : "zh-CN",
				viewport: { width, height: 844 },
			});
			await context.addInitScript(
				(value) => localStorage.setItem("keepany-language", value),
				language,
			);
			const page = await context.newPage();
			const pageErrors: string[] = [];
			const remoteRequests: string[] = [];
			page.on("pageerror", (error) => pageErrors.push(error.message));
			page.on("request", (request) => {
				if (
					request.url().startsWith(`${issuer}/`) ||
					request.url().startsWith(`${bridge}/`)
				) {
					remoteRequests.push(request.url());
				}
			});
			const accountName = `Local account ${language} ${width} ${"A".repeat(96)}`;
			const subject = `keepanyadm:${"S".repeat(192)}`;
			const bindingId = crypto.randomUUID();
			try {
				await page.goto("/assets/account");
				await page.getByRole("button", { name: copy.add, exact: true }).click();
				const create = page.getByRole("dialog");
				await create.getByLabel(copy.name, { exact: true }).fill(accountName);
				await create.getByRole("button", { name: copy.save }).click();
				await expect(create).toBeHidden();
				await expect(
					page.getByText(accountName, { exact: true }).first(),
				).toBeVisible();

				await page.goto("/settings");
				await expect(
					page.getByRole("button", { name: copy.start }),
				).toBeVisible();
				await page.evaluate(
					async ({ id, longSubject }) => {
						const db = await new Promise<IDBDatabase>((resolve, reject) => {
							const request = indexedDB.open("keepany-binding-v1");
							request.onsuccess = () => resolve(request.result);
							request.onerror = () => reject(request.error);
						});
						try {
							let identity:
								| { localAccountId: string; instanceId: string }
								| undefined;
							for (let attempt = 0; attempt < 100 && !identity; attempt++) {
								identity = await new Promise((resolve, reject) => {
									const request = db
										.transaction("identities")
										.objectStore("identities")
										.get("default");
									request.onsuccess = () => resolve(request.result);
									request.onerror = () => reject(request.error);
								});
								if (!identity)
									await new Promise((resolve) => setTimeout(resolve, 20));
							}
							if (!identity) throw Error("local identity unavailable");
							const bytes = new Uint8Array(
								await crypto.subtle.digest(
									"SHA-256",
									new TextEncoder().encode(identity.instanceId),
								),
							);
							const instanceIdHash = Array.from(bytes, (byte) =>
								byte.toString(16).padStart(2, "0"),
							).join("");
							const now = new Date().toISOString();
							await new Promise<void>((resolve, reject) => {
								const transaction = db.transaction(
									["bindings", "credentials"],
									"readwrite",
								);
								transaction.oncomplete = () => resolve();
								transaction.onerror = () => reject(transaction.error);
								transaction.objectStore("bindings").put({
									bindingId: id,
									localAccountId: identity.localAccountId,
									instanceIdHash,
									subject: longSubject,
									allowedScopes: ["sync:read"],
									status: "active",
									createdAt: now,
									updatedAt: now,
								});
								transaction.objectStore("credentials").put({
									bindingId: id,
									refreshToken: "R".repeat(43),
									expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
									updatedAt: now,
								});
							});
						} finally {
							db.close();
						}
					},
					{ id: bindingId, longSubject: subject },
				);
				await page.reload();
				await expect(page.getByText(copy.connected)).toBeVisible();
				await expect(page.getByText(subject)).toHaveCount(0);

				const opener = page.getByRole("button", { name: copy.remove });
				const dialog = page.getByRole("dialog", { name: copy.remove });
				await opener.click();
				await expect(dialog.getByText(copy.warning)).toBeVisible();
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
				).toBeLessThanOrEqual(width);
				expect(
					await dialog.evaluate(
						(element) => element.scrollWidth - element.clientWidth,
					),
				).toBeLessThanOrEqual(1);
				await expect(
					dialog.getByRole("button", { name: copy.remove }),
				).toBeInViewport({ ratio: 1 });
				const evidenceDir = process.env.KEEPANY_DIALOG_EVIDENCE_DIR;
				if (evidenceDir) {
					mkdirSync(evidenceDir, { recursive: true });
					await dialog.screenshot({
						path: join(
							evidenceDir,
							`binding-remove-${language === "en" ? "en" : "zh"}-${width}.png`,
						),
					});
				}
				await dialog.getByRole("button", { name: copy.cancel }).click();
				await expect(dialog).toBeHidden();
				await expect(opener).toBeFocused();
				await expect(page.getByText(copy.connected)).toBeVisible();

				await opener.click();
				await page.keyboard.press("Escape");
				await expect(dialog).toBeHidden();
				await expect(opener).toBeFocused();
				await opener.click();
				await dialog.getByRole("button", { name: copy.close }).click();
				await expect(dialog).toBeHidden();
				await expect(opener).toBeFocused();
				if (language === "en" && width === 390) {
					await opener.click();
					await page.evaluate(() => {
						const originalDelete = IDBObjectStore.prototype.delete;
						(
							window as Window & { __bindingDeleteFailures?: number }
						).__bindingDeleteFailures = 0;
						IDBObjectStore.prototype.delete = function (key) {
							if (
								this.name === "credentials" &&
								!(window as Window & { __bindingDeleteFailures?: number })
									.__bindingDeleteFailures
							) {
								(
									window as Window & { __bindingDeleteFailures?: number }
								).__bindingDeleteFailures = 1;
								throw new DOMException(
									"synthetic one-shot local delete failure",
									"AbortError",
								);
							}
							return originalDelete.call(this, key);
						};
					});
					await dialog.getByRole("button", { name: copy.remove }).click();
					await expect(dialog).toBeVisible();
					await expect(dialog.getByRole("alert")).toHaveText(
						"Connection could not be completed. Try again.",
					);
					expect(
						await page.evaluate(
							() =>
								(window as Window & { __bindingDeleteFailures?: number })
									.__bindingDeleteFailures,
						),
					).toBe(1);
					expect(await localBindingState(page, bindingId)).toEqual({
						status: "active",
						credential: true,
					});
					await dialog.getByRole("button", { name: copy.cancel }).click();
					await expect(dialog).toBeHidden();
					await expect(opener).toBeFocused();
				}

				if (!preview)
					await page.evaluate((modulePath) => {
						return import(modulePath).then(({ defaultBindingRepository }) => {
							const repository = defaultBindingRepository();
							const original = repository.revokeLocal.bind(repository);
							(
								window as Window & { __bindingRemoveCalls?: number }
							).__bindingRemoveCalls = 0;
							repository.revokeLocal = async (id: string) => {
								const tracked = window as Window & {
									__bindingRemoveCalls?: number;
								};
								tracked.__bindingRemoveCalls =
									(tracked.__bindingRemoveCalls ?? 0) + 1;
								return original(id);
							};
						});
					}, repositoryModuleUrl);
				await opener.click();
				await expect(dialog.getByRole("alert")).toHaveCount(0);
				await dialog
					.getByRole("button", { name: copy.remove })
					.evaluate((button) => {
						(button as HTMLButtonElement).click();
						(button as HTMLButtonElement).click();
					});
				await expect(dialog).toBeHidden();
				await expect(page.getByText(copy.removed)).toBeVisible();
				if (!preview)
					expect(
						await page.evaluate(
							() =>
								(window as Window & { __bindingRemoveCalls?: number })
									.__bindingRemoveCalls,
						),
					).toBe(1);
				await expect(
					page.getByRole("button", { name: copy.start }),
				).toBeVisible();
				await page.reload();
				await expect(
					page.getByRole("button", { name: copy.start }),
				).toBeVisible();
				await expect(page.getByText(copy.connected)).toHaveCount(0);
				expect(await localBindingState(page, bindingId)).toEqual({
					status: "revoked",
					credential: false,
				});
				await page.goto("/assets/account");
				await expect(
					page.getByText(accountName, { exact: true }).first(),
				).toBeVisible();
				expect(remoteRequests).toEqual([]);
				expect(pageErrors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}
}

test("older state response cannot revive a binding removed in another tab", async ({
	browser,
}) => {
	test.skip(!configured, "Configure isolated issuer and bridge origins");
	const context = await browser.newContext({
		locale: "en-US",
		viewport: { width: 390, height: 844 },
	});
	await context.addInitScript(() =>
		localStorage.setItem("keepany-language", "en"),
	);
	const first = await context.newPage();
	const second = await context.newPage();
	const bindingId = crypto.randomUUID();
	const subject = "keepanyadm:stale-response-fixture";
	const errors: string[] = [];
	first.on("pageerror", (error) => errors.push(error.message));
	second.on("pageerror", (error) => errors.push(error.message));
	let releaseResponse = () => {};
	const released = new Promise<void>((resolve) => {
		releaseResponse = resolve;
	});
	let markArrived = () => {};
	const arrived = new Promise<void>((resolve) => {
		markArrived = resolve;
	});
	try {
		await first.goto("/settings");
		await second.goto("/settings");
		await expect(
			first.getByRole("button", { name: "Start connecting" }),
		).toBeVisible();
		await expect(
			second.getByRole("button", { name: "Start connecting" }),
		).toBeVisible();
		await first.evaluate(
			async ({ id, fixtureSubject }) => {
				const db = await new Promise<IDBDatabase>((resolve, reject) => {
					const request = indexedDB.open("keepany-binding-v1");
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				});
				let identity:
					| { localAccountId: string; instanceId: string }
					| undefined;
				for (let attempt = 0; attempt < 100 && !identity; attempt++) {
					identity = await new Promise((resolve, reject) => {
						const request = db
							.transaction("identities")
							.objectStore("identities")
							.get("default");
						request.onsuccess = () => resolve(request.result);
						request.onerror = () => reject(request.error);
					});
					if (!identity)
						await new Promise((resolve) => setTimeout(resolve, 20));
				}
				if (!identity) throw Error("local identity unavailable");
				const bytes = new Uint8Array(
					await crypto.subtle.digest(
						"SHA-256",
						new TextEncoder().encode(identity.instanceId),
					),
				);
				const instanceIdHash = Array.from(bytes, (byte) =>
					byte.toString(16).padStart(2, "0"),
				).join("");
				try {
					const now = new Date().toISOString();
					await new Promise<void>((resolve, reject) => {
						const transaction = db.transaction(
							["bindings", "credentials"],
							"readwrite",
						);
						transaction.oncomplete = () => resolve();
						transaction.onerror = () => reject(transaction.error);
						transaction.objectStore("bindings").put({
							bindingId: id,
							localAccountId: identity.localAccountId,
							instanceIdHash,
							subject: fixtureSubject,
							allowedScopes: ["sync:read"],
							status: "active",
							createdAt: now,
							updatedAt: now,
						});
						transaction.objectStore("credentials").put({
							bindingId: id,
							refreshToken: "R".repeat(43),
							expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
							updatedAt: now,
						});
					});
				} finally {
					db.close();
				}
			},
			{
				id: bindingId,
				fixtureSubject: subject,
			},
		);
		await first.reload();
		await second.reload();
		await expect(
			first.getByText("Connection saved on this device"),
		).toBeVisible();
		await expect(
			second.getByText("Connection saved on this device"),
		).toBeVisible();
		let stateProof = "";
		await context.route(
			`${bridge}/api/keepany/v1/bindings/state`,
			async (route) => {
				const headers = {
					"Access-Control-Allow-Origin": `http://127.0.0.1:${process.env.KEEPANY_E2E_PORT ?? "4173"}`,
					"Access-Control-Allow-Methods": "POST",
					"Access-Control-Allow-Headers": "content-type, dpop",
					"Content-Type": "application/json",
				};
				if (route.request().method() === "OPTIONS") {
					await route.fulfill({ status: 204, headers });
					return;
				}
				stateProof = route.request().headers().dpop;
				markArrived();
				await released;
				await route.fulfill({
					status: 200,
					headers,
					body: JSON.stringify({
						code: 0,
						data: {
							bindingId,
							subject,
							state: "active",
							scopes: ["sync:read"],
							credentialExpiresAt: new Date(
								Date.now() + 86_400_000,
							).toISOString(),
							entitlements: {},
						},
					}),
				});
			},
		);
		await first.getByRole("button", { name: "Check status" }).click();
		await arrived;
		await second
			.getByRole("button", { name: "Remove from this device" })
			.click();
		await second
			.getByRole("dialog")
			.getByRole("button", { name: "Remove from this device" })
			.click();
		await expect(
			second.getByText("Connection removed from this device"),
		).toBeVisible();
		releaseResponse();
		await expect(
			first.getByText("Connection saved on this device"),
		).toHaveCount(0);
		await expect(
			first.getByRole("button", { name: "Start connecting" }),
		).toBeVisible();
		await first.reload();
		await expect(
			first.getByText("Connection saved on this device"),
		).toHaveCount(0);
		expect(await localBindingState(first, bindingId)).toEqual({
			status: "revoked",
			credential: false,
		});
		expect(stateProof).toBeTruthy();
		expect(errors).toEqual([]);
	} finally {
		releaseResponse();
		await context.close();
	}
});
