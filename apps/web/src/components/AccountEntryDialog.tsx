import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ZodError } from "zod";
import { newAsset, type Asset } from "../../../../packages/domain/src";
import { MIN_MASTER_PASSWORD_LENGTH } from "../../../../packages/password-vault/src/policy";
import {
	saveAccountEntry,
	type AccountEntryProgress,
} from "../account-entry-save";
import { AccountLinkConflict } from "../vault-account-links";
import { builtins, useAppContext } from "../view-shared";
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

export function AccountEntryDialog({ onClose }: { onClose: () => void }) {
	const { t } = useTranslation();
	const { data, notify } = useAppContext();
	const { snapshot, session, generatePassword } = usePasswordVault();
	const [profile, setProfile] = useState<Asset>(() => ({
		...newAsset("account"),
		category: "other",
	}));
	const [draft, setDraft] = useState<PasswordVaultEntryDraft | null>(() => ({
		title: "",
		username: "",
		usernameAliases: [],
		password: "",
		notes: "",
		url: "",
		linkedAssetIds: [],
	}));
	const [tags, setTags] = useState("");
	const [busy, setBusy] = useState(false);
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
		if (!running.current) onClose();
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
					failure instanceof Error && failure.message === "vault-password"
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
		if (running.current || !draft || snapshot.status === "loading") return;
		running.current = true;
		setBusy(true);
		inputError.current = false;
		setError("");
		try {
			await saveAccountEntry({
				profile: {
					...profile,
					tags: tags
						.split(",")
						.map((tag) => tag.trim())
						.filter(Boolean),
				},
				draft,
				session,
				progress: progress.current,
				label: (kind, identifierKind) =>
					t(`pwConnectKind_${identifierKind ?? kind}`),
			});
			onClose();
			notify(t("accountEntrySaved"));
		} catch (failure) {
			const reason = failure instanceof Error ? failure.message : "";
			inputError.current =
				!progress.current.account &&
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
					progress.current.account
						? "accountEntryPartial"
						: failure instanceof AccountLinkConflict
							? "accountIdentityAmbiguous"
							: reason === "account-entry-url"
								? "pwVaultInvalidUrl"
								: reason === "vault-locked"
									? "pwVaultLockedError"
									: field && labels[field]
										? "accountEntryInvalidField"
										: "invalid",
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
				title={t("workspaceAddAccount")}
				className="account-entry-dialog"
				onClose={close}
				closeDisabled={busy}
			>
				<form
					className="password-vault-editor account-entry-form"
					onInput={clearInputError}
					onInvalidCapture={clearInputError}
					onSubmit={(event) => void submit(event)}
				>
					{draft && (
						<EntryEditor
							draft={draft}
							busy={busy || snapshot.status === "loading"}
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
							vaultUnlocked={unlocked}
							onCancel={close}
							error={error}
							titleCompanion={
								<Field name="account-entry-category" label={t("category")}>
									<Select
										id="account-entry-category"
										value={profile.category}
										disabled={busy}
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
									aria-label={t("pwVaultPasswordOptionalField")}
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
										disabled={busy}
									/>
									{snapshot.status === "empty" && (
										<Field
											name="account-entry-master-confirm"
											label={t("pwVaultMasterPasswordConfirm")}
											type="password"
											autoComplete="new-password"
											value={confirm}
											onChange={setConfirm}
											disabled={busy}
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
							afterFields={
								<details className="account-entry-profile">
									<summary>{t("accountEntryMore")}</summary>
									<div className="form-grid">
										<Field
											name="account-entry-provider"
											label={t("accountProvider")}
											value={profile.accountProvider}
											disabled={busy}
											onChange={(value) => set("accountProvider", value)}
										/>
										<Field
											name="account-entry-contact"
											label={t("contact")}
											value={profile.contact}
											disabled={busy}
											onChange={(value) => set("contact", value)}
										/>
										<Field
											name="account-entry-purpose"
											label={t("accountPurpose")}
										>
											<Textarea
												id="account-entry-purpose"
												rows={3}
												value={profile.description}
												disabled={busy}
												onChange={(event) =>
													set("description", event.target.value)
												}
											/>
										</Field>
										<Field
											name="account-entry-tags"
											label={t("tags")}
											value={tags}
											disabled={busy}
											onChange={setTags}
										/>
										<Field name="account-entry-status" label={t("status")}>
											<Select
												id="account-entry-status"
												value={profile.status}
												disabled={busy}
												onValueChange={(value) =>
													set("status", value as Asset["status"])
												}
											>
												{["active", "paused", "cancelled", "archived"].map(
													(value) => (
														<SelectOption key={value} value={value}>
															{t(value)}
														</SelectOption>
													),
												)}
											</Select>
										</Field>
										<Field
											name="account-entry-reviewed"
											label={t("accountProfileVerifiedAt")}
											type="date"
											value={profile.accountProfileVerifiedAt}
											disabled={busy}
											onChange={(value) =>
												set("accountProfileVerifiedAt", value)
											}
										/>
										<div className="field account-entry-public-notes">
											<label htmlFor="account-entry-notes">
												{t("accountEntryNotes")}
											</label>
											<Textarea
												id="account-entry-notes"
												rows={3}
												value={profile.notes}
												disabled={busy}
												onChange={(event) => set("notes", event.target.value)}
											/>
											<small>{t("accountEntryNotesHint")}</small>
										</div>
									</div>
								</details>
							}
						/>
					)}
				</form>
			</Dialog>
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
