import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import "../trash.css";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Network, Download, Eye, EyeOff, KeyRound, Lock, Plus, RefreshCw, Trash2, Undo2, Upload, WandSparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Asset } from "../../../../packages/domain/src";
import { MIN_MASTER_PASSWORD_LENGTH } from "../../../../packages/password-vault/src/policy";
import { type PasswordVaultEntryDraft, type PasswordVaultEntrySummary, usePasswordVault } from "./PasswordVaultProvider";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { TaskCard } from "./ui/task-card";
import { PasswordVaultEntryCard, VaultIconButton } from "./PasswordVaultEntryCard";
import "../password-vault.css";
import { withFilledVaultIdentifiers } from "../vault-entry-identifiers";
import { PasswordVaultTools } from "./PasswordVaultTools";
import { EntryEditor } from "./PasswordVaultEntryEditor";
import { EmptyState, LockedState } from "./PasswordVaultAccessStates";

export type AccountVaultTools = {
	renderEntry: (entry: PasswordVaultEntrySummary) => ReactNode;
	addEntry: (assetId: string) => void;
	requestAccess: () => void;
	copy: (label: string, value: string, privateValue?: boolean) => Promise<boolean>;
	cancelCopy: () => void;
	busy: boolean;
};

type PasswordVaultPanelProps = {
	assets: Asset[];
	notify?: (message: string) => void;
	focusAssetId?: string;
	onReady?: () => void;
	embedded?: boolean;
	headerAction?: ReactNode | ((state: { busy: boolean; clearMessage: () => void }) => ReactNode);
	sampleAccounts?: Asset[];
	accountCount?: number;
	renderAccounts?: (tools: AccountVaultTools) => ReactNode;
};

type ManualCopy = { label: string; value: string; privateValue?: boolean };

const MIN_MASTER_LENGTH = MIN_MASTER_PASSWORD_LENGTH;

function blankDraft(linkedAssetId?: string): PasswordVaultEntryDraft {
	return {
		title: "",
		username: "",
		password: "",
		url: "",
		notes: "",
		linkedAssetIds: linkedAssetId ? [linkedAssetId] : [],
	};
}

function errorCode(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (error && typeof error === "object" && "code" in error) {
		const code = (error as { code?: unknown }).code;
		return typeof code === "string" ? code : "";
	}
	return "";
}

function errorKey(error: unknown, context: "operation" | "import" = "operation"): string {
	switch (errorCode(error)) {
		case "password":
		case "vault-password":
		case "invalid-password":
			return "pwVaultWrongPassword";
		case "vault-locked":
			return "pwVaultLockedError";
		case "stale":
		case "vault-stale":
			return "pwVaultConflict";
		case "size":
		case "vault-size":
			return "pwVaultTooLarge";
		case "kdf":
		case "vault-kdf":
			return "pwVaultUnsupportedKdf";
		case "invalid":
		case "vault-invalid":
		case "missing":
		case "vault-missing":
			return context === "import" ? "pwVaultInvalidBackup" : "pwVaultError";
		default:
			return "pwVaultError";
	}
}

function formatDate(value: string, language: string): string {
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) return value;
	return new Intl.DateTimeFormat(language, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

export function PasswordVaultPanel({
	assets,
	notify,
	focusAssetId,
	onReady,
	embedded = false,
	headerAction,
	sampleAccounts = [],
	accountCount,
	renderAccounts,
}: PasswordVaultPanelProps) {
	const Heading = embedded ? "h2" : "h1";
	const { t, i18n } = useTranslation();
	const { snapshot, session, ensureReady, lock, notice, generatePassword } =
		usePasswordVault();
	const navigate = useNavigate();
	const hash = useRouterState({ select: (state) => state.location.hash });
	const copyGeneration = useRef(0);
	const panelElement = useRef<HTMLElement | null>(null);
	const toolTrigger = (tool: "smart" | "links") =>
		panelElement.current?.querySelector<HTMLElement>(`[data-vault-tool-trigger="${tool}"]`)
		?? panelElement.current?.querySelector<HTMLElement>(".unified-vault-access > summary, #password-vault-unlock-master, #password-vault-master")
		?? null;
	const readyNotified = useRef(false);
	useEffect(() => {
		if (snapshot.status === "loading" || readyNotified.current || !onReady) return;
		const frame = requestAnimationFrame(() => {
			readyNotified.current = true;
			onReady();
		});
		return () => cancelAnimationFrame(frame);
	}, [snapshot.status, onReady]);
	useEffect(
		() => () => {
			copyGeneration.current += 1;
		},
		[],
	);
	useEffect(() => {
		if (hash !== "vault-trash" || snapshot.status !== "unlocked") return;
		const frame = requestAnimationFrame(() => document.getElementById("vault-trash")?.scrollIntoView({ block: "start" }));
		return () => cancelAnimationFrame(frame);
	}, [hash, snapshot.status]);
	useEffect(() => {
		if (snapshot.status !== "unlocked" || !hash.startsWith("password-")) return;
		const card = [
			...document.querySelectorAll<HTMLElement>(
				".password-vault-entry-list .password-vault-entry, .compact-account-card",
			),
		].find((node) => node.dataset.entryId === hash.slice(9));
		const group = card?.closest("details");
		if (group) group.open = true;
		const frame = requestAnimationFrame(() => {
			card?.scrollIntoView({ block: "center" });
			card?.focus({ preventScroll: true });
		});
		return () => cancelAnimationFrame(frame);
	}, [hash, snapshot.status, snapshot.entries]);
	const [readyError, setReadyError] = useState<string | null>(null);
	const [messageKey, setMessageKey] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [master, setMaster] = useState("");
	const [masterConfirm, setMasterConfirm] = useState("");
	const [search, setSearch] = useState("");
	const [accessOpen, setAccessOpen] = useState(!assets.some((asset) => asset.kind === "account" && !asset.deleted));
	const [assetFilter, setAssetFilter] = useState(focusAssetId ?? "");
	const [editorId, setEditorId] = useState<string | null>(null);
	const [draft, setDraft] = useState<PasswordVaultEntryDraft | null>(null);
	const [editorLoading, setEditorLoading] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const [showMaster, setShowMaster] = useState(false);
	const [selectedAssetId, setSelectedAssetId] = useState("");
	const [historyEntry, setHistoryEntry] =
		useState<PasswordVaultEntrySummary | null>(null);
	const [historyRows, setHistoryRows] = useState<
		Array<{ at: string; draft: PasswordVaultEntryDraft }>
	>([]);
	const [historyReveal, setHistoryReveal] = useState<number | null>(null);
	const [importOpen, setImportOpen] = useState(false);
	const [smartImportOpen, setSmartImportOpen] = useState(false);
	const [accountLinksOpen, setAccountLinksOpen] = useState(false);
	const [importFile, setImportFile] = useState<File | null>(null);
	const [importPassword, setImportPassword] = useState("");
	const [changeMasterOpen, setChangeMasterOpen] = useState(false);
	const [currentMaster, setCurrentMaster] = useState("");
	const [newMaster, setNewMaster] = useState("");
	const [newMasterConfirm, setNewMasterConfirm] = useState("");
	const [manualCopy, setManualCopy] = useState<ManualCopy | null>(null);
	const cancelCopy = useCallback(() => { copyGeneration.current += 1; setManualCopy(null); }, []);
	const [unlinkTarget, setUnlinkTarget] = useState<{
		entryId: string;
		assetId: string;
		entryName: string;
		assetName: string;
		revision: string;
	} | null>(null);
	const [deleteTarget, setDeleteTarget] =
		useState<PasswordVaultEntrySummary | null>(null);
	const [purgeTarget, setPurgeTarget] = useState<{ entries: PasswordVaultEntrySummary[]; revision: string; all: boolean } | null>(null);
	const [entryActionError, setEntryActionError] = useState("");
	const entryActionRunning = useRef(false);
	const unlinkedFocus = useRef<string | null>(null);
	const purgeOpener = useRef<HTMLElement | null>(null);
	const generateRequestRef = useRef(0);
	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		let active = true;
		void ensureReady().catch((error: unknown) => {
			if (active) setReadyError(errorKey(error));
		});
		return () => {
			active = false;
		};
	}, [ensureReady]);

	useEffect(() => {
		setAssetFilter(focusAssetId ?? "");
	}, [focusAssetId]);
	useEffect(() => {
		if (unlinkTarget || !unlinkedFocus.current || snapshot.status !== "unlocked") return;
		// Moving between account groups remounts the card. Resolve its current
		// element after the committed layout instead of focusing the removed view.
		const frame = requestAnimationFrame(() => {
			const entryId = unlinkedFocus.current;
			unlinkedFocus.current = null;
			const card = [...document.querySelectorAll<HTMLElement>(".password-vault-entry-list .password-vault-entry")]
				.find(node => node.dataset.entryId === entryId);
			if (!card) {
				const continuation = document.querySelector<HTMLElement>(".password-vault-filter button")
					?? document.querySelector<HTMLElement>("#password-vault-search-input");
				continuation?.scrollIntoView({ block: "nearest" });
				continuation?.focus({ preventScroll: true });
				return;
			}
			const group = card.closest("details");
			if (group) group.open = true;
			card.scrollIntoView({ block: "nearest" });
			card.focus({ preventScroll: true });
		});
		return () => cancelAnimationFrame(frame);
	}, [unlinkTarget, snapshot.status, snapshot.entries]);

	useEffect(() => {
		if (snapshot.status === "unlocked") return;
		unlinkedFocus.current = null;
		copyGeneration.current += 1;
		setAccountLinksOpen(false);
		setMessageKey(null);
		setEditorId(null);
		setDraft(null);
		setMaster("");
		setMasterConfirm("");
		setShowMaster(false);
		setSearch("");
		setSelectedAssetId("");
		setHistoryEntry(null);
		setHistoryRows([]);
		setHistoryReveal(null);
		setManualCopy(null);
		setUnlinkTarget(null);
		setDeleteTarget(null);
		setPurgeTarget(null);
		setEntryActionError("");
		setImportPassword("");
		setImportOpen(false);
		if (notice !== "pwVaultLockedElsewhere") setSmartImportOpen(false);
		setChangeMasterOpen(false);
		setBusy(false);
		setCurrentMaster("");
		setNewMaster("");
		setNewMasterConfirm("");
	}, [snapshot.status, notice]);

	useEffect(() => {
		if (
			!editorId ||
			editorId === "new" ||
			!session ||
			snapshot.status !== "unlocked"
		)
			return;
		let active = true;
		setEditorLoading(true);
		try {
			const entry = session.readEntry(editorId);
			if (active) setDraft(entry);
		} catch (error) {
			if (active) {
				setMessageKey(errorKey(error));
				setEditorId(null);
			}
		} finally {
			if (active) setEditorLoading(false);
		}
		return () => {
			active = false;
		};
	}, [editorId, session, snapshot.status]);

	const visibleAssets = useMemo(
		() => assets.filter((asset) => !asset.deleted && asset.kind !== "vault"),
		[assets],
	);
	const assetsById = useMemo(
		() => new Map(visibleAssets.map((asset) => [asset.id, asset])),
		[visibleAssets],
	);
	const allAssetsById = useMemo(
		() => new Map(assets.filter(asset => !asset.purged).map((asset) => [asset.id, asset])),
		[assets],
	);
	const normalizedSearch = search.trim().toLocaleLowerCase(i18n.language);
	const scopedEntries = useMemo(
		() =>
			assetFilter
				? snapshot.entries.filter((entry) =>
						entry.linkedAssetIds.includes(assetFilter),
					)
				: snapshot.entries,
		[snapshot.entries, assetFilter],
	);
	const filteredEntries = useMemo(
		() =>
			scopedEntries.filter((entry) => {
				if (!normalizedSearch) return true;
				return [
					entry.title,
					entry.username,
					...(entry.usernameAliases ?? []),
					entry.url,
				].some((value) =>
					value.toLocaleLowerCase(i18n.language).includes(normalizedSearch),
				);
			}),
		[scopedEntries, normalizedSearch, i18n.language],
	);

	function announce(key: string) {
		setMessageKey(
			notify &&
				[
					"pwVaultCreated",
					"pwVaultSaved",
					"pwVaultCopied",
					"pwVaultImported",
					"pwVaultExported",
					"pwVaultHistoryRestored",
					"pwVaultMasterChanged",
				].includes(key)
				? null
				: key,
		);
		notify?.(t(key));
	}

	function clearMessage() {
		setMessageKey(null);
	}

	function retryReady() {
		setReadyError(null);
		void ensureReady().catch((error: unknown) =>
			setReadyError(errorKey(error)),
		);
	}

	function openNewEditor() {
		clearMessage();
		setEditorId("new");
		setDraft(blankDraft(assetFilter));
		setShowPassword(false);
		setSelectedAssetId("");
	}

	function openAnotherAccount(entry: PasswordVaultEntrySummary) {
		openNewEditor();
		setDraft({
			...blankDraft(assetFilter),
			title: entry.title,
			url: entry.url,
		});
	}

	function openEditor(id: string) {
		clearMessage();
		setEditorId(id);
		setDraft(null);
		setShowPassword(false);
		setSelectedAssetId("");
	}

	async function fillGeneratedPassword() {
		const request = ++generateRequestRef.current;
		try {
			const value = await generatePassword();
			if (
				request === generateRequestRef.current &&
				snapshot.status === "unlocked"
			) {
				setDraft((current) =>
					current ? { ...current, password: value } : current,
				);
			}
		} catch (error) {
			announce(errorKey(error));
		}
	}

	function closeEditor() {
		setEditorId(null);
		setDraft(null);
		setShowPassword(false);
		setSelectedAssetId("");
	}

	async function createVault(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || !session) return;
		if (master.length < MIN_MASTER_LENGTH) {
			announce("pwVaultPasswordTooShort");
			return;
		}
		if (master !== masterConfirm) {
			announce("pwVaultPasswordMismatch");
			return;
		}
		setBusy(true);
		clearMessage();
		try {
			await session.create(master);
			setMaster("");
			setMasterConfirm("");
			announce("pwVaultCreated");
		} catch (error) {
			announce(errorKey(error));
		} finally {
			setBusy(false);
		}
	}

	async function unlockVault(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || !session || !master) return;
		setBusy(true);
		clearMessage();
		try {
			await session.unlock(master);
			setMaster("");
			notify?.(t("pwVaultStatusUnlocked"));
		} catch (error) {
			announce(
				errorCode(error) === "vault-password"
					? "pwVaultUnlockFailed"
					: errorKey(error),
			);
		} finally {
			setBusy(false);
		}
	}

	async function saveEntry(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || !session || !draft) return;
		const next: PasswordVaultEntryDraft = {
			...withFilledVaultIdentifiers(draft),
			title: draft.title.trim(),
			username: draft.username,
			url: draft.url.trim(),
			notes: draft.notes.trim(),
			linkedAssetIds: [...new Set(draft.linkedAssetIds)],
		};
		if (!next.title) {
			announce("pwVaultEntryTitleRequired");
			return;
		}
		if (next.url && !/^https?:\/\//i.test(next.url)) {
			announce("pwVaultInvalidUrl");
			return;
		}
		setBusy(true);
		clearMessage();
		try {
			await session.saveEntry(next);
			closeEditor();
			announce("pwVaultSaved");
		} catch (error) {
			announce(errorKey(error));
		} finally {
			setBusy(false);
		}
	}

	async function deleteEntry(entry: PasswordVaultEntrySummary) {
		if (busy || entryActionRunning.current || !session) return;
		entryActionRunning.current = true;
		setBusy(true);
		clearMessage();
		try {
			await session.trashEntry(entry.id);
			setDeleteTarget(null);
			announce("pwVaultSaved");
		} catch (error) {
			setEntryActionError(
				errorCode(error) === "vault-password"
					? "pwVaultCurrentMasterWrong"
					: errorKey(error),
			);
		} finally {
			entryActionRunning.current = false;
			setBusy(false);
		}
	}
	async function purgeEntries() {
		if (!purgeTarget || busy || entryActionRunning.current || !session) return;
		entryActionRunning.current = true;
		setBusy(true);
		setEntryActionError("");
		try {
			await session.purgeEntries(purgeTarget.entries.map(entry => entry.id), purgeTarget.revision);
			setPurgeTarget(null);
			setMessageKey("trashDeleted");
		} catch (error) { setEntryActionError(errorKey(error)); }
		finally { entryActionRunning.current = false; setBusy(false); }
	}
	function reviewPurge(entries: PasswordVaultEntrySummary[], all = false) {
		purgeOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		setEntryActionError("");
		setPurgeTarget({ entries, revision: snapshot.contentRevision ?? "", all });
	}

	async function unlinkAsset() {
		if (!unlinkTarget || busy || entryActionRunning.current || !session) return;
		entryActionRunning.current = true;
		setBusy(true);
		setEntryActionError("");
		try {
			await session.unlinkAsset(
				unlinkTarget.entryId,
				unlinkTarget.assetId,
				unlinkTarget.revision,
			);
			unlinkedFocus.current = unlinkTarget.entryId;
			setUnlinkTarget(null);
			setMessageKey("pwVaultUnlinked");
		} catch (error) {
			setEntryActionError(errorKey(error));
		} finally {
			entryActionRunning.current = false;
			setBusy(false);
		}
	}

	async function restoreEntry(entry: PasswordVaultEntrySummary) {
		if (busy || !session) return;
		setBusy(true);
		clearMessage();
		try {
			await session.restoreEntry(entry.id);
			announce("pwVaultHistoryRestored");
		} catch (error) {
			announce(errorKey(error));
		} finally {
			setBusy(false);
		}
	}

	async function openHistory(entry: PasswordVaultEntrySummary) {
		if (!session || busy) return;
		setBusy(true);
		clearMessage();
		try {
			setHistoryRows(session.history(entry.id));
			setHistoryEntry(entry);
			setHistoryReveal(null);
		} catch (error) {
			announce(errorKey(error));
		} finally {
			setBusy(false);
		}
	}

	async function restoreHistory(index: number) {
		if (!session || !historyEntry || busy) return;
		setBusy(true);
		clearMessage();
		try {
			await session.restoreHistory(historyEntry.id, index);
			setHistoryEntry(null);
			setHistoryRows([]);
			announce("pwVaultHistoryRestored");
		} catch (error) {
			announce(errorKey(error));
		} finally {
			setBusy(false);
		}
	}

	async function importVault(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || !session || !importFile || !importPassword) {
			if (!importFile) announce("pwVaultNoFile");
			return;
		}
		setBusy(true);
		clearMessage();
		try {
			if (importFile.size > 16 * 1024 * 1024) {
				announce("pwVaultFileTooLarge");
				return;
			}
			const bytes = new Uint8Array(await importFile.arrayBuffer());
			await session.importKdbx(bytes, importPassword);
			setImportOpen(false);
			setImportFile(null);
			setImportPassword("");
			if (fileInputRef.current) fileInputRef.current.value = "";
			announce("pwVaultImported");
		} catch (error) {
			announce(errorKey(error, "import"));
		} finally {
			setBusy(false);
		}
	}

	async function exportVault() {
		if (busy || !session || snapshot.status !== "unlocked") return;
		setBusy(true);
		clearMessage();
		try {
			const bytes = await session.exportKdbx();
			const url = URL.createObjectURL(
				new Blob([new Uint8Array(bytes).buffer], {
					type: "application/octet-stream",
				}),
			);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = t("pwVaultExportFilename");
			anchor.click();
			window.setTimeout(() => URL.revokeObjectURL(url), 0);
			announce("pwVaultExported");
		} catch (error) {
			announce(errorKey(error));
		} finally {
			setBusy(false);
		}
	}

	async function changeMasterPassword(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || !session) return;
		if (newMaster.length < MIN_MASTER_LENGTH) {
			announce("pwVaultPasswordTooShort");
			return;
		}
		if (newMaster !== newMasterConfirm) {
			announce("pwVaultPasswordMismatch");
			return;
		}
		setBusy(true);
		clearMessage();
		try {
			await session.changeMasterPassword(currentMaster, newMaster);
			setChangeMasterOpen(false);
			setCurrentMaster("");
			setNewMaster("");
			setNewMasterConfirm("");
			announce("pwVaultMasterChanged");
		} catch (error) {
			announce(
				errorCode(error) === "vault-password"
					? "pwVaultCurrentMasterWrong"
					: errorKey(error),
			);
		} finally {
			setBusy(false);
		}
	}

	async function copyValue(labelKey: string, value: string, privateValue = true): Promise<boolean> {
		if (privateValue && session?.getSnapshot().status !== "unlocked") return false;
		const request = ++copyGeneration.current;
		if (!value) {
			announce("pwVaultError");
			return false;
		}
		try {
			if (!navigator.clipboard?.writeText) throw new Error("clipboard");
			await navigator.clipboard.writeText(value);
			if (
				request !== copyGeneration.current ||
				privateValue && session?.getSnapshot().status !== "unlocked"
			)
				return false;
			announce("pwVaultCopied");
			return true;
		} catch {
			if (
				request !== copyGeneration.current ||
				privateValue && session?.getSnapshot().status !== "unlocked"
			)
				return false;
			setManualCopy({ label: t(labelKey), value, privateValue });
			announce("pwVaultClipboardManual");
			return false;
		}
	}

	function requestAccountAccess() {
		setAccessOpen(true);
		requestAnimationFrame(() => {
			const input = panelElement.current?.querySelector<HTMLInputElement>("#password-vault-unlock-master, #password-vault-master");
			input?.scrollIntoView({ block: "center" }); input?.focus({ preventScroll: true });
		});
	}
	const accountTools: AccountVaultTools = { renderEntry, copy: copyValue, cancelCopy, busy: busy || snapshot.status === "loading", requestAccess: requestAccountAccess, addEntry: (assetId) => {
		if (busy) return;
		if (snapshot.status !== "unlocked") { requestAccountAccess(); return; }
		clearMessage(); setEditorId("new"); setDraft(blankDraft(assetId)); setSelectedAssetId(""); setShowPassword(false);
	} };

	function linkedAssetLabel(id: string): string {
		return assetsById.get(id)?.name ?? t("pwVaultAssetUnavailable");
	}

	function renderEntry(entry: PasswordVaultEntrySummary) {
		if (!session) return null;
		return (
			<PasswordVaultEntryCard
				key={`${entry.id}:${entry.modifiedAt}`}
				entry={entry}
				session={session}
				busy={busy}
				assetsById={allAssetsById}
				onEdit={() => openEditor(entry.id)}
				onAddAnother={() => openAnotherAccount(entry)}
				onDelete={() => {
					clearMessage();
					setEntryActionError("");
					setDeleteTarget(entry);
				}}
				onUnlink={(assetId) => {
					const revision = snapshot.contentRevision;
					if (!revision || busy) return;
					clearMessage();
					setEntryActionError("");
					setUnlinkTarget({
						entryId: entry.id,
						assetId,
						entryName: entry.title,
						assetName:
							allAssetsById.get(assetId)?.name ?? t("pwVaultAssetUnavailable"),
						revision,
					});
				}}
				onHistory={() => void openHistory(entry)}
				onCopy={(label, value) => void copyValue(label, value)}
			/>
		);
	}

	const missingSampleAccounts = sampleAccounts.filter((asset) => !snapshot.entries.some((entry) => entry.linkedAssetIds.includes(asset.id)));
	async function addSampleLogins() {
		if (session?.getSnapshot().status !== "unlocked" || busy || entryActionRunning.current) return;
		entryActionRunning.current = true; setBusy(true); clearMessage();
		try {
			for (const asset of missingSampleAccounts) {
				if (session.getSnapshot().entries.some((entry) => entry.linkedAssetIds.includes(asset.id))) continue;
				await session.saveEntry({ title: asset.name, username: asset.username, url: asset.url, notes: "", password: asset.username ? await generatePassword() : "", linkedAssetIds: [asset.id] });
			}
			announce("sampleLoginsAdded");
		} catch (error) { announce(errorKey(error)); }
		finally { entryActionRunning.current = false; setBusy(false); }
	}

	const vaultAccess = <>
			{snapshot.status === "loading" && (
				<div className="password-vault-loading">
					<RefreshCw size={18} /> {t("pwVaultLoading")}
				</div>
			)}
			{snapshot.status === "empty" && (
				<EmptyState
					busy={busy}
					master={master}
					masterConfirm={masterConfirm}
					showMaster={showMaster}
					setMaster={setMaster}
					setMasterConfirm={setMasterConfirm}
					setShowMaster={setShowMaster}
					onCreate={createVault}
					onImport={() => setImportOpen(true)}
				/>
			)}
			{snapshot.status === "locked" && (
				<LockedState
					busy={busy}
					master={master}
					showMaster={showMaster}
					setMaster={setMaster}
					setShowMaster={setShowMaster}
					onUnlock={unlockVault}
				/>
			)}
	</>;

	const message = messageKey ? t(messageKey) : notice ? t(notice) : "";

	const vaultStatus = (
		<div className="password-vault-header-meta">
			<p>
				{renderAccounts || snapshot.status === "unlocked"
					? t("pwVaultEntriesCount", { count: renderAccounts ? accountCount ?? assets.filter(asset => asset.kind === "account" && !asset.deleted).length : snapshot.entries.length })
					: t(renderAccounts ? "workspaceAccountSubtitle" : "pwVaultSubtitle")}
			</p>
			<Badge
				role="status"
				tone={
					snapshot.status === "unlocked"
						? "success"
						: snapshot.status === "empty"
							? "warning"
							: "muted"
				}
			>
				{t(
					snapshot.status === "unlocked"
						? "pwVaultStatusUnlocked"
						: snapshot.status === "empty"
							? "pwVaultStatusEmpty"
							: snapshot.status === "locked"
								? "pwVaultStatusLocked"
								: "pwVaultLoading",
				)}
			</Badge>
		</div>
	);

	return (
		<section className="password-vault-panel" ref={panelElement}>
			<PasswordVaultTools
                linksOpen={accountLinksOpen} smartOpen={smartImportOpen}
                unlocked={snapshot.status === "unlocked"} lockedElsewhere={notice === "pwVaultLockedElsewhere"}
                closeLinks={() => setAccountLinksOpen(false)} closeSmart={() => setSmartImportOpen(false)}
                openLinks={() => setAccountLinksOpen(true)} returnFocusTo={toolTrigger} notify={notify}
            />
			<header
				className={`password-vault-header card-header${snapshot.status === "unlocked" ? " password-vault-header-inline" : ""}`}
			>
				<div>
					<Heading>{t(renderAccounts ? "accountsWorkspace" : "pwVaultTitle")}</Heading>
					{vaultStatus}
				</div>
				{!(renderAccounts && assetFilter) && (typeof headerAction === "function" ? headerAction({ busy: busy || snapshot.status === "loading", clearMessage }) : headerAction)}
			</header>
			{message && (
				<p className="password-vault-message" role="status">
					{message}
				</p>
			)}
			{readyError ? (
				<div className="password-vault-message" role="alert">
					<span>{t(readyError)}</span>
					<Button size="small" onClick={retryReady}>
						<RefreshCw size={14} /> {t("pwVaultRetry")}
					</Button>
				</div>
			) : null}
{renderAccounts && snapshot.status !== "unlocked" ? <details className="unified-vault-access" open={accessOpen} onToggle={(event) => setAccessOpen(event.currentTarget.open)}>
				<summary>{t(snapshot.status === "empty" ? "pwVaultCreate" : "pwVaultUnlock")}</summary>{vaultAccess}
			</details> : vaultAccess}
			{renderAccounts && snapshot.status !== "unlocked" && renderAccounts(accountTools)}
			{snapshot.status === "unlocked" && (
				<>
					<div className="password-vault-toolbar">
						{(!renderAccounts || assetFilter) && <div className="password-vault-search field">
							<label
								className="password-vault-sr"
								htmlFor="password-vault-search-input"
							>
								{t("pwVaultSearch")}
							</label>
							<Input
								id="password-vault-search-input"
								type="search"
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								placeholder={t("pwVaultSearch")}
								autoComplete="off"
							/>
						</div>}
						<div className="actions">
							{missingSampleAccounts.length > 0 && <Button size="small" disabled={busy} onClick={() => void addSampleLogins()}>{t("sampleLogins")}</Button>}
							<VaultIconButton
								label={t("pwConnectTitle")}
								data-vault-tool-trigger="links"
								disabled={busy}
								onClick={() => setAccountLinksOpen(true)}
							>
								<Network size={18} />
							</VaultIconButton>
							<VaultIconButton
								label={t("pwVaultLock")}
								disabled={busy}
								onClick={lock}
							>
								<Lock size={18} />
							</VaultIconButton>
							<VaultIconButton
								label={t("pwVaultImport")}
								disabled={busy}
								onClick={() => setImportOpen(true)}
							>
								<Upload size={18} />
							</VaultIconButton>
							<VaultIconButton
								label={t("pwSmartTitle")}
								data-vault-tool-trigger="smart"
								disabled={busy}
								onClick={() => setSmartImportOpen(true)}
							>
								<WandSparkles size={18} />
							</VaultIconButton>
							<VaultIconButton
								label={t("pwVaultExport")}
								disabled={busy}
								onClick={() => void exportVault()}
							>
								<Download size={18} />
							</VaultIconButton>
							<VaultIconButton
								label={t("pwVaultChangeMaster")}
								disabled={busy}
								onClick={() => setChangeMasterOpen(true)}
							>
								<KeyRound size={18} />
							</VaultIconButton>
							{(!renderAccounts || assetFilter) && <VaultIconButton
								label={t("pwVaultNewEntry")}
								className="password-vault-new"
								disabled={busy}
								onClick={openNewEditor}
							>
								<Plus size={18} />
							</VaultIconButton>}
						</div>
					</div>
					{assetFilter && (
						<div className="password-vault-filter">
							<span>
								{t("pwVaultAssetFilter", {
									name: linkedAssetLabel(assetFilter),
								})}
							</span>
							<Button
								size="small"
								variant="ghost"
								disabled={busy}
								onClick={() => {
									setAssetFilter("");
									void navigate({
										to: "/assets/$kind",
										params: { kind: "vault" },
										hash: "",
										replace: true,
									});
								}}
							>
								<X size={14} /> {t("pwVaultClearAssetFilter")}
							</Button>
						</div>
					)}

					{renderAccounts && !assetFilter ? renderAccounts(accountTools) : <div className="password-vault-entries-section">
						{filteredEntries.length ? (
							<div className="password-vault-entry-list">
								{filteredEntries.map((entry) => renderEntry(entry))}
							</div>
						) : (
							<div className="password-vault-empty">
								<KeyRound size={22} />
								<p>
									{t(
										normalizedSearch ? "pwVaultNoMatches" : "pwVaultNoEntries",
									)}
								</p>
							</div>
						)}
					</div>}
					<div className="password-vault-trash" id="vault-trash">
						<div className="password-vault-section-title">
							<h3 tabIndex={-1}>
								<Trash2 size={18} /> {t("pwVaultTrashTitle")}
							</h3>
							<small>{t("pwVaultTrashHint")}</small>
							{snapshot.trash.length > 0 && <Button variant="danger" disabled={busy} onClick={() => reviewPurge(snapshot.trash, true)}>{t("emptyTrash")}</Button>}
						</div>
						{snapshot.trash.length ? (
							<div className="password-vault-trash-list">
								{snapshot.trash.map((entry) => (
									<TaskCard
										key={entry.id}
										className="password-vault-entry password-vault-entry-trash"
										data-entry-id={entry.id}
									>
										<div className="password-vault-entry-main">
											<div>
												<strong>{entry.title}</strong>
												<small>
													{entry.username || t("pwVaultNoLinkedAssets")}
												</small>
											</div>

										</div>
										<div className="actions">
											<Button disabled={busy} onClick={() => void restoreEntry(entry)}><Undo2 size={18} />{t("pwVaultRestoreEntry")}</Button>
											<Button variant="danger" disabled={busy} onClick={() => reviewPurge([entry])}>{t("deletePermanently")}</Button>
										</div>
									</TaskCard>
								))}
							</div>
						) : (
							<p className="password-vault-muted">{t("pwVaultTrashEmpty")}</p>
						)}
					</div>
				</>
			)}
			{purgeTarget && <Dialog className="password-vault-purge-dialog" title={t(purgeTarget.all ? "emptyTrash" : "deletePermanently")} closeDisabled={busy}
				returnFocusTo={() => purgeOpener.current?.isConnected ? purgeOpener.current : document.querySelector<HTMLElement>(".password-vault-entry-trash .actions button, #vault-trash h3")}
				onClose={() => { if (!entryActionRunning.current) setPurgeTarget(null); }}>
				<p>{!purgeTarget.all ? purgeTarget.entries[0].title : t("emptyTrashConfirm", { count: purgeTarget.entries.length })}</p>
				<p>{t("pwVaultPurgeWarning")}</p>
				{entryActionError && <p className="field-error" role="alert">{t(entryActionError)}</p>}
				<div className="actions"><Button disabled={busy} onClick={() => setPurgeTarget(null)}>{t("cancel")}</Button>
					<Button variant="danger" disabled={busy} onClick={() => void purgeEntries()}>{t(busy ? "loading" : purgeTarget.all ? "emptyTrash" : "deletePermanently")}</Button></div>
			</Dialog>}

			{unlinkTarget && (
				<Dialog
					title={t("pwVaultUnlink")}
					returnFocusTo={() =>
						[
							...document.querySelectorAll<HTMLElement>(
								".password-vault-entry-list .password-vault-entry",
							),
						].find((card) => card.dataset.entryId === unlinkTarget.entryId) ??
						null
					}
					closeDisabled={busy}
					onClose={() => {
						if (!entryActionRunning.current) setUnlinkTarget(null);
					}}
				>
					<p>
						{t("pwVaultUnlinkConfirm", {
							entry: unlinkTarget.entryName,
							asset: unlinkTarget.assetName,
						})}
					</p>
					<p>{t("pwVaultUnlinkHint")}</p>
					{entryActionError && (
						<p className="field-error" role="alert">
							{t(entryActionError)}
						</p>
					)}
					<div className="actions">
						<Button disabled={busy} onClick={() => setUnlinkTarget(null)}>
							{t("cancel")}
						</Button>
						<Button
							variant="danger"
							disabled={busy}
							onClick={() => void unlinkAsset()}
						>
							{t("pwVaultUnlink")}
						</Button>
					</div>
				</Dialog>
			)}
			{deleteTarget && (
				<Dialog
					title={t("pwVaultDeleteEntry")}
					closeDisabled={busy}
					onClose={() => {
						if (!entryActionRunning.current) setDeleteTarget(null);
					}}
				>
					<p>{deleteTarget.title}</p>
					<p>{t("pwVaultTrashEntryHint")}</p>
					{entryActionError && (
						<p className="field-error" role="alert">
							{t(entryActionError)}
						</p>
					)}
					<div className="actions">
						<Button disabled={busy} onClick={() => setDeleteTarget(null)}>
							{t("cancel")}
						</Button>
						<Button
							variant="danger"
							disabled={busy}
							onClick={() => void deleteEntry(deleteTarget)}
						>
							{t("pwVaultDeleteEntry")}
						</Button>
					</div>
				</Dialog>
			)}
			{editorId && (
				<Dialog
					title={
						editorId === "new" ? t("pwVaultEntryNew") : t("pwVaultEntryEdit")
					}
					onClose={closeEditor}
				>
					<form
						className="password-vault-editor"
						onSubmit={(event) => void saveEntry(event)}
					>
						{editorLoading || !draft ? (
							<div className="password-vault-loading">
								<RefreshCw size={18} /> {t("pwVaultLoading")}
							</div>
						) : (
							<EntryEditor
								draft={draft}
								busy={busy}
								assets={visibleAssets}
								assetsById={assetsById}
								showPassword={showPassword}
								selectedAssetId={selectedAssetId}
								setDraft={setDraft}
								setShowPassword={setShowPassword}
								setSelectedAssetId={setSelectedAssetId}
								onGenerate={fillGeneratedPassword}
								onPasswordCopyError={(value) => {
									setManualCopy({ label: t("pwVaultPasswordField"), value });
									announce("pwVaultClipboardManual");
								}}
								t={t}
							/>
						)}
					</form>
				</Dialog>
			)}
			{historyEntry && (
				<Dialog
					title={t("pwVaultHistoryTitle")}
					onClose={() => {
						setHistoryEntry(null);
						setHistoryRows([]);
					}}
				>
					<div className="password-vault-history">
						<p className="password-vault-dialog-hint">{historyEntry.title}</p>
						{historyRows.length ? (
							historyRows.map((row, index) => (
								<div className="password-vault-history-row" key={row.at}>
									<div>
										<strong>
											{t("pwVaultHistoryVersion", {
												count: index + 1,
											})}
										</strong>
										<small>
											{t("pwVaultVersionDate", {
												date: formatDate(row.at, i18n.language),
											})}
										</small>
										<span>
											{[
												row.draft.username,
												...(row.draft.usernameAliases ?? []),
											]
												.filter(Boolean)
												.join(" · ") || t("pwVaultNoLinkedAssets")}
										</span>
										{historyReveal === index && (
											<code>{row.draft.password}</code>
										)}
									</div>
									<div className="actions">
										<Button
											size="small"
											type="button"
											onClick={() =>
												setHistoryReveal(historyReveal === index ? null : index)
											}
										>
											{historyReveal === index ? (
												<EyeOff size={14} />
											) : (
												<Eye size={14} />
											)}{" "}
											{historyReveal === index
												? t("pwVaultHidePasswordValue")
												: t("pwVaultRevealPassword")}
										</Button>
										<Button
											size="small"
											type="button"
											disabled={busy}
											onClick={() => void restoreHistory(index)}
										>
											<Undo2 size={14} /> {t("pwVaultHistoryRestore")}
										</Button>
									</div>
								</div>
							))
						) : (
							<p className="password-vault-muted">{t("pwVaultHistoryEmpty")}</p>
						)}
					</div>
				</Dialog>
			)}
			{importOpen && (
				<Dialog
					title={t("pwVaultImportTitle")}
					onClose={() => {
						if (!busy) {
							setImportOpen(false);
							setImportFile(null);
							setImportPassword("");
						}
					}}
				>
					<form
						className="password-vault-dialog-form"
						onSubmit={(event) => void importVault(event)}
					>
						<p className="password-vault-dialog-hint">
							{t("pwVaultImportHint")}
						</p>
						<div className="field">
							<label htmlFor="password-vault-import-file">
								{t("pwVaultImportFile")}
							</label>
							<input
								ref={fileInputRef}
								id="password-vault-import-file"
								type="file"
								accept=".kdbx,application/octet-stream"
								onChange={(event) =>
									setImportFile(event.target.files?.[0] ?? null)
								}
								disabled={busy}
								required
							/>
						</div>
						<div className="field">
							<label htmlFor="password-vault-import-password">
								{t("pwVaultImportPassword")}
							</label>
							<Input
								id="password-vault-import-password"
								type="password"
								value={importPassword}
								onChange={(event) => setImportPassword(event.target.value)}
								autoComplete="off"
								disabled={busy}
								required
							/>
						</div>
						<div className="actions">
							<Button
								type="button"
								disabled={busy}
								onClick={() => setImportOpen(false)}
							>
								{t("cancel")}
							</Button>
							<Button type="submit" variant="primary" disabled={busy}>
								<Upload size={15} /> {t("pwVaultImportNow")}
							</Button>
						</div>
					</form>
				</Dialog>
			)}
			{changeMasterOpen && (
				<Dialog
					title={t("pwVaultChangeMasterTitle")}
					onClose={() => {
						if (!busy) setChangeMasterOpen(false);
					}}
				>
					<form
						className="password-vault-dialog-form"
						onSubmit={(event) => void changeMasterPassword(event)}
					>
						<div className="field">
							<label htmlFor="password-vault-current-master">
								{t("pwVaultCurrentMaster")}
							</label>
							<Input
								id="password-vault-current-master"
								type="password"
								value={currentMaster}
								onChange={(event) => setCurrentMaster(event.target.value)}
								autoComplete="current-password"
								disabled={busy}
								required
							/>
						</div>
						<div className="field">
							<label htmlFor="password-vault-new-master">
								{t("pwVaultNewMaster")}
							</label>
							<Input
								id="password-vault-new-master"
								type="password"
								value={newMaster}
								onChange={(event) => setNewMaster(event.target.value)}
								autoComplete="new-password"
								disabled={busy}
								required
								minLength={MIN_MASTER_LENGTH}
								aria-describedby="password-vault-change-master-risk"
							/>
						</div>
						<div className="field">
							<label htmlFor="password-vault-new-master-confirm">
								{t("pwVaultNewMasterConfirm")}
							</label>
							<Input
								id="password-vault-new-master-confirm"
								type="password"
								value={newMasterConfirm}
								onChange={(event) => setNewMasterConfirm(event.target.value)}
								autoComplete="new-password"
								disabled={busy}
								required
								minLength={MIN_MASTER_LENGTH}
							/>
						</div>
						<p className="password-vault-dialog-hint">
							{t("pwVaultPasswordTooShort")}
						</p>
						<p className="notice" id="password-vault-change-master-risk" role="note">
							{t("pwVaultShortMasterRisk")}
						</p>
						<div className="actions">
							<Button
								type="button"
								disabled={busy}
								onClick={() => setChangeMasterOpen(false)}
							>
								{t("cancel")}
							</Button>
							<Button type="submit" variant="primary" disabled={busy}>
								{t("pwVaultChangeMasterNow")}
							</Button>
						</div>
					</form>
				</Dialog>
			)}
			{manualCopy && (manualCopy.privateValue === false || snapshot.status === "unlocked") && (
				<Dialog
					title={t("pwVaultManualCopyTitle")}
					onClose={() => setManualCopy(null)}
				>
					<div className="password-vault-manual-copy">
						<p className="password-vault-dialog-hint">
							{t("pwVaultManualCopyHint")}
						</p>
						<label htmlFor="password-vault-manual-copy-value">
							{manualCopy.label}
						</label>
						<Textarea
							id="password-vault-manual-copy-value"
							value={manualCopy.value}
							readOnly
							onFocus={(event) => event.currentTarget.select()}
						/>
					</div>
				</Dialog>
			)}
		</section>
	);
}
