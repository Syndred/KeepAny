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
function vault() {
	let state: VaultSnapshot = {
		status: "unlocked",
		revision: "one",
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
				password: "vault-secret",
				url: "",
				notes: "",
				linkedAssetIds: [],
			};
		},
		update: (changes: Partial<VaultSnapshot>) => {
			state = { ...state, ...changes };
			for (const listener of listeners) listener();
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
		session.update({ revision: "two" });
		expect(reopened.getSnapshot().connection).toBeNull();
		reopened.activateVaultKey();
		session.update({ revision: "three", entries: [] });
		expect(() => reopened.activateVaultKey()).toThrow(
			"aiSettingsVaultEntryRequired",
		);
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
