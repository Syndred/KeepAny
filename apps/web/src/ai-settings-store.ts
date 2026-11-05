import { useEffect, useSyncExternalStore } from "react";
import type { AiConnection, AiProviderId } from "../../../packages/ai/src";
import type {
	VaultEntryDraft,
	VaultSnapshot,
} from "../../../packages/password-vault/src";
import { usePasswordVault } from "./components/PasswordVaultProvider";
import { platformSettingsStorage, type PlatformSettingsStorage } from "./platform-settings";

export const AI_SETTINGS_STORAGE_KEY = "keepany-ai-settings-v1";
export const aiProviderIds: AiProviderId[] = [
	"openai",
	"anthropic",
	"google",
	"deepseek",
	"qwen",
	"doubao",
	"moonshot",
	"minimax",
	"openrouter",
	"ollama",
	"compatible",
];
export type AiKeySource = "session" | "vault" | "none";
export type AiSettings = {
	provider: AiProviderId;
	baseURL: string;
	model: string;
	keySource: AiKeySource;
	vaultEntryId?: string;
	autoActivate?: boolean;
};
export type AiConfigurationInput = AiSettings & { apiKey?: string };
export type AiSettingsSnapshot = {
	loaded: boolean;
	configured: boolean;
	settings: AiSettings | null;
	connection: AiConnection | null;
	revision: number;
};
type SettingsStorage = PlatformSettingsStorage;
type AiVaultSession = {
	getSnapshot(): VaultSnapshot;
	subscribe(listener: () => void): () => void;
	readEntry(id: string): VaultEntryDraft;
};

export class AiSettingsError extends Error {
	constructor(public readonly code: string) {
		super(code);
	}
}

/** Only non-secret metadata is accepted by the persistence boundary. */
export function normalizeAiSettings(value: unknown): AiSettings {
	if (!value || typeof value !== "object")
		throw new AiSettingsError("aiSettingsInvalid");
	const candidate = value as Record<string, unknown>;
	if (
		!aiProviderIds.includes(candidate.provider as AiProviderId) ||
		typeof candidate.baseURL !== "string" ||
		typeof candidate.model !== "string" ||
		!["session", "vault", "none"].includes(candidate.keySource as string)
	)
		throw new AiSettingsError("aiSettingsInvalid");
	const model = candidate.model.trim();
	if (!model || model.length > 200)
		throw new AiSettingsError("aiSettingsModelRequired");
	let url: URL;
	try {
		url = new URL(candidate.baseURL.trim());
	} catch {
		throw new AiSettingsError("aiSettingsInvalidUrl");
	}
	const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	if (
		(url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.href.length > 2048
	)
		throw new AiSettingsError("aiSettingsInvalidUrl");
	if (
		candidate.keySource === "none" &&
		candidate.provider !== "ollama" &&
		candidate.provider !== "compatible" &&
		!local
	)
		throw new AiSettingsError("aiSettingsKeyRequired");
	const vaultEntryId =
		typeof candidate.vaultEntryId === "string"
			? candidate.vaultEntryId.trim()
			: "";
	if (
		candidate.keySource === "vault" &&
		(!vaultEntryId || vaultEntryId.length > 200)
	)
		throw new AiSettingsError("aiSettingsVaultEntryRequired");
	if (
		candidate.autoActivate !== undefined &&
		typeof candidate.autoActivate !== "boolean"
	)
		throw new AiSettingsError("aiSettingsInvalid");
	return {
		provider: candidate.provider as AiProviderId,
		baseURL: url.href.replace(/\/$/, ""),
		model,
		keySource: candidate.keySource as AiKeySource,
		...(candidate.keySource === "vault"
			? {
					vaultEntryId,
					...(typeof candidate.autoActivate === "boolean"
						? { autoActivate: candidate.autoActivate }
						: {}),
				}
			: {}),
	};
}

export type AiConnectionLease = {
	connection: AiConnection;
	signal: AbortSignal;
	isCurrent(): boolean;
	release(): void;
};

/** Secrets remain in KDBX or memory; automatic reuse requires an encrypted service binding. */
export class AiSettingsStore {
	private listeners = new Set<() => void>();
	private requests = new Set<AbortController>();
	private vault: AiVaultSession | null = null;
	private unsubscribeVault: (() => void) | null = null;
	private vaultFingerprint = "";
	private key = "";
	private mutationTail: Promise<void> | null = null;
	private lifecycleRevision = 0;
	private snapshot: AiSettingsSnapshot = {
		loaded: true,
		configured: false,
		settings: null,
		connection: null,
		revision: 0,
	};

	constructor(private readonly storage: SettingsStorage | null) {
		this.reload();
	}
	getSnapshot = (): AiSettingsSnapshot => this.snapshot;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	private publish(settings: AiSettings | null): void {
		for (const controller of this.requests) controller.abort();
		this.requests.clear();
		const usable = settings && (settings.keySource === "none" || this.key);
		this.snapshot = {
			loaded: true,
			configured: !!settings,
			settings,
			connection:
				usable && settings
					? {
							provider: settings.provider,
							baseURL: settings.baseURL,
							model: settings.model,
							apiKey: this.key,
						}
					: null,
			revision: this.snapshot.revision + 1,
		};
		for (const listener of this.listeners) listener();
	}
	reload = (): void => {
		let settings: AiSettings | null = null;
		try {
			const raw = this.storage?.getItem(AI_SETTINGS_STORAGE_KEY);
			if (raw) settings = normalizeAiSettings(JSON.parse(raw));
		} catch {
			/* Invalid or inaccessible metadata does not enable a connection. */
		}
		this.key = "";
		this.restoreAuthorizedVaultKey(settings);
		this.publish(settings);
	};
	attachVault = (session: AiVaultSession | null): void => {
		if (this.vault === session) return;
		this.unsubscribeVault?.();
		this.vault = session;
		this.vaultFingerprint = "";
		if (this.snapshot.settings?.keySource === "vault") {
			this.key = "";
			this.publish(this.snapshot.settings);
		}
		this.unsubscribeVault = session?.subscribe(this.handleVaultChange) ?? null;
		this.handleVaultChange();
	};
	private handleVaultChange = (): void => {
		const snapshot = this.vault?.getSnapshot();
		// Import-draft checkpoints change storage CAS revision without changing keys.
		const fingerprint = `${snapshot?.status ?? "missing"}:${snapshot?.contentRevision ?? ""}`;
		if (fingerprint === this.vaultFingerprint) return;
		this.vaultFingerprint = fingerprint;
		const settings = this.snapshot.settings;
		if (settings?.keySource === "vault") {
			const previousKey = this.key;
			this.key = "";
			this.restoreAuthorizedVaultKey(settings);
			// Unrelated writes must not cancel a valid connection or its in-flight requests.
			if (previousKey !== this.key) this.publish(settings);
		}
	};
	private restoreAuthorizedVaultKey(settings: AiSettings | null): void {
		if (
			settings?.keySource !== "vault" ||
			!settings.autoActivate ||
			!settings.vaultEntryId
		)
			return;
		try {
			this.key = this.readVaultKey(settings.vaultEntryId, settings);
		} catch {
			// Locked, missing, invalid or unbound entries stay unavailable without exposing values.
			this.key = "";
		}
	}
	private readVaultKey(entryId: string, authorizedTarget?: AiSettings): string {
		const vault = this.vault;
		const snapshot = vault?.getSnapshot();
		if (!vault || snapshot?.status !== "unlocked")
			throw new AiSettingsError("aiSettingsVaultLocked");
		if (!snapshot.entries.some((entry) => entry.id === entryId))
			throw new AiSettingsError("aiSettingsVaultEntryRequired");
		try {
			const entry = vault.readEntry(entryId);
			if (
				authorizedTarget &&
				(entry.aiKeyBinding?.version !== 1 ||
					entry.aiKeyBinding.provider !== authorizedTarget.provider ||
					entry.aiKeyBinding.baseURL !== authorizedTarget.baseURL)
			)
				throw new AiSettingsError("aiSettingsVaultBindingRequired");
			const key = entry.password.trim();
			if (!key || key.length > 4096)
				throw new AiSettingsError("aiSettingsKeyRequired");
			return key;
		} catch (error) {
			if (error instanceof AiSettingsError) throw error;
			throw new AiSettingsError("aiSettingsVaultReadFailed");
		}
	}
	private mutate(action: () => void | Promise<void>): void | Promise<void> {
		const outcome = this.mutationTail ? this.mutationTail.catch(() => {}).then(action) : action();
		if (outcome) {
			const pending = Promise.resolve(outcome);
			this.mutationTail = pending;
			void pending.then(() => { if (this.mutationTail === pending) this.mutationTail = null; },
				() => { if (this.mutationTail === pending) this.mutationTail = null; });
			return pending;
		}
	}
	saveConfiguration = (input: AiConfigurationInput): void | Promise<void> => {
		const lifecycle = this.lifecycleRevision;
		return this.mutate(() => {
		if (lifecycle !== this.lifecycleRevision) return;
		const settings = normalizeAiSettings(input);
		let nextKey = "";
		if (settings.keySource === "vault")
			nextKey = this.readVaultKey(
				settings.vaultEntryId as string,
				settings.autoActivate ? settings : undefined,
			);
		if (settings.keySource === "session") {
			const previous = this.snapshot.settings;
			const sameTarget =
				previous !== null &&
				previous.provider === settings.provider &&
				previous.baseURL === settings.baseURL &&
				previous.keySource === "session";
			nextKey =
				input.apiKey === undefined && sameTarget
					? this.key
					: (input.apiKey ?? "").trim();
			if (nextKey.length > 4096) throw new AiSettingsError("aiSettingsInvalid");
		}
		const commit = (revalidate = false) => {
			if (lifecycle !== this.lifecycleRevision) return;
			// Native persistence can yield while the vault locks or changes. Never
			// reactivate a key captured before that change after an async write.
			if (revalidate && settings.keySource === "vault") {
				try { nextKey = this.readVaultKey(settings.vaultEntryId as string, settings.autoActivate ? settings : undefined); }
				catch { nextKey = ""; }
			}
			this.key = nextKey;
			this.publish(settings);
		};
		let written: void | Promise<void>;
		try {
			if (!this.storage) throw new Error();
			written = this.storage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
		} catch {
			throw new AiSettingsError("aiSettingsStorageFailed");
		}
		if (written) return Promise.resolve(written).then(() => commit(true), () => { throw new AiSettingsError("aiSettingsStorageFailed"); });
		commit();
		});
	};
	setSessionApiKey = (key: string): void => {
		const settings = this.snapshot.settings;
		if (settings?.keySource !== "session")
			throw new AiSettingsError("aiSettingsInvalid");
		if (key.trim().length > 4096)
			throw new AiSettingsError("aiSettingsInvalid");
		this.key = key.trim();
		this.publish(settings);
	};
	activateVaultKey = (): void => {
		const settings = this.snapshot.settings;
		if (settings?.keySource !== "vault" || !settings.vaultEntryId)
			throw new AiSettingsError("aiSettingsVaultEntryRequired");
		this.key = this.readVaultKey(
			settings.vaultEntryId,
			settings.autoActivate ? settings : undefined,
		);
		this.publish(settings);
	};
	clearConfiguration = (): void | Promise<void> => {
		const lifecycle = this.lifecycleRevision;
		return this.mutate(() => {
		if (lifecycle !== this.lifecycleRevision) return;
		let removed: void | Promise<void>;
		try {
			removed = this.storage?.removeItem(AI_SETTINGS_STORAGE_KEY);
		} catch {
			throw new AiSettingsError("aiSettingsStorageFailed");
		}
		const commit = () => {
			if (lifecycle !== this.lifecycleRevision) return;
			this.key = "";
			this.publish(null);
		};
		if (removed) return Promise.resolve(removed).then(commit, () => { throw new AiSettingsError("aiSettingsStorageFailed"); });
		commit();
		});
	};
	acquire = (externalSignal?: AbortSignal): AiConnectionLease => {
		const connection = this.snapshot.connection;
		if (!connection) throw new AiSettingsError("aiSettingsConnectionRequired");
		const revision = this.snapshot.revision;
		const controller = new AbortController();
		const abort = () => controller.abort();
		if (externalSignal?.aborted) controller.abort();
		else externalSignal?.addEventListener("abort", abort, { once: true });
		this.requests.add(controller);
		return {
			connection: { ...connection },
			signal: controller.signal,
			isCurrent: () =>
				!controller.signal.aborted && revision === this.snapshot.revision,
			release: () => {
				this.requests.delete(controller);
				externalSignal?.removeEventListener("abort", abort);
			},
		};
	};
	dispose = (): void => {
		this.lifecycleRevision++;
		this.unsubscribeVault?.();
		this.unsubscribeVault = null;
		this.vault = null;
		this.key = "";
		this.publish(this.snapshot.settings);
	};
}

let defaultStore: AiSettingsStore | null = null;
function getStore(): AiSettingsStore {
	if (!defaultStore) {
		defaultStore = new AiSettingsStore(platformSettingsStorage);
	}
	return defaultStore;
}
export function getAiConnection(): AiConnection | null {
	return getStore().getSnapshot().connection;
}
export function acquireAiConnection(signal?: AbortSignal): AiConnectionLease {
	return getStore().acquire(signal);
}

export function useAiConnection() {
	const store = getStore();
	const vault = usePasswordVault();
	const snapshot = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);
	useEffect(() => {
		store.attachVault(vault.session);
	}, [store, vault.session]);
	useEffect(() => {
		const onStorage = (event: StorageEvent) => {
			if (event.key === AI_SETTINGS_STORAGE_KEY || event.key === null)
				store.reload();
		};
		window.addEventListener("storage", onStorage);
		return () => {
			window.removeEventListener("storage", onStorage);
		};
	}, [store]);
	return {
		...snapshot,
		saveConfiguration: store.saveConfiguration,
		clearConfiguration: store.clearConfiguration,
		setSessionApiKey: store.setSessionApiKey,
		activateVaultKey: store.activateVaultKey,
	};
}
