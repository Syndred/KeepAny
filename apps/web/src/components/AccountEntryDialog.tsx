import { RefreshCw } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { AccountDefaultButton } from "./AccountPlatformSwitch";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ZodError } from "zod";
import { newAsset, type Asset } from "../../../../packages/domain/src";
import { MIN_MASTER_PASSWORD_LENGTH } from "../../../../packages/password-vault/src/policy";
import {
	saveAccountEntry,
	accountFromTemplate,
	type AccountTemplate,
	type AccountEntryProgress,
} from "../account-entry-save";
import { AccountLinkConflict } from "../vault-account-links";
import { builtins, useAppContext } from "../view-shared";
import { mergedAccountDraft, saveMergedAccount, type AccountEditProgress } from "../account-entry-edit";
import { Field } from "../workflow-field";
import { EntryEditor } from "./PasswordVaultEntryEditor";
import {
	usePasswordVault,
	type PasswordVaultEntryDraft,
} from "./PasswordVaultProvider";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Select, SelectOption } from "./ui/select";
import { Textarea } from "./ui/textarea";
import "../account-entry.css";

export function AccountEntryDialog({ onClose, asset, entryId, returnFocusTo, template, linking = false, initialName = "", platformAccount }: { onClose: () => void; asset?: Asset; entryId?: string; template?: AccountTemplate; linking?: boolean; initialName?: string; returnFocusTo?: () => HTMLElement | null; platformAccount?: { id: string; position: number; total: number; onNext: () => void } }) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { data, notify } = useAppContext();
	const { snapshot, session, generatePassword } = usePasswordVault();
	const editing = !template && Boolean(asset || entryId);
	const [fromTemplate] = useState(() => template ? accountFromTemplate(template) : null);
	const [originalEntry] = useState(() => entryId && session?.getSnapshot().status === "unlocked" ? session.readEntry(entryId) : null);
	const [baseProfile] = useState<Asset>(() => fromTemplate?.profile ?? asset ?? ({ ...newAsset("account"), category: "other", name: originalEntry?.title ?? initialName, username: originalEntry?.username ?? "", url: originalEntry?.url ?? "" }));
	const [profile, setProfile] = useState(baseProfile);
	const editProgress = useRef<AccountEditProgress>({ account: asset ?? null, accountChanged: false });
	const [draft, setDraft] = useState<PasswordVaultEntryDraft | null>(() => fromTemplate?.draft ?? { ...mergedAccountDraft(asset, originalEntry), ...(!asset && !originalEntry ? { title: initialName } : {}) });
	const [busy, setBusy] = useState(false);
 const [defaultBusy, setDefaultBusy] = useState(false), [confirmSwitch, setConfirmSwitch] = useState(false);
 const initialDraft = useRef(platformAccount ? JSON.stringify(draft) : "");
 const dirty = Boolean(platformAccount) && (JSON.stringify(profile) !== JSON.stringify(baseProfile) || JSON.stringify(draft) !== initialDraft.current);
	const running = useRef(false);
	const mounted = useRef(true);
	const generation = useRef(0);
	const progress = useRef<AccountEntryProgress>({
		account: null,
		needsVault: false,
	});
	const [error, setError] = useState("");
	const inputError = useRef(false);
	const clearInputError = () => {
		if (!inputError.current) return;
		inputError.current = false;
		setError("");
	};
	const [showPassword, setShowPassword] = useState(false);
	const [manualCopy, setManualCopy] = useState<string | null>(null);
	const [selectedAssetId, setSelectedAssetId] = useState("");
	const [master, setMaster] = useState("");
	const [confirm, setConfirm] = useState("");
	const wasUnlocked = useRef(snapshot.status === "unlocked");
	const unlocked = snapshot.status === "unlocked";
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			generation.current++;
		};
	}, []);
	useEffect(() => {
		if (!unlocked && wasUnlocked.current) {
            initialDraft.current = "";
			generation.current++;
			inputError.current = false;
			setDraft((value) =>
				value
					? {
							...value,
							password: "",
							notes: "",
							usernameAliases: [],
							linkedAssetIds: [],
						}
					: value,
			);
			setShowPassword(false);
			setManualCopy(null);
			setError(t("accountEntryLockedDraft"));
		}
		wasUnlocked.current = unlocked;
	}, [unlocked, t]);
	const assets = data.assets.filter(
		(asset) => !asset.deleted && asset.kind !== "vault",
	);
	const set = <K extends keyof Asset>(key: K, value: Asset[K]) =>
		setProfile((current) => ({ ...current, [key]: value }));
	const close = () => {
		if (!running.current && !defaultBusy) onClose();
	};
	async function access() {
		if (running.current || !session || snapshot.status === "loading") return;
		inputError.current = false;
		if (
			snapshot.status === "empty" &&
			master.length < MIN_MASTER_PASSWORD_LENGTH
		) {
			setError(t("pwVaultPasswordTooShort"));
			return;
		}
		if (snapshot.status === "empty" && master !== confirm) {
			setError(t("pwVaultPasswordMismatch"));
			return;
		}
		running.current = true;
		setBusy(true);
		setError("");
		try {
			if (snapshot.status === "empty") await session.create(master);
			else await session.unlock(master);
			setMaster("");
			setConfirm("");
		} catch (failure) {
			setError(
				t(
					failure instanceof Error && failure.message === "vault-memory" ? "pwVaultMemoryUnavailable"
                    : failure instanceof Error && failure.message === "vault-password"
						? "pwVaultUnlockFailed"
						: "pwVaultError",
				),
			);
		} finally {
			running.current = false;
			if (mounted.current) setBusy(false);
		}
	}
	async function generate() {
		const request = ++generation.current;
		try {
			const password = await generatePassword();
			if (
				mounted.current &&
				request === generation.current &&
				session?.getSnapshot().status === "unlocked"
			)
				setDraft((value) => (value ? { ...value, password } : value));
		} catch {
			if (mounted.current) {
				inputError.current = false;
				setError(t("pwVaultError"));
			}
		}
	}
	async function submit(event: React.FormEvent) {
		event.preventDefault();
		if (running.current || defaultBusy || !draft || snapshot.status === "loading") return;
		running.current = true;
		setBusy(true);
		inputError.current = false;
		setError("");
		try {
            if (editing) await saveMergedAccount({ original: asset, originalEntry, baseProfile, profile, draft, session, progress: editProgress.current, label: (kind, identifierKind) => t(`pwConnectKind_${identifierKind ?? kind}`) });
            else {
			await saveAccountEntry({
				profile,
				draft,
				session,
				progress: progress.current,
				label: (kind, identifierKind) =>
					t(`pwConnectKind_${identifierKind ?? kind}`),
			});
            }
			onClose();
			notify(t("accountEntrySaved"));
			if (!editing && progress.current.account) {
				void navigate({ to: "/assets/$kind/$id", params: { kind: "account", id: progress.current.account.id }, hash: "" });
			}
		} catch (failure) {
			const reason = failure instanceof Error ? failure.message : "";
			const partial = editing ? editProgress.current.accountChanged : Boolean(progress.current.account);
			inputError.current =
				!partial &&
				(failure instanceof ZodError || reason === "account-entry-url");
			const field =
				failure instanceof ZodError
					? String(failure.issues[0]?.path[0] ?? "")
					: "";
			const labels: Record<string, string> = {
				name: "pwVaultTitleField",
				username: "pwVaultUsernameField",
				category: "category",
				url: "url",
				accountProvider: "accountProvider",
				contact: "contact",
				description: "accountPurpose",
				tags: "tags",
				status: "status",
				accountProfileVerifiedAt: "accountProfileVerifiedAt",
				notes: "accountEntryNotes",
			};
			setError(
				t(
					reason === "vault-memory" ? partial ? "accountEntryPartialMemory" : "pwVaultMemoryUnavailable"
                    : ["vault-stale", "asset-stale"].includes(reason)
                        ? partial ? "accountEntryPartialStale" : "assetStale"
					: partial
						? "accountEntryPartial"
						: failure instanceof AccountLinkConflict
							? "accountIdentityAmbiguous"
							: reason === "account-entry-url"
								? "pwVaultInvalidUrl"
								: reason === "vault-locked"
									? "pwVaultLockedError"
									: field && labels[field]
										? "accountEntryInvalidField"
											: "pwVaultError",
					{ field: t(labels[field] ?? "invalid") },
				),
			);
		} finally {
			running.current = false;
			if (mounted.current) setBusy(false);
		}
	}
	return (
		<>
			<Dialog
				title={t(editing ? "accountEditUnified" : "workspaceAddAccount")}
                returnFocusTo={returnFocusTo}
				className="account-entry-dialog"
				onClose={close}
				closeDisabled={busy || defaultBusy}
                headerActions={platformAccount && editing ? <div className="actions account-entry-platform-actions">
                 <Button type="button" data-account-editor-switch aria-label={t("compactAccountNextAccount", {index:Math.max(1,platformAccount.position),total:Math.max(1,platformAccount.total)})} disabled={busy || defaultBusy || !unlocked || platformAccount.total < 2 || platformAccount.position < 1 || editProgress.current.accountChanged} onClick={() => { if (dirty) setConfirmSwitch(true); else platformAccount.onNext(); }}><RefreshCw size={17}/>{t("accountSwitchAction")}</Button>
                 <AccountDefaultButton assetId={platformAccount.id} disabled={busy || defaultBusy || platformAccount.position < 1 || editProgress.current.accountChanged} onBusyChange={value => { setDefaultBusy(value); if (value) setError(""); }} onError={() => setError(t("error"))}/>
                </div> : undefined}
			>
				<form
					className="password-vault-editor account-entry-form"
					onInput={clearInputError}
					onSubmit={(event) => void submit(event)}
				>
					{draft && (
						<EntryEditor
							draft={draft}
							busy={busy || defaultBusy || snapshot.status === "loading"}
							assets={assets}
							assetsById={new Map(assets.map((asset) => [asset.id, asset]))}
							showPassword={showPassword}
							selectedAssetId={selectedAssetId}
							setDraft={setDraft}
							setShowPassword={setShowPassword}
							setSelectedAssetId={setSelectedAssetId}
							onGenerate={() => void generate()}
							onPasswordCopyError={setManualCopy}
							t={t}
							unified
                            ownerAssetId={asset?.id}
							vaultUnlocked={unlocked}
                            showLinkedAssets={linking}
							onCancel={close}
							error={error}
							titleCompanion={entryId && !asset ? undefined :
								<Field name="account-entry-category" label={t("category")}>
									<Select
										id="account-entry-category"
										value={profile.category}
										disabled={busy || defaultBusy}
										onValueChange={(value) => set("category", value)}
									>
										{[
											...new Set([
												...builtins.account,
												...data.categories
													.filter(
														(category) =>
															category.kind === "account" && !category.deleted,
													)
													.map((category) => category.name),
											]),
										].map((value) => (
											<SelectOption key={value} value={value}>
												{t(value)}
											</SelectOption>
										))}
									</Select>
								</Field>
							}
							vaultAccess={
								<section
									className="account-entry-access"
									aria-label={t("pwVaultPasswordField")}
								>
									<p>{t("accountEntryUnlockHint")}</p>
									<Field
										name="account-entry-master"
										label={t("pwVaultMasterPassword")}
										type="password"
										autoComplete={
											snapshot.status === "empty"
												? "new-password"
												: "current-password"
										}
										value={master}
										onChange={setMaster}
										disabled={busy || defaultBusy}
									/>
									{snapshot.status === "empty" && (
										<Field
											name="account-entry-master-confirm"
											label={t("pwVaultMasterPasswordConfirm")}
											type="password"
											autoComplete="new-password"
											value={confirm}
											onChange={setConfirm}
											disabled={busy || defaultBusy}
										/>
									)}
									<Button
										type="button"
										disabled={
											busy ||
											!session ||
											snapshot.status === "loading" ||
											!master
										}
										onClick={() => void access()}
									>
										{t(
											snapshot.status === "empty"
												? "pwVaultCreate"
												: "pwVaultUnlock",
										)}
									</Button>
								</section>
							}

						/>
					)}
				</form>
			</Dialog>
            {unlocked && confirmSwitch && platformAccount && <Dialog title={t("accountEditorUnsavedTitle")} onClose={() => setConfirmSwitch(false)}>
             <p>{t("accountEditorUnsavedSwitch")}</p><div className="actions"><Button type="button" onClick={() => setConfirmSwitch(false)}>{t("accountEditorKeepEditing")}</Button><Button type="button" variant="danger" onClick={() => { setConfirmSwitch(false); platformAccount.onNext(); }}>{t("accountEditorDiscardSwitch")}</Button></div>
            </Dialog>}
			{unlocked && manualCopy !== null && (
				<Dialog
					title={t("pwVaultManualCopyTitle")}
					onClose={() => setManualCopy(null)}
				>
					<div className="password-vault-manual-copy">
						<p className="password-vault-dialog-hint">
							{t("pwVaultManualCopyHint")}
						</p>
						<label htmlFor="account-entry-manual-copy">
							{t("pwVaultPasswordField")}
						</label>
						<Textarea
							id="account-entry-manual-copy"
							value={manualCopy}
							readOnly
							onFocus={(event) => event.currentTarget.select()}
						/>
					</div>
				</Dialog>
			)}
		</>
	);
}
