import { expect, it, vi } from "vitest";
import { importPickedVaultFile } from "./PasswordVaultPanel";

it.each(["empty", "unlocked"])("does not start an import after background interrupts a file read from %s", async initialStatus => {
	let finishRead!: (value: ArrayBuffer) => void;
	const file = { arrayBuffer: () => new Promise<ArrayBuffer>(resolve => { finishRead = resolve; }) };
	const session = { importKdbx: vi.fn(async () => {}) };
	let backgroundRevision = 0;
	let status = initialStatus;
	const startedBeforeBackground = backgroundRevision;
	const importing = importPickedVaultFile(file, "synthetic-only", session, () =>
		startedBeforeBackground === backgroundRevision && ["empty", "unlocked"].includes(status));
	backgroundRevision += 1;
	status = initialStatus === "empty" ? "empty" : "locked";
	finishRead(new Uint8Array([1, 2, 3]).buffer);
	await expect(importing).rejects.toThrow("vault-locked");
	expect(session.importKdbx).not.toHaveBeenCalled();
});

it("does not reuse a pending file read even after the vault is unlocked again", async () => {
	let finishRead!: (value: ArrayBuffer) => void;
	const file = { arrayBuffer: () => new Promise<ArrayBuffer>(resolve => { finishRead = resolve; }) };
	const session = { importKdbx: vi.fn(async () => {}) };
	let backgroundRevision = 0;
	const startedBeforeBackground = backgroundRevision;
	const importing = importPickedVaultFile(file, "synthetic-only", session, () => startedBeforeBackground === backgroundRevision);
	backgroundRevision += 1;
	finishRead(new Uint8Array([1, 2, 3]).buffer);
	await expect(importing).rejects.toThrow("vault-locked");
	expect(session.importKdbx).not.toHaveBeenCalled();
});

it("imports a current selected file once and preserves its original bytes", async () => {
	const bytes = new Uint8Array([4, 5, 6]);
	const session = { importKdbx: vi.fn(async () => {}) };
	await importPickedVaultFile({ arrayBuffer: async () => bytes.buffer }, "synthetic-only", session, () => true);
	expect(session.importKdbx).toHaveBeenCalledExactlyOnceWith(bytes, "synthetic-only");
});
