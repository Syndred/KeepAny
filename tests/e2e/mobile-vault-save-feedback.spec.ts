import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { passwordVaultCopy } from "../../apps/web/src/password-vault-copy";
import { sourceModuleUrl } from "./helpers/source-module-url";
import type { LocalRepository, VaultRecord } from "../../packages/local-db/src";
import type { VaultSession } from "../../packages/password-vault/src";
type Fixture = {
	repository: LocalRepository;
	session: VaultSession | null;
	mode: "pass" | "reject-once" | "stale-once" | "hold-reject";
	rejects: number;
	writes: number;
	inFlight: number;
	pendingReject: (() => void) | null;
	originalWrite: LocalRepository["savePasswordVault"];
	baselineRecord: VaultRecord | null;
	ordinary: string;
	entryId: string | null;
	baselineDraft: string | null;
};
declare global {
	interface Window {
		vaultFeedbackFixture: Fixture;
	}
}
const credentialSource = readFileSync(
	"tests/e2e/mobile-backup-migration-acceptance.spec.ts",
	"utf8",
);
const masterMatches = [
	...credentialSource.matchAll(/\bf20Master\s*=\s*(['"])([^'"\r\n]+)\1/g),
];
if (masterMatches.length !== 1)
	throw Error("synthetic-master-source-not-unique");
const master = masterMatches[0][2];
const repoModule = sourceModuleUrl("packages/local-db/src/index.ts"),
	engineModule = sourceModuleUrl("packages/password-vault/src/index.ts"),
	domainModule = sourceModuleUrl("packages/domain/src/index.ts");
const evidence = resolve(
	process.env.VAULT_FEEDBACK_EVIDENCE ??
		"test-results/mobile-vault-save-feedback/evidence",
);
mkdirSync(evidence, { recursive: true });
const sourceHash = createHash("sha256")
	.update(readFileSync("apps/web/src/components/PasswordVaultPanel.tsx"))
	.digest("hex");
const copy = (locale: string, key: string) =>
	passwordVaultCopy[key]?.[locale === "zh-CN" ? 0 : 1] ?? key;
// Use the ordinary DOM input event path without putting synthetic sensitive
// values in Playwright's "fill <value>" API step titles/trace artifacts.
async function enter(page: Page, id: string, value: string) {
	await page.locator(id).evaluate((node, text) => {
		const control = node as HTMLInputElement | HTMLTextAreaElement;
		const prototype =
			control instanceof HTMLTextAreaElement
				? HTMLTextAreaElement.prototype
				: HTMLInputElement.prototype;
		Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
			control,
			text,
		);
		control.dispatchEvent(new Event("input", { bubbles: true }));
		control.dispatchEvent(new Event("change", { bubbles: true }));
	}, value);
}
async function unlock(page: Page, locale: string) {
	await enter(page, "#password-vault-unlock-master", master);
	await page
		.getByRole("button", { name: copy(locale, "pwVaultUnlock"), exact: true })
		.click();
	await expect(page.locator(".password-vault-toolbar")).toBeVisible();
}
async function fingerprint(page: Page) {
	return page.evaluate(async () => {
		const f = window.vaultFeedbackFixture,
			record = await f.repository.readPasswordVault(),
			ordinaryRows = await f.repository.allRecords();
		const hash = async (value: Uint8Array | string) =>
			Array.from(
				new Uint8Array(
					await crypto.subtle.digest(
						"SHA-256",
						typeof value === "string"
							? new TextEncoder().encode(value)
							: (value as BufferSource),
					),
				),
				(b) => b.toString(16).padStart(2, "0"),
			).join("");
		return {
			cipherSha: record ? await hash(record.bytes) : null,
			revision: record?.revision ?? null,
			ordinarySha: await hash(JSON.stringify(ordinaryRows)),
			ordinaryCount: ordinaryRows.length,
			writes: f.writes,
			entryId: f.entryId,
			sessionLocked: f.session?.getSnapshot().status !== "unlocked",
		};
	});
}
async function openEntry(page: Page, locale: string) {
	await page
		.locator(".password-vault-entry-list .password-vault-entry")
		.getByRole("button", {
			name: copy(locale, "pwVaultEditEntry"),
			exact: true,
		})
		.click();
	await expect(page.locator("#password-vault-entry-title")).toBeVisible();
}

for (const locale of ["zh-CN", "en"] as const)
	test(`${locale} 390 entry save rejection is visible in its dialog, preserves ciphertext and retries the same draft`, async ({
		browser,
	}) => {
		const context = await browser.newContext({
			locale: locale === "en" ? "en-US" : locale,
			viewport: { width: 390, height: 844 },
			hasTouch: true,
		});
		const page = await context.newPage();
		const initialTitle = `Synthetic feedback entry ${randomUUID().slice(0, 8)}`,
			nextTitle = `Synthetic feedback retry ${randomUUID().slice(0, 8)}`,
			secret = `Synthetic-${randomUUID()}`,
			username = `fixture-${randomUUID().slice(0, 8)}@example.test`,
			notes = `Synthetic private ${randomUUID()}`;
		const facts: Record<string, unknown> = {
			classification: "B_CONTROLLED_OWN_PERSISTENCE_REJECTION_NOT_NATIVE_IO",
			locale,
			sourceHash,
			trace: false,
			video: false,
			passwordRevealed: false,
		};
		try {
			await page.addInitScript(
				(lng) => localStorage.setItem("keepany-language", lng),
				locale,
			);
			await page.goto("/assets/vault");
			await page.evaluate(
				async ({ repoModule, engineModule, domainModule }) => {
					const repository = await (
						await import(/* @vite-ignore */ repoModule)
					).localRepository();
					const engine = await import(/* @vite-ignore */ engineModule);
					// Declared synthetic ordinary-data fixture, saved through the real
					// repository. Its complete row is included in every fingerprint.
					const { newAsset } = await import(/* @vite-ignore */ domainModule);
					await repository.save("asset", {
						...newAsset("project"),
						name: "Synthetic vault feedback keeper",
					});
					const state: Fixture = {
						repository,
						session: null,
						mode: "pass",
						rejects: 0,
						writes: 0,
						inFlight: 0,
						pendingReject: null,
						originalWrite: repository.savePasswordVault.bind(repository),
						baselineRecord: null,
						ordinary: "",
						entryId: null,
						baselineDraft: null,
					};
					window.vaultFeedbackFixture = state;
					const original = engine.VaultSession.prototype.saveEntry;
					engine.VaultSession.prototype.saveEntry = function (
						value: Parameters<VaultSession["saveEntry"]>[0],
					) {
						state.session = this;
						engine.VaultSession.prototype.saveEntry = original;
						return Reflect.apply(original, this, [value]);
					};
					repository.savePasswordVault = async (
						bytes: Uint8Array,
						expectedRevision: string | null,
					) => {
						state.writes++;
						state.inFlight++;
						try {
							if (state.mode === "reject-once") {
								state.mode = "pass";
								state.rejects++;
								throw Error("synthetic-own-persistence-refusal");
							}
							if (state.mode === "stale-once") {
								state.mode = "pass";
								state.rejects++;
								throw Error("vault-stale");
							}
							if (state.mode === "hold-reject") {
								state.mode = "pass";
								await new Promise<never>((_resolve, reject) => {
									state.pendingReject = () => {
										state.pendingReject = null;
										state.rejects++;
										reject(Error("synthetic-held-persistence-refusal"));
									};
								});
							}
							return await state.originalWrite(bytes, expectedRevision);
						} finally {
							state.inFlight--;
						}
					};
				},
				{ repoModule, engineModule, domainModule },
			);
			await enter(page, "#password-vault-master", master);
			await enter(page, "#password-vault-master-confirm", master);
			await page
				.getByRole("button", {
					name: copy(locale, "pwVaultCreate"),
					exact: true,
				})
				.click();
			await expect(page.locator(".password-vault-toolbar")).toBeVisible();
			await page
				.getByRole("button", {
					name: copy(locale, "pwVaultNewEntry"),
					exact: true,
				})
				.click();
			await enter(page, "#password-vault-entry-title", initialTitle);
			await enter(page, "#password-vault-entry-username", username);
			await enter(page, "#password-vault-entry-password", secret);
			await enter(page, "#password-vault-entry-notes", notes);
			await page
				.getByRole("dialog")
				.getByRole("button", {
					name: copy(locale, "pwVaultSaveEntry"),
					exact: true,
				})
				.click();
			await expect(page.getByRole("dialog")).toHaveCount(0);
			await page
				.getByRole("button", { name: copy(locale, "pwVaultLock"), exact: true })
				.click();
			await unlock(page, locale);
			await page.evaluate(async () => {
				const f = window.vaultFeedbackFixture;
				f.baselineRecord = await f.repository.readPasswordVault();
				f.ordinary = JSON.stringify(await f.repository.allRecords());
				f.entryId = f.session?.getSnapshot().entries[0]?.id ?? null;
				if (!f.entryId || !f.session) throw Error("synthetic-session-capture");
				f.baselineDraft = JSON.stringify(f.session.readEntry(f.entryId));
			});
			const before = await fingerprint(page);
			expect(before.ordinaryCount).toBe(1);
			facts.before = before;
			await openEntry(page, locale);
			await enter(page, "#password-vault-entry-title", nextTitle);
			await page.evaluate(() => {
				window.vaultFeedbackFixture.mode = "reject-once";
			});
			const dialog = page.getByRole("dialog"),
				save = dialog.getByRole("button", {
					name: copy(locale, "pwVaultSaveEntry"),
					exact: true,
				});
			await save.click();
			await expect
				.poll(() => page.evaluate(() => window.vaultFeedbackFixture.rejects))
				.toBe(1);
			await expect(save).toBeEnabled();
			await expect(page.locator(".toast")).toBeHidden({ timeout: 10000 });
			const after = await fingerprint(page);
			facts.failedWrite = {
				sameCipher: after.cipherSha === before.cipherSha,
				sameRevision: after.revision === before.revision,
				sameOrdinaryRows: after.ordinarySha === before.ordinarySha,
				sameEntryId: after.entryId === before.entryId,
			};
			const retained = await page.evaluate((expected) => {
				const f = window.vaultFeedbackFixture;
				return {
					sameDraftTitle:
						(
							document.querySelector(
								"#password-vault-entry-title",
							) as HTMLInputElement
						)?.value === expected,
					passwordMasked:
						(
							document.querySelector(
								"#password-vault-entry-password",
							) as HTMLInputElement
						)?.type === "password",
					sessionOriginalUnchanged:
						!!f.session &&
						!!f.entryId &&
						JSON.stringify(f.session.readEntry(f.entryId)) === f.baselineDraft,
					historyUnchanged:
						!!f.session &&
						!!f.entryId &&
						f.session.history(f.entryId).length === 0,
				};
			}, nextTitle);
			facts.retained = retained;
			for (const value of Object.values(
				facts.failedWrite as Record<string, boolean>,
			))
				expect(value).toBe(true);
			for (const value of Object.values(retained)) expect(value).toBe(true);
			const errorText = copy(locale, "pwVaultSaveFailed");
			const geometry = await page.evaluate((text) => {
				const d = document.querySelector("[role=dialog]");
				const local = [...(d?.querySelectorAll("[role=alert]") ?? [])].find(
					(n) => n.textContent?.includes(text),
				);
				const global = [
					...document.querySelectorAll(".password-vault-message"),
				].find((n) => n.textContent?.includes(text));
				const rect = (n: Element | undefined) => {
					if (!n) return null;
					const r = n.getBoundingClientRect();
					return {
						x: r.x,
						y: r.y,
						width: r.width,
						height: r.height,
						viewportRatio:
							Math.max(
								0,
								Math.min(innerHeight, r.bottom) - Math.max(0, r.top),
							) / Math.max(1, r.height),
					};
				};
				return {
					dialogAlert: rect(local),
					globalMessage: rect(global),
					viewportHeight: innerHeight,
					errorInCurrentDialog: !!local,
				};
			}, errorText);
			facts.errorGeometry = geometry;
			writeFileSync(
				join(evidence, `${locale}-save-refusal.json`),
				JSON.stringify(facts, null, 2),
			);
			await dialog.locator(".password-vault-editor-actions").screenshot({
				path: join(evidence, `${locale}-save-refusal-footer.png`),
			});
			const alert = dialog.getByRole("alert").filter({ hasText: errorText });
			await expect(alert).toBeVisible();
			expect(geometry.errorInCurrentDialog).toBe(true);
			expect(geometry.dialogAlert?.viewportRatio === 1).toBe(true);
			await save.click();
			await expect(dialog).toHaveCount(0);
			const committed = await fingerprint(page);
			expect(committed.cipherSha !== before.cipherSha).toBe(true);
			expect(committed.revision !== before.revision).toBe(true);
			expect(committed.ordinarySha === before.ordinarySha).toBe(true);
			expect(committed.entryId === before.entryId).toBe(true);
			expect(committed.writes === after.writes + 1).toBe(true);
			const precise = await page.evaluate(
				async ({ engineModule, master, nextTitle }) => {
					const f = window.vaultFeedbackFixture,
						record = await f.repository.readPasswordVault();
					if (!record || !f.entryId || !f.baselineDraft) return false;
					const { VaultSession } = await import(
						/* @vite-ignore */ engineModule
					);
					const readOnly = new VaultSession({
						read: async () => record,
						write: async () => {
							throw Error("read-only-verification");
						},
					});
					try {
						await readOnly.initialize();
						await readOnly.unlock(master);
						const now = readOnly.readEntry(f.entryId),
							old = JSON.parse(f.baselineDraft);
						return (
							JSON.stringify(now) ===
								JSON.stringify({ ...old, title: nextTitle }) &&
							readOnly.getSnapshot().entries.length === 1 &&
							readOnly.history(f.entryId).length === 1 &&
							JSON.stringify(readOnly.history(f.entryId)[0].draft) ===
								f.baselineDraft
						);
					} finally {
						readOnly.lock();
					}
				},
				{ engineModule, master, nextTitle },
			);
			expect(precise).toBe(true);
			await page
				.getByRole("button", { name: copy(locale, "pwVaultLock"), exact: true })
				.click();
			await unlock(page, locale);
			await openEntry(page, locale);
			expect(
				(await page.locator("#password-vault-entry-title").inputValue()) ===
					nextTitle,
			).toBe(true);
			await page
				.getByRole("dialog")
				.getByRole("button", { name: /^(Close|关闭)$/ })
				.click();
			// The existing CAS error remains distinct and visible; cancel and
			// reopening a different draft cannot retain this editor's error.
			await openEntry(page, locale);
			await page.evaluate(() => {
				window.vaultFeedbackFixture.mode = "stale-once";
			});
			await page
				.getByRole("dialog")
				.getByRole("button", {
					name: copy(locale, "pwVaultSaveEntry"),
					exact: true,
				})
				.click();
			await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
				copy(locale, "pwVaultConflict"),
			);
			await expect(
				page.getByRole("dialog").getByRole("button", {
					name: copy(locale, "pwVaultSaveEntry"),
					exact: true,
				}),
			).toBeEnabled();
			const conflict = await fingerprint(page);
			expect(
				conflict.cipherSha === committed.cipherSha &&
					conflict.revision === committed.revision,
			).toBe(true);
			await page
				.getByRole("dialog")
				.getByRole("button", { name: /^(Close|关闭)$/ })
				.click();
			// Meaningful late-callback branch: a real provider lock while its own failed
			// persistence is held must not render an old editor error into locked/new UI.
			await openEntry(page, locale);
			await expect(page.getByRole("dialog").getByRole("alert")).toHaveCount(0);
			await enter(page, "#password-vault-entry-title", "Synthetic late draft");
			await page.evaluate(() => {
				window.vaultFeedbackFixture.mode = "hold-reject";
			});
			await page
				.getByRole("dialog")
				.getByRole("button", {
					name: copy(locale, "pwVaultSaveEntry"),
					exact: true,
				})
				.click();
			await expect
				.poll(() =>
					page.evaluate(() => !!window.vaultFeedbackFixture.pendingReject),
				)
				.toBe(true);
			await page.evaluate(() =>
				window.dispatchEvent(new Event("keepany-native-background")),
			);
			await expect(page.getByRole("dialog")).toHaveCount(0);
			await expect(page.locator("#password-vault-unlock-master")).toBeVisible();
			await page.evaluate(() => window.vaultFeedbackFixture.pendingReject?.());
			await expect
				.poll(() => page.evaluate(() => window.vaultFeedbackFixture.inFlight))
				.toBe(0);
			await expect(
				page.locator(".password-vault-message").filter({ hasText: errorText }),
			).toHaveCount(0);
			const late = await fingerprint(page);
			expect(late.cipherSha === committed.cipherSha).toBe(true);
			expect(late.ordinarySha === committed.ordinarySha).toBe(true);
			await unlock(page, locale);
			await page
				.getByRole("button", {
					name: copy(locale, "pwVaultNewEntry"),
					exact: true,
				})
				.click();
			await expect(page.getByRole("dialog").getByRole("alert")).toHaveCount(0);
			expect(
				(await page.locator("#password-vault-entry-title").inputValue()) === "",
			).toBe(true);
			await page
				.getByRole("dialog")
				.getByRole("button", { name: /^(Close|关闭)$/ })
				.click();
			facts.completed = {
				sameDraftRetry: true,
				preciseEncryptedReunlock: true,
				sameOriginalUuid: true,
				historyOne: true,
				lateFailureAfterLockNotDisplayed: true,
				newEditorClearsError: true,
				conflictCopyAndCancelPreserved: true,
				ordinaryRowsUnchanged: true,
			};
			writeFileSync(
				join(evidence, `${locale}-completed.json`),
				JSON.stringify(facts, null, 2),
			);
		} finally {
			await page
				.evaluate(() => {
					const f = window.vaultFeedbackFixture;
					if (f) {
						f.pendingReject?.();
						f.repository.savePasswordVault = f.originalWrite;
						f.session?.lock();
					}
				})
				.catch(() => {});
			await context.close();
		}
	});
