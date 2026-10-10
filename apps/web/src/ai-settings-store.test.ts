import { describe, expect, it } from "vitest";
import type {
	VaultEntryDraft,
	VaultSnapshot,
} from "../../../packages/password-vault/src";
import {
	AI_SETTINGS_STORAGE_KEY,
	AiSettingsStore,
	normalizeAiSettings,
} from "./ai-settings-store";

function storage() {
	const values = new Map<string, string>();
	return {
		values,
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
		removeItem: (key: string) => {
			values.delete(key);
		},
	};
}
const configuration = {
	provider: "deepseek" as const,
	baseURL: "https://api.deepseek.com",
	model: "deepseek-chat",
	keySource: "session" as const,
};
const binding = {
	version: 1 as const,
	provider: "deepseek",
	baseURL: configuration.baseURL,
};
function vault(aiKeyBinding?: VaultEntryDraft["aiKeyBinding"]) {
	let password = "vault-secret";
	let currentBinding = aiKeyBinding;
	let state: VaultSnapshot = {
		status: "unlocked",
		revision: "one",
		contentRevision: "one",
		trash: [],
		entries: [
			{
				id: "entry",
				title: "DeepSeek",
				username: "",
				url: "",
				linkedAssetIds: [],
				modifiedAt: "",
				historyCount: 0,
			},
		],
	};
	const listeners = new Set<() => void>();
	let reads = 0;
	return {
		getSnapshot: () => state,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		readEntry: (id: string): VaultEntryDraft => {
			reads += 1;
			return {
				id,
				title: "DeepSeek",
				username: "",
				password,
				url: "",
				notes: "",
				linkedAssetIds: [],
				...(currentBinding && id === "entry"
					? { aiKeyBinding: currentBinding }
					: {}),
			};
		},
		update: (changes: Partial<VaultSnapshot>) => {
			state = { ...state, ...changes };
			for (const listener of listeners) listener();
		},
		changePassword: (value: string) => {
			password = value;
		},
		clearBinding: () => {
			currentBinding = undefined;
		},
		get reads() {
			return reads;
		},
	};
}

describe("AI settings credential boundary", () => {
	it("supports a self-hosted compatible HTTPS service without a key", () => {
		const store = new AiSettingsStore(storage());
		store.saveConfiguration({
			provider: "compatible",
			baseURL: "https://selfhost.example/v1",
			model: "my-deployed-model",
			keySource: "none",
		});
		expect(store.acquire().connection.apiKey).toBe("");
		expect(store.getSnapshot().connection?.baseURL).toBe(
			"https://selfhost.example/v1",
		);
		expect(() =>
			normalizeAiSettings({ ...configuration, keySource: "none" }),
		).toThrow("aiSettingsKeyRequired");
	});
	it("persists only model metadata, and refresh does not recover a session key", () => {
		const saved = storage();
		const store = new AiSettingsStore(saved);
		store.saveConfiguration({ ...configuration, apiKey: "session-secret" });
		expect(store.getSnapshot().connection?.apiKey).toBe("session-secret");
		const raw = saved.getItem(AI_SETTINGS_STORAGE_KEY) as string;
		expect(raw).not.toContain("session-secret");
		expect(JSON.parse(raw)).toEqual(configuration);
		const reopened = new AiSettingsStore(saved);
		expect(reopened.getSnapshot().configured).toBe(true);
		expect(reopened.getSnapshot().connection).toBeNull();
	});
	it("does not carry a key to another provider or address", () => {
		const store = new AiSettingsStore(storage());
		store.saveConfiguration({ ...configuration, apiKey: "session-secret" });
		store.saveConfiguration({ ...configuration, model: "deepseek-reasoner" });
		expect(store.getSnapshot().connection?.apiKey).toBe("session-secret");
		store.saveConfiguration({
			...configuration,
			baseURL: "https://another.example/v1",
		});
		expect(store.getSnapshot().connection).toBeNull();
		store.saveConfiguration({ ...configuration, apiKey: "new-secret" });
		store.saveConfiguration({ ...configuration, provider: "openai" });
		expect(store.getSnapshot().connection).toBeNull();
	});
	it("uses only an explicitly chosen vault entry and invalidates requests when locked", () => {
		const saved = storage();
		const session = vault();
		const store = new AiSettingsStore(saved);
		store.attachVault(session);
		store.saveConfiguration({
			...configuration,
			keySource: "vault",
			vaultEntryId: "entry",
		});
		expect(session.reads).toBe(1);
		expect(saved.getItem(AI_SETTINGS_STORAGE_KEY)).not.toContain(
			"vault-secret",
		);
		const lease = store.acquire();
		expect(lease.connection.apiKey).toBe("vault-secret");
		session.update({ status: "locked", entries: [] });
		expect(lease.signal.aborted).toBe(true);
		expect(lease.isCurrent()).toBe(false);
		expect(store.getSnapshot().connection).toBeNull();
		expect(() => store.activateVaultKey()).toThrow("aiSettingsVaultLocked");
		lease.release();
	});
	it("requires explicit vault activation after refresh or a changed vault revision", () => {
		const saved = storage();
		const session = vault();
		const first = new AiSettingsStore(saved);
		first.attachVault(session);
		first.saveConfiguration({
			...configuration,
			keySource: "vault",
			vaultEntryId: "entry",
		});
		const reopened = new AiSettingsStore(saved);
		reopened.attachVault(session);
		expect(session.reads).toBe(1);
		expect(reopened.getSnapshot().connection).toBeNull();
		reopened.activateVaultKey();
		expect(session.reads).toBe(2);
		session.update({ revision: "two", contentRevision: "two" });
		expect(reopened.getSnapshot().connection).toBeNull();
		reopened.activateVaultKey();
		session.update({
			revision: "three",
			contentRevision: "three",
			entries: [],
		});
		expect(() => reopened.activateVaultKey()).toThrow(
			"aiSettingsVaultEntryRequired",
		);
	});
	it("keeps a manually activated key and pending request through draft-only revisions", () => {
		const saved = storage();
		const session = vault();
		const first = new AiSettingsStore(saved);
		first.attachVault(session);
		first.saveConfiguration({
			...configuration,
			keySource: "vault",
			vaultEntryId: "entry",
		});
		const reopened = new AiSettingsStore(saved);
		reopened.attachVault(session);
		reopened.activateVaultKey();
		const lease = reopened.acquire();
		const aiRevision = reopened.getSnapshot().revision;
		const reads = session.reads;
		session.update({ revision: "draft-checkpoint", contentRevision: "one" });
		expect(session.reads).toBe(reads);
		expect(reopened.getSnapshot().revision).toBe(aiRevision);
		expect(reopened.getSnapshot().connection?.apiKey).toBe("vault-secret");
		expect(lease.signal.aborted).toBe(false);
		expect(lease.isCurrent()).toBe(true);
		session.update({ revision: "entry-write", contentRevision: "entry-write" });
		expect(lease.signal.aborted).toBe(true);
		expect(lease.isCurrent()).toBe(false);
		expect(reopened.getSnapshot().connection).toBeNull();
		lease.release();
	});
	it("restores only the authorized encrypted service key after refresh and unlock", () => {
		const saved = storage();
		const session = vault(binding);
		const store = new AiSettingsStore(saved);
		store.attachVault(session);
		store.saveConfiguration({
			...configuration,
			keySource: "vault",
			vaultEntryId: "entry",
			autoActivate: true,
		});
		const reopened = new AiSettingsStore(saved);
		reopened.attachVault(session);
		expect(reopened.acquire().connection.apiKey).toBe("vault-secret");
		const entries = session.getSnapshot().entries;
		const active = reopened.acquire();
		session.update({ status: "locked", entries: [] });
		expect(active.signal.aborted).toBe(true);
		expect(reopened.getSnapshot().connection).toBeNull();
		session.update({ status: "unlocked", entries });
		expect(reopened.getSnapshot().connection?.apiKey).toBe("vault-secret");
		expect(saved.getItem(AI_SETTINGS_STORAGE_KEY)).not.toContain(
			"vault-secret",
		);
	});
	it("keeps requests through unrelated vault writes but cancels them when the selected key changes", () => {
		const session = vault(binding);
		const store = new AiSettingsStore(storage());
		store.attachVault(session);
		store.saveConfiguration({
			...configuration,
			keySource: "vault",
			vaultEntryId: "entry",
			autoActivate: true,
		});
		const active = store.acquire();
		const revision = store.getSnapshot().revision;
		session.update({
			revision: "unrelated-write",
			contentRevision: "unrelated-write",
		});
		expect(active.isCurrent()).toBe(true);
		expect(store.getSnapshot().revision).toBe(revision);
		session.changePassword("rotated-vault-secret");
		session.update({ revision: "key-update", contentRevision: "key-update" });
		expect(active.signal.aborted).toBe(true);
		expect(store.getSnapshot().connection?.apiKey).toBe("rotated-vault-secret");
		session.update({
			revision: "key-deleted",
			contentRevision: "key-deleted",
			entries: [],
		});
		expect(store.getSnapshot().connection).toBeNull();
	});
	it("cannot authorize an arbitrary password or another service through plain settings metadata", () => {
		const saved = storage();
		const session = vault(binding);
		session.update({
			entries: [
				...session.getSnapshot().entries,
				{ ...session.getSnapshot().entries[0], id: "unselected-password" },
			],
		});
		const store = new AiSettingsStore(saved);
		store.attachVault(session);
		const selected = {
			...configuration,
			keySource: "vault" as const,
			vaultEntryId: "entry",
			autoActivate: true,
		};
		store.saveConfiguration(selected);
		for (const changed of [
			{ baseURL: "https://attacker.example" },
			{ provider: "openai" },
			{ vaultEntryId: "unselected-password" },
		]) {
			saved.setItem(
				AI_SETTINGS_STORAGE_KEY,
				JSON.stringify({ ...selected, ...changed }),
			);
			store.reload();
			expect(store.getSnapshot().connection).toBeNull();
		}
		const unbound = new AiSettingsStore(saved);
		unbound.attachVault(vault());
		expect(() => unbound.saveConfiguration(selected)).toThrow(
			"aiSettingsVaultBindingRequired",
		);
	});
	it("revokes an unchanged key when encrypted authorization is removed", () => {
		const session = vault(binding);
		const store = new AiSettingsStore(storage());
		store.attachVault(session);
		store.saveConfiguration({
			...configuration,
			keySource: "vault",
			vaultEntryId: "entry",
			autoActivate: true,
		});
		const lease = store.acquire();
		session.clearBinding();
		session.update({
			revision: "authorization-removed",
			contentRevision: "authorization-removed",
		});
		expect(lease.signal.aborted).toBe(true);
		expect(store.getSnapshot().connection).toBeNull();
	});
	it("recovers the same authorized key on metadata reload and fails closed on a read error", () => {
		const saved = storage();
		const session = vault(binding);
		const store = new AiSettingsStore(saved);
		store.attachVault(session);
		store.saveConfiguration({
			...configuration,
			keySource: "vault",
			vaultEntryId: "entry",
			autoActivate: true,
		});
		store.reload();
		expect(store.getSnapshot().connection?.apiKey).toBe("vault-secret");
		session.readEntry = () => {
			throw new Error("private read diagnostics");
		};
		session.update({ revision: "read-error", contentRevision: "read-error" });
		expect(store.getSnapshot().connection).toBeNull();
	});
	it("cancels old requests on configuration changes and honors external abort", () => {
		const store = new AiSettingsStore(storage());
		store.saveConfiguration({ ...configuration, apiKey: "secret" });
		const first = store.acquire();
		store.saveConfiguration({ ...configuration, model: "deepseek-reasoner" });
		expect(first.signal.aborted).toBe(true);
		const controller = new AbortController();
		const second = store.acquire(controller.signal);
		controller.abort();
		expect(second.isCurrent()).toBe(false);
		first.release();
		second.release();
		store.clearConfiguration();
		expect(store.getSnapshot().configured).toBe(false);
	});
	it("does not replace a working connection when persistence fails", () => {
		const saved = storage();
		const store = new AiSettingsStore(saved);
		store.saveConfiguration({ ...configuration, apiKey: "secret" });
		saved.setItem = () => {
			throw new Error("private storage diagnostic");
		};
		expect(() =>
			store.saveConfiguration({ ...configuration, model: "other" }),
		).toThrow("aiSettingsStorageFailed");
		expect(store.getSnapshot().connection?.model).toBe("deepseek-chat");
	});
	it("rejects credentials in URLs and insecure remote endpoints", () => {
		for (const baseURL of [
			"http://remote.example/v1",
			"https://user:secret@api.example/v1",
			"https://api.example/v1?api_key=secret",
			"https://api.example/v1#secret",
		]) {
			expect(() => normalizeAiSettings({ ...configuration, baseURL })).toThrow(
				"aiSettingsInvalidUrl",
			);
		}
		expect(
			normalizeAiSettings({
				...configuration,
				provider: "ollama",
				baseURL: "http://127.0.0.1:11434/v1",
				keySource: "none",
				apiKey: "dropped-secret",
			}),
		).toEqual({
			provider: "ollama",
			baseURL: "http://127.0.0.1:11434/v1",
			model: "deepseek-chat",
			keySource: "none",
		});
	});
});
