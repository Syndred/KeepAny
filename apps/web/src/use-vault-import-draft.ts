import { useCallback, useEffect, useRef, useState } from "react";
import type { VaultSession } from "../../../packages/password-vault/src";
import { readImportDraft } from "./vault-import-draft";

/** Persists only through the unlocked KDBX session; no plaintext browser storage. */
export function useVaultImportDraft(
	session: VaultSession | null,
	value: string | null,
	initial: string | null,
	enabled: boolean,
) {
	const desired = useRef(value);
	const overrideValue = useRef<{ value: string | null } | null>(null);
	desired.current = overrideValue.current ? overrideValue.current.value : value;
	const saved = useRef(initial);
	const inFlight = useRef<Promise<void> | null>(null);
	const alive = useRef(true);
	const [status, setStatus] = useState<"saved" | "saving" | "failed">("saved");
	const flush = useCallback(
		async (override?: string | null) => {
			if (!session) throw Error("vault-locked");
			if (inFlight.current) await inFlight.current.catch(() => {});
			if (override !== undefined) {
				overrideValue.current = { value: override };
				desired.current = override;
			}
			let force = override !== undefined;
			if (!force && desired.current === saved.current) {
				if (alive.current) setStatus("saved");
				return;
			}
			const saving = (async () => {
				if (alive.current) setStatus("saving");
				try {
					while (force || desired.current !== saved.current) {
						force = false;
						const next = desired.current;
						readImportDraft(next);
						const revision = session.getSnapshot().revision;
						if (!revision) throw Error("vault-missing");
						await session.writeImportDraft(next, revision);
						saved.current = next;
					}
					if (alive.current) setStatus("saved");
				} catch {
					overrideValue.current = null;
					if (alive.current) setStatus("failed");
					throw Error("vault-draft-save");
				}
			})();
			inFlight.current = saving;
			try {
				await saving;
			} finally {
				if (inFlight.current === saving) inFlight.current = null;
			}
		},
		[session],
	);
	useEffect(() => {
		if (!enabled || !session || value === saved.current) return;
		const timer = window.setTimeout(() => {
			void flush().catch(() => {});
		}, 400);
		return () => window.clearTimeout(timer);
	}, [value, session, enabled, flush]);
	useEffect(() => {
		alive.current = true;
		const preventUnsavedReload = (event: BeforeUnloadEvent) => {
			if (desired.current === saved.current) return;
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", preventUnsavedReload);
		return () => {
			alive.current = false;
			window.removeEventListener("beforeunload", preventUnsavedReload);
		};
	}, []);
	return {
		flush,
		status:
			value !== saved.current && status === "saved"
				? ("saving" as const)
				: status,
	};
}
