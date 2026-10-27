import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	readPasswordVault,
	savePasswordVault,
} from "../../../../packages/local-db/src";
import type {
	VaultEntryDraft,
	VaultEntrySummary,
	VaultSession,
	VaultSnapshot,
} from "../../../../packages/password-vault/src";

export type PasswordVaultStatus = VaultSnapshot["status"];
export type PasswordVaultEntrySummary = VaultEntrySummary;
export type PasswordVaultEntryDraft = VaultEntryDraft;
export type PasswordVaultSnapshot = VaultSnapshot;
export type PasswordVaultSession = VaultSession;

type PasswordVaultContextValue = {
	snapshot: PasswordVaultSnapshot;
	session: PasswordVaultSession | null;
	ensureReady: () => Promise<void>;
	lock: () => void;
	notice: string | null;
	generatePassword: () => Promise<string>;
};

const initialSnapshot: PasswordVaultSnapshot = {
	status: "loading",
	entries: [],
	trash: [],
	revision: null,
	contentRevision: null,
};

const PasswordVaultContext = createContext<PasswordVaultContextValue | null>(
	null,
);

export function PasswordVaultProvider({ children }: { children: ReactNode }) {
	const sessionRef = useRef<PasswordVaultSession | null>(null);
	const loadRef = useRef<Promise<void> | null>(null);
	const unsubscribeRef = useRef<(() => void) | null>(null);
	const mountedRef = useRef(true);
	const snapshotRef = useRef<PasswordVaultSnapshot>(initialSnapshot);
	const listenersRef = useRef(new Set<() => void>());
	const channelRef = useRef<BroadcastChannel | null>(null);
	const writesInFlightRef = useRef(0);
	const pendingExternalRevisionRef = useRef<string | null | undefined>(
		undefined,
	);
	const tabIdRef = useRef<string>(crypto.randomUUID());
	const [notice, setNotice] = useState<string | null>(null);

	const emit = useCallback((next?: PasswordVaultSnapshot) => {
		if (next) snapshotRef.current = next;
		for (const listener of listenersRef.current) listener();
	}, []);

	const subscribe = useCallback((listener: () => void) => {
		listenersRef.current.add(listener);
		return () => listenersRef.current.delete(listener);
	}, []);
	const getSnapshot = useCallback(() => snapshotRef.current, []);
	const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	const reconcileExternalRevision = useCallback(
		async (revision: string | null) => {
			const current = snapshotRef.current;
			const session = sessionRef.current;
			if (!session || current.status === "loading") return;
			if (current.status === "unlocked") {
				if (current.revision === revision) return;
				setNotice("pwVaultLockedElsewhere");
				session.lock();
				emit(session.getSnapshot());
				return;
			}
			if (current.status === "empty" && revision === null) return;
			if (current.status === "locked" && current.revision === revision) return;
			try {
				await session.initialize();
				if (mountedRef.current) emit(session.getSnapshot());
			} catch {
				// A failed metadata read leaves the current locked or empty state intact.
			}
		},
		[emit],
	);

	useEffect(() => {
		mountedRef.current = true;
		if (typeof BroadcastChannel !== "undefined") {
			const channel = new BroadcastChannel("keepany-password-vault");
			channelRef.current = channel;
			channel.onmessage = (event: MessageEvent<unknown>) => {
				if (
					!isRevisionMessage(event.data) ||
					event.data.source === tabIdRef.current
				)
					return;
				if (writesInFlightRef.current > 0) {
					pendingExternalRevisionRef.current = event.data.revision;
					return;
				}
				void reconcileExternalRevision(event.data.revision);
			};
		}
		return () => {
			mountedRef.current = false;
			unsubscribeRef.current?.();
			unsubscribeRef.current = null;
			sessionRef.current?.lock();
			sessionRef.current = null;
			channelRef.current?.close();
			channelRef.current = null;
		};
	}, [reconcileExternalRevision]);

	const ensureReady = useCallback(async () => {
		if (sessionRef.current) {
			const persisted = await readPasswordVault();
			await reconcileExternalRevision(persisted?.revision ?? null);
			return;
		}
		if (loadRef.current) return loadRef.current;
		const loading = (async () => {
			let created: PasswordVaultSession | null = null;
			const flushPendingExternalRevision = () => {
				if (
					writesInFlightRef.current !== 0 ||
					pendingExternalRevisionRef.current === undefined
				)
					return;
				const pending = pendingExternalRevisionRef.current;
				pendingExternalRevisionRef.current = undefined;
				void reconcileExternalRevision(pending);
			};
			try {
				const engine = await import("../../../../packages/password-vault/src");
				if (!mountedRef.current) return;
				created = new engine.VaultSession({
					read: () => readPasswordVault(),
					write: async (bytes: Uint8Array, expectedRevision: string | null) => {
						writesInFlightRef.current += 1;
						let completed = false;
						try {
							const record = await savePasswordVault(bytes, expectedRevision);
							completed = true;
							channelRef.current?.postMessage({
								type: "revision",
								revision: record.revision,
								source: tabIdRef.current,
							});
							return record;
						} finally {
							writesInFlightRef.current -= 1;
							if (!completed) queueMicrotask(flushPendingExternalRevision);
						}
					},
				});
				sessionRef.current = created;
				unsubscribeRef.current = created.subscribe(() => {
					if (mountedRef.current) {
						emit(created?.getSnapshot());
						flushPendingExternalRevision();
					}
				});
				await created.initialize();
				if (mountedRef.current) emit(created.getSnapshot());
			} catch (error) {
				if (sessionRef.current === created) {
					unsubscribeRef.current?.();
					unsubscribeRef.current = null;
					sessionRef.current?.lock();
					sessionRef.current = null;
					emit(initialSnapshot);
				}
				throw error;
			}
		})().finally(() => {
			if (loadRef.current === loading) loadRef.current = null;
		});
		loadRef.current = loading;
		return loading;
	}, [emit, reconcileExternalRevision]);

	const generatePassword = useCallback(async () => {
		const engine = await import("../../../../packages/password-vault/src");
		return engine.generatePassword();
	}, []);

	const lock = useCallback(() => {
		setNotice(null);
		const session = sessionRef.current;
		if (!session || snapshotRef.current.status !== "unlocked") return;
		session.lock();
		emit(session.getSnapshot());
	}, [emit]);

	useEffect(() => {
		window.addEventListener('keepany-native-background', lock);
		return () => window.removeEventListener('keepany-native-background', lock);
	}, [lock]);

	useEffect(() => {
		if (snapshot.status === "unlocked") setNotice(null);
	}, [snapshot.status]);

	const pollRevision = useCallback(async () => {
		if (
			writesInFlightRef.current > 0 ||
			snapshotRef.current.status === "loading"
		)
			return;
		try {
			const current = await readPasswordVault();
			if (writesInFlightRef.current === 0) {
				void reconcileExternalRevision(current?.revision ?? null);
			}
		} catch {
			// A temporary storage read failure does not expose or clear unlocked data.
		}
	}, [reconcileExternalRevision]);

	useEffect(() => {
		if (snapshot.status === "loading") return;
		let lastActivity = Date.now();
		const markActivity = () => {
			if (snapshotRef.current.status === "unlocked") lastActivity = Date.now();
		};
		const checkIdle = () => {
			void pollRevision();
			if (
				snapshotRef.current.status === "unlocked" &&
				Date.now() - lastActivity >= 5 * 60 * 1000
			)
				lock();
		};
		const events = ["pointerdown", "keydown", "touchstart"] as const;
		for (const event of events)
			window.addEventListener(event, markActivity, { passive: true });
		document.addEventListener("visibilitychange", checkIdle);
		const timer = window.setInterval(checkIdle, 15_000);
		return () => {
			for (const event of events)
				window.removeEventListener(event, markActivity);
			document.removeEventListener("visibilitychange", checkIdle);
			window.clearInterval(timer);
		};
	}, [lock, pollRevision, snapshot.status]);

	const value = useMemo<PasswordVaultContextValue>(
		() => ({
			snapshot,
			session: sessionRef.current,
			ensureReady,
			lock,
			notice,
			generatePassword,
		}),
		[snapshot, ensureReady, lock, notice, generatePassword],
	);
	return (
		<PasswordVaultContext.Provider value={value}>
			{children}
		</PasswordVaultContext.Provider>
	);
}

export function usePasswordVault(): PasswordVaultContextValue {
	const value = useContext(PasswordVaultContext);
	if (!value) throw new Error("PasswordVaultProvider is required");
	return value;
}

function isRevisionMessage(
	value: unknown,
): value is { type: "revision"; revision: string; source?: string } {
	if (!value || typeof value !== "object") return false;
	const message = value as {
		type?: unknown;
		revision?: unknown;
		source?: unknown;
	};
	return (
		message.type === "revision" &&
		typeof message.revision === "string" &&
		(message.source === undefined || typeof message.source === "string")
	);
}
