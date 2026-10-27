import "../trash.css";
import { VaultAccountLinksDialog } from "./VaultAccountLinksDialog";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
	Network,
	Check,
	Download,
	Eye,
	EyeOff,
	KeyRound,
	Lock,
	Plus,
	RefreshCw,
	ShieldCheck,
	Trash2,
	Undo2,
	Upload,
	WandSparkles,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Asset } from "../../../../packages/domain/src";
import { MIN_MASTER_PASSWORD_LENGTH } from "../../../../packages/password-vault/src/policy";
import {
	type PasswordVaultEntryDraft,
	type PasswordVaultEntrySummary,
	usePasswordVault,
} from "./PasswordVaultProvider";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Select, SelectOption } from "./ui/select";
import { TaskCard } from "./ui/task-card";
import {
	PasswordVaultEntryCard,
	VaultIconButton,
} from "./PasswordVaultEntryCard";
import "../password-vault.css";
import { withFilledVaultIdentifiers } from "../vault-import-model";
import { PasswordSmartImportDialog } from "./PasswordSmartImportDialog";
import { VaultLoginIdentifiers } from "./VaultLoginIdentifiers";
import { VaultImportFieldActions } from "./VaultImportFieldActions";
import { deliverExportFile, hasFileDeliveryHandler, fileDeliveryMessage } from "../file-delivery";
import "../file-delivery-copy";

type PasswordVaultPanelProps = {
	assets: Asset[];
	notify?: (message: string) => void;
	focusAssetId?: string;
	embedded?: boolean;
};

type ManualCopy = { label: string; value: string };

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

function errorKey(error: unknown): string {
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
		case "vault-storage":
			return "pwVaultSaveFailed";
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
			return "pwVaultInvalidBackup";
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
	embedded = false,
}: PasswordVaultPanelProps) {
	const Heading = embedded ? "h2" : "h1";
	const { t, i18n } = useTranslation();
	const { snapshot, session, ensureReady, lock, notice, generatePassword } =
		usePasswordVault();
	const navigate = useNavigate();
	const hash = useRouterState({ select: (state) => state.location.hash });
	const copyGeneration = useRef(0);
	useEffect(
		() => () => {
			copyGeneration.current += 1;
		},
		[],
	);
	useEffect(() => {
		if (hash === "vault-trash")
			document
				.getElementById("vault-trash")
				?.scrollIntoView({ block: "start" });
	}, [hash]);
	useEffect(() => {
		if (snapshot.status !== "unlocked" || !hash.startsWith("password-")) return;
		const card = [
			...document.querySelectorAll<HTMLElement>(
				".password-vault-entry-list .password-vault-entry",
			),
		].find((node) => node.dataset.entryId === hash.slice(9));
		card?.scrollIntoView({ block: "center" });
		card?.focus({ preventScroll: true });
	}, [hash, snapshot.status]);
	const [readyError, setReadyError] = useState<string | null>(null);
	const [messageKey, setMessageKey] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [master, setMaster] = useState("");
	const [masterConfirm, setMasterConfirm] = useState("");
	const [search, setSearch] = useState("");
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
		if (snapshot.status === "unlocked") return;
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
		// Keep the ciphertext file input mounted while an OS picker locks the vault.
		// All plaintext is cleared; resuming still requires the master password.
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
		() => assets.filter((asset) => !asset.deleted),
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
			announce(errorKey(error));
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
			if (hasFileDeliveryHandler()) {
				announce("exportFileOpening");
				try {
					const result = await deliverExportFile({ name: t("pwVaultExportFilename"), mimeType: "application/octet-stream", bytes });
					announce(fileDeliveryMessage(result));
				} catch {
					announce("exportFileFailed");
				}
				return;
			}
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

	async function copyValue(labelKey: string, value: string) {
		if (session?.getSnapshot().status !== "unlocked") return;
		const request = ++copyGeneration.current;
		if (!value) {
			announce("pwVaultError");
			return;
		}
		try {
			if (!navigator.clipboard?.writeText) throw new Error("clipboard");
			await navigator.clipboard.writeText(value);
			if (
				request !== copyGeneration.current ||
				session?.getSnapshot().status !== "unlocked"
			)
				return;
			announce("pwVaultCopied");
		} catch {
			if (
				request !== copyGeneration.current ||
				session?.getSnapshot().status !== "unlocked"
			)
				return;
			setManualCopy({ label: t(labelKey), value });
			announce("pwVaultClipboardManual");
		}
	}

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

	const message = messageKey ? t(messageKey) : notice ? t(notice) : "";

	const vaultStatus = (
		<div className="password-vault-header-meta">
			<p>
				{snapshot.status === "unlocked"
					? t("pwVaultEntriesCount", { count: snapshot.entries.length })
					: t("pwVaultSubtitle")}
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
		<section className="password-vault-panel">
			{accountLinksOpen && snapshot.status === "unlocked" && (
				<VaultAccountLinksDialog
					onClose={() => setAccountLinksOpen(false)}
					onSaved={() => notify?.(t("pwConnectSaved"))}
				/>
			)}
			{smartImportOpen &&
				(snapshot.status === "unlocked" ||
					notice === "pwVaultLockedElsewhere") && (
					<PasswordSmartImportDialog
						onClose={() => setSmartImportOpen(false)}
						onLinkAccounts={() => setAccountLinksOpen(true)}
					/>
				)}
			<header
				className={`password-vault-header card-header${snapshot.status === "unlocked" ? " password-vault-header-inline" : ""}`}
			>
				<div>
					<Heading>{t("pwVaultTitle")}</Heading>
					{vaultStatus}
				</div>
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
			{snapshot.status === "locked" && !importOpen && (
				<LockedState
					busy={busy}
					master={master}
					showMaster={showMaster}
					setMaster={setMaster}
					setShowMaster={setShowMaster}
					onUnlock={unlockVault}
				/>
			)}
			{snapshot.status === "unlocked" && (
				<>
					<div className="password-vault-toolbar">
						<div className="password-vault-search field">
							<label
								className="password-vault-sr"
								htmlFor="password-vault-search-input"
							>
								{t("pwVaultSearch")}
							</label>
							<input
								id="password-vault-search-input"
								type="search"
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								placeholder={t("pwVaultSearch")}
								autoComplete="off"
							/>
						</div>
						<div className="actions">
							<VaultIconButton
								label={t("pwConnectTitle")}
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
							<Button
								size="small"
								variant="ghost"
								type="button"
								className="password-vault-trash-open"
								disabled={busy}
								onClick={() =>
									void navigate({
										to: "/assets/$kind",
										params: { kind: "vault" },
										hash: "vault-trash",
									})
								}
							>
								<Trash2 size={18} />
								{t("pwVaultTrashTitle")}
							</Button>
							<VaultIconButton
								label={t("pwVaultNewEntry")}
								className="password-vault-new"
								disabled={busy}
								onClick={openNewEditor}
							>
								<Plus size={18} />
							</VaultIconButton>
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

					<div className="password-vault-entries-section">
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
					</div>
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
												count: historyRows.length - index,
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
					{snapshot.status === "locked" && <>
						<p>{t("pwVaultImportUnlockToContinue")}</p>
						<LockedState busy={busy} master={master} showMaster={showMaster} setMaster={setMaster} setShowMaster={setShowMaster} onUnlock={unlockVault} />
						<Button type="button" disabled={busy} onClick={() => { setImportOpen(false); setImportFile(null); setImportPassword(""); }}>{t("cancel")}</Button>
					</>}
					<div hidden={snapshot.status === "locked"}>
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
							<input
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
								onClick={() => { setImportOpen(false); setImportFile(null); setImportPassword(""); }}
							>
								{t("cancel")}
							</Button>
							<Button type="submit" variant="primary" disabled={busy}>
								<Upload size={15} /> {t("pwVaultImportNow")}
							</Button>
						</div>
					</form>
					</div>
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
							<input
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
							<input
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
							<input
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
			{manualCopy && (
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
						<textarea
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

function EmptyState({
	busy,
	master,
	masterConfirm,
	showMaster,
	setMaster,
	setMasterConfirm,
	setShowMaster,
	onCreate,
	onImport,
}: {
	busy: boolean;
	master: string;
	masterConfirm: string;
	showMaster: boolean;
	setMaster: (value: string) => void;
	setMasterConfirm: (value: string) => void;
	setShowMaster: (value: boolean) => void;
	onCreate: (event: React.FormEvent<HTMLFormElement>) => void;
	onImport: () => void;
}) {
	const { t } = useTranslation();
	return (
		<div className="password-vault-empty-state">
			<div className="password-vault-empty-icon">
				<ShieldCheck size={28} />
			</div>
			<h3>{t("pwVaultEmptyTitle")}</h3>
			<p>{t("pwVaultEmptyHint")}</p>
			<form className="password-vault-master-form" onSubmit={onCreate}>
				<div className="field">
					<label htmlFor="password-vault-master">
						{t("pwVaultMasterPassword")}
					</label>
					<div className="password-vault-password-input">
						<input
							id="password-vault-master"
							type={showMaster ? "text" : "password"}
							value={master}
							onChange={(event) => setMaster(event.target.value)}
							autoComplete="new-password"
							disabled={busy}
							required
							minLength={MIN_MASTER_LENGTH}
							aria-describedby="password-vault-create-master-risk"
						/>
						<Button
							type="button"
							size="icon"
							variant="ghost"
							aria-label={t(
								showMaster ? "pwVaultHidePassword" : "pwVaultShowPassword",
							)}
							onClick={() => setShowMaster(!showMaster)}
							disabled={busy}
						>
							{showMaster ? <EyeOff size={17} /> : <Eye size={17} />}
						</Button>
					</div>
				</div>
				<div className="field">
					<label htmlFor="password-vault-master-confirm">
						{t("pwVaultMasterPasswordConfirm")}
					</label>
					<input
						id="password-vault-master-confirm"
						type="password"
						value={masterConfirm}
						onChange={(event) => setMasterConfirm(event.target.value)}
						autoComplete="new-password"
						disabled={busy}
						required
						minLength={MIN_MASTER_LENGTH}
					/>
				</div>
				<p className="notice" id="password-vault-create-master-risk" role="note">
					{t("pwVaultShortMasterRisk")}
				</p>
				<div className="actions">
					<Button type="submit" variant="primary" disabled={busy}>
						<ShieldCheck size={16} /> {t("pwVaultCreate")}
					</Button>
					<Button type="button" disabled={busy} onClick={onImport}>
						<Upload size={16} /> {t("pwVaultImportEmpty")}
					</Button>
				</div>
			</form>
		</div>
	);
}

function LockedState({
	busy,
	master,
	showMaster,
	setMaster,
	setShowMaster,
	onUnlock,
}: {
	busy: boolean;
	master: string;
	showMaster: boolean;
	setMaster: (value: string) => void;
	setShowMaster: (value: boolean) => void;
	onUnlock: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
	const { t } = useTranslation();
	return (
		<div className="password-vault-unlock">
			<div className="password-vault-empty-icon">
				<Lock size={26} />
			</div>
			<h3>{t("pwVaultLockedTitle")}</h3>
			<p>{t("pwVaultLockedHint")}</p>
			<form className="password-vault-master-form" onSubmit={onUnlock}>
				<div className="field">
					<label htmlFor="password-vault-unlock-master">
						{t("pwVaultMasterPassword")}
					</label>
					<div className="password-vault-password-input">
						<input
							id="password-vault-unlock-master"
							type={showMaster ? "text" : "password"}
							value={master}
							onChange={(event) => setMaster(event.target.value)}
							autoComplete="current-password"
							disabled={busy}
							required
						/>
						<Button
							type="button"
							size="icon"
							variant="ghost"
							aria-label={t(
								showMaster ? "pwVaultHidePassword" : "pwVaultShowPassword",
							)}
							onClick={() => setShowMaster(!showMaster)}
							disabled={busy}
						>
							{showMaster ? <EyeOff size={17} /> : <Eye size={17} />}
						</Button>
					</div>
				</div>
				<div className="actions">
					<Button type="submit" variant="primary" disabled={busy}>
						<Lock size={16} /> {t("pwVaultUnlock")}
					</Button>
				</div>
			</form>
			<p className="password-vault-security-note">
				<KeyRound size={15} /> {t("pwVaultForgotHint")}
			</p>
		</div>
	);
}

function EntryEditor({
	draft,
	busy,
	assets,
	assetsById,
	showPassword,
	selectedAssetId,
	setDraft,
	setShowPassword,
	setSelectedAssetId,
	onGenerate,
	onPasswordCopyError,
	t,
}: {
	draft: PasswordVaultEntryDraft;
	busy: boolean;
	assets: Asset[];
	assetsById: Map<string, Asset>;
	showPassword: boolean;
	selectedAssetId: string;
	setDraft: React.Dispatch<
		React.SetStateAction<PasswordVaultEntryDraft | null>
	>;
	setShowPassword: (value: boolean) => void;
	setSelectedAssetId: (value: string) => void;
	onGenerate: () => void;
	onPasswordCopyError: (value: string) => void;
	t: (key: string, options?: Record<string, unknown>) => string;
}) {
	const [urlExpanded, setUrlExpanded] = useState(Boolean(draft.url));
	const update = <K extends keyof PasswordVaultEntryDraft>(
		key: K,
		value: PasswordVaultEntryDraft[K],
	) =>
		setDraft((current) => (current ? { ...current, [key]: value } : current));
	const availableAssets = assets.filter(
		(asset) => !draft.linkedAssetIds.includes(asset.id),
	);
	return (
		<>
			<div className="password-vault-editor-grid">
				<div className="field">
					<label htmlFor="password-vault-entry-title">
						{t("pwVaultTitleField")}
					</label>
					<div className="pw-import-input-control">
						<input
							id="password-vault-entry-title"
							value={draft.title}
							onChange={(event) => update("title", event.target.value)}
							disabled={busy}
							required
							maxLength={160}
						/>
						<VaultImportFieldActions
							label={t("pwVaultTitleField")}
							value={draft.title}
							disabled={busy}
							onPaste={(value) => update("title", value)}
						/>
					</div>
				</div>
				<VaultLoginIdentifiers
					clipboardPaste
					idPrefix="password-vault-entry"
					values={draft.usernameAliases}
					disabled={busy}
					primary={{
						id: "password-vault-entry-username",
						value: draft.username,
						autoComplete: "username",
						maxLength: 300,
						onChange: (value) => update("username", value),
					}}
					onChange={(values) => update("usernameAliases", values)}
				/>
				<div className="field password-vault-password-field password-vault-secret-field">
					<label htmlFor="password-vault-entry-password">
						{t("pwVaultPasswordOptionalField")}
					</label>
					<div className="pw-import-input-control">
						<div className="password-vault-password-input">
							{/[\r\n]/.test(draft.password) ? (
								<textarea
									id="password-vault-entry-password"
									value={showPassword ? draft.password : "••••••••"}
									readOnly={!showPassword}
									onChange={(event) => update("password", event.target.value)}
									disabled={busy}
									autoComplete="off"
									spellCheck={false}
									rows={3}
								/>
							) : (
								<input
									id="password-vault-entry-password"
									type={showPassword ? "text" : "password"}
									value={draft.password}
									onChange={(event) => update("password", event.target.value)}
									disabled={busy}
									autoComplete="new-password"
									placeholder={t("pwVaultPasswordPlaceholder")}
								/>
							)}
							<Button
								type="button"
								size="icon"
								variant="ghost"
								aria-label={t(
									showPassword ? "pwVaultHidePassword" : "pwVaultShowPassword",
								)}
								onClick={() => setShowPassword(!showPassword)}
								disabled={busy}
							>
								{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
							</Button>
							<Button
								type="button"
								size="icon"
								variant="ghost"
								aria-label={t("pwVaultGeneratePassword")}
								onClick={onGenerate}
								disabled={busy}
							>
								<WandSparkles size={17} />
							</Button>
						</div>
						<VaultImportFieldActions
							label={t("pwVaultPasswordField")}
							copyLabel={t("pwVaultCopyPassword")}
							onCopyError={onPasswordCopyError}
							value={draft.password}
							disabled={busy}
							onPaste={(value) => update("password", value)}
						/>
					</div>
				</div>
				<div className="password-vault-more-info password-vault-optional">
					<div className="password-vault-more-info-fields">
						<div className="field password-vault-notes-field">
							<div className="pw-smart-field-heading">
								<label htmlFor="password-vault-entry-notes">
									{t("pwVaultNotesOptionalField")}
								</label>
								{!urlExpanded && (
									<Button
										type="button"
										variant="ghost"
										size="small"
										className="pw-smart-add-url"
										onClick={() => setUrlExpanded(true)}
										disabled={busy}
									>
										{t("pwVaultAddUrl")}
									</Button>
								)}
							</div>
							<div className="pw-import-input-control">
								<textarea
									id="password-vault-entry-notes"
									value={draft.notes}
									onChange={(event) => update("notes", event.target.value)}
									disabled={busy}
									rows={4}
									maxLength={20000}
								/>
								<VaultImportFieldActions
									label={t("pwVaultNotesField")}
									value={draft.notes ?? ""}
									disabled={busy}
									onPaste={(value) => update("notes", value)}
								/>
							</div>
						</div>
						{urlExpanded && (
							<div className="field">
								<label htmlFor="password-vault-entry-url">
									{t("pwVaultUrlOptionalField")}
								</label>
								<div className="pw-import-input-control">
									<input
										id="password-vault-entry-url"
										type="url"
										value={draft.url}
										onChange={(event) => update("url", event.target.value)}
										disabled={busy}
										inputMode="url"
										autoComplete="url"
										placeholder="https://"
									/>
									<VaultImportFieldActions
										label={t("pwVaultUrlField")}
										value={draft.url ?? ""}
										disabled={busy}
										onPaste={(value) => update("url", value)}
									/>
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
			<div className="field password-vault-linked-picker">
				<label htmlFor="password-vault-entry-asset">
					{t("pwVaultLinkedAssets")}
				</label>
				<small>{t("pwVaultLinkedAssetsHint")}</small>
				<Select
					id="password-vault-entry-asset"
					value={selectedAssetId}
					onValueChange={(value) => {
						setSelectedAssetId("");
						if (value)
							update("linkedAssetIds", [...draft.linkedAssetIds, value]);
					}}
					disabled={busy}
				>
					<SelectOption value="">{t("pwVaultChooseAsset")}</SelectOption>
					{availableAssets.map((asset) => (
						<SelectOption key={asset.id} value={asset.id}>
							{asset.name} · {t(asset.kind)}
						</SelectOption>
					))}
				</Select>
				{draft.linkedAssetIds.length > 0 && (
					<div className="password-vault-linked-picker-list">
						{draft.linkedAssetIds.map((id) => (
							<span className="password-vault-linked-chip" key={id}>
								{assetsById.get(id)?.name ?? t("pwVaultAssetUnavailable")}
								<Button
									type="button"
									size="icon"
									variant="ghost"
									aria-label={t("pwVaultRemoveAsset", {
										name:
											assetsById.get(id)?.name ?? t("pwVaultAssetUnavailable"),
									})}
									onClick={() =>
										update(
											"linkedAssetIds",
											draft.linkedAssetIds.filter((assetId) => assetId !== id),
										)
									}
									disabled={busy}
								>
									<X size={13} />
								</Button>
							</span>
						))}
					</div>
				)}
			</div>
			<div className="actions password-vault-editor-actions">
				<Button type="submit" variant="primary" disabled={busy}>
					<Check size={16} /> {t("pwVaultSaveEntry")}
				</Button>
			</div>
		</>
	);
}
