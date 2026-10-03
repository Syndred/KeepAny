import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	type AiConnection,
	type AiProviderId,
	generateAiText,
	providerPresets,
} from "../../../../packages/ai/src";
import {
	type AiConfigurationInput,
	type AiKeySource,
	AiSettingsError,
	aiProviderIds,
	normalizeAiSettings,
	useAiConnection,
} from "../ai-settings-store";
import {
	type PasswordVaultEntryDraft,
	usePasswordVault,
} from "./PasswordVaultProvider";
import { Button } from "./ui/button";
import { Select, SelectOption } from "./ui/select";
import { TextLink } from "./ui/text-link";
import "./AiSettingsPanel.css";

const providerCopy: Record<AiProviderId, string> = {
	openai: "aiProviderOpenai",
	anthropic: "aiProviderAnthropic",
	google: "aiProviderGoogle",
	deepseek: "aiProviderDeepseek",
	qwen: "aiProviderQwen",
	doubao: "aiProviderDoubao",
	moonshot: "aiProviderMoonshot",
	minimax: "aiProviderMinimax",
	openrouter: "aiProviderOpenrouter",
	ollama: "aiProviderOllama",
	compatible: "aiProviderCompatible",
};

export function createDefaultAiConfiguration(
	provider: AiProviderId = "deepseek",
	defaultKeySource: AiKeySource = "session",
): AiConfigurationInput {
	const preset = providerPresets[provider];
	return {
		provider,
		baseURL: preset.baseURL,
		model: preset.model,
		keySource: provider === "ollama" ? "none" : defaultKeySource,
		...(defaultKeySource === "vault" && provider !== "ollama"
			? { autoActivate: true }
			: {}),
		apiKey: "",
	};
}

/** The same provider, URL, model and temporary-key fields can be reused in the AI dialog. */
export function AiConnectionFields({
	value,
	onChange,
	disabled = false,
	idPrefix = "ai-connection",
	showApiKey = true,
	hasSessionKey = false,
	defaultKeySource = "session",
}: {
	value: AiConfigurationInput;
	onChange(value: AiConfigurationInput): void;
	disabled?: boolean;
	idPrefix?: string;
	showApiKey?: boolean;
	hasSessionKey?: boolean;
	defaultKeySource?: AiKeySource;
}) {
	const { t } = useTranslation();
	return (
		<>
			<div className="field">
				<label htmlFor={`${idPrefix}-provider`}>
					{t("aiSettingsProvider")}
				</label>
				<Select
					id={`${idPrefix}-provider`}
					value={value.provider}
					disabled={disabled}
					onValueChange={(next) =>
						onChange(
							createDefaultAiConfiguration(
								next as AiProviderId,
								defaultKeySource,
							),
						)
					}
				>
					{aiProviderIds.map((provider) => (
						<SelectOption key={provider} value={provider}>
							{t(providerCopy[provider])}
						</SelectOption>
					))}
				</Select>
			</div>
			<div className="field">
				<label htmlFor={`${idPrefix}-model`}>{t("aiSettingsModel")}</label>
				<input
					id={`${idPrefix}-model`}
					value={value.model}
					disabled={disabled}
					maxLength={200}
					onChange={(event) =>
						onChange({ ...value, model: event.target.value })
					}
					aria-describedby={`${idPrefix}-model-hint`}
				/>
				<small id={`${idPrefix}-model-hint`}>{t("aiSettingsModelHint")}</small>
			</div>
			<div className="field wide">
				<label htmlFor={`${idPrefix}-url`}>{t("aiSettingsBaseUrl")}</label>
				<input
					id={`${idPrefix}-url`}
					type="url"
					value={value.baseURL}
					disabled={disabled}
					maxLength={2048}
					autoComplete="off"
					spellCheck={false}
					onChange={(event) =>
						onChange({
							...value,
							baseURL: event.target.value,
							apiKey: "",
							...(value.keySource === "vault" ? { vaultEntryId: "" } : {}),
						})
					}
					aria-describedby={`${idPrefix}-url-hint`}
				/>
				<small id={`${idPrefix}-url-hint`}>{t("aiSettingsBaseUrlHint")}</small>
			</div>
			{showApiKey && value.keySource === "session" && (
				<div className="field wide">
					<label htmlFor={`${idPrefix}-key`}>{t("aiSettingsApiKey")}</label>
					<input
						id={`${idPrefix}-key`}
						type="password"
						value={value.apiKey ?? ""}
						disabled={disabled}
						autoComplete="off"
						maxLength={4096}
						spellCheck={false}
						placeholder={t(
							hasSessionKey
								? "aiSettingsKeepSessionKey"
								: "aiSettingsApiKeyPlaceholder",
						)}
						onChange={(event) =>
							onChange({ ...value, apiKey: event.target.value })
						}
						aria-describedby={`${idPrefix}-key-hint`}
					/>
					<small id={`${idPrefix}-key-hint`}>
						{t("aiSettingsSessionHint")}
					</small>
				</div>
			)}
		</>
	);
}

export function AiSettingsPanel() {
	const { t } = useTranslation();
	const ai = useAiConnection();
	const vault = usePasswordVault();
	const [draft, setDraft] = useState<AiConfigurationInput>(() =>
		ai.settings
			? { ...ai.settings, apiKey: "" }
			: createDefaultAiConfiguration("deepseek", "vault"),
	);
	const [master, setMaster] = useState("");
	const [message, setMessage] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [vaultBusy, setVaultBusy] = useState(false);
	const [saving, setSaving] = useState(false);
	const [testResult, setTestResult] = useState<{
		model: string;
		inputTokens: number | null;
		outputTokens: number | null;
	} | null>(null);
	const controller = useRef<AbortController | null>(null);
	const generation = useRef(0);
	const mounted = useRef(true);
	const draftRef = useRef(draft);
	const settingsRef = useRef(ai.settings);
	const savingRef = useRef(false);
	const saveGeneration = useRef(0);
	draftRef.current = draft;
	settingsRef.current = ai.settings;
	const invalidateTest = useCallback(() => {
		generation.current += 1;
		controller.current?.abort();
		controller.current = null;
		setBusy(false);
		setTestResult(null);
	}, []);
	useEffect(() => {
		saveGeneration.current += 1;
		if (ai.settings) setDraft({ ...ai.settings, apiKey: "" });
		else setDraft(createDefaultAiConfiguration("deepseek", "vault"));
	}, [ai.settings]);
	useEffect(() => {
		void ai.revision;
		invalidateTest();
	}, [ai.revision, invalidateTest]);
	useEffect(
		() => vault.session?.subscribe(invalidateTest),
		[vault.session, invalidateTest],
	);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			saveGeneration.current += 1;
			generation.current += 1;
			controller.current?.abort();
		};
	}, []);
	const changeDraft = (next: AiConfigurationInput) => {
		if (savingRef.current) return;
		saveGeneration.current += 1;
		invalidateTest();
		setDraft(next);
		setMaster("");
		setMessage("");
		setError("");
	};
	const sameSessionTarget =
		ai.settings?.keySource === "session" &&
		ai.settings.provider === draft.provider &&
		ai.settings.baseURL === draft.baseURL.trim().replace(/\/$/, "");
	const hasSessionKey = !!(sameSessionTarget && ai.connection?.apiKey);
	const reportError = (caught: unknown, fallback = "aiSettingsInvalid") => {
		setError(caught instanceof AiSettingsError ? caught.code : fallback);
	};
	const save = async () => {
		if (savingRef.current || vaultBusy) return;
		invalidateTest();
		setMessage("");
		setError("");
		savingRef.current = true;
		setSaving(true);
		const current = ++saveGeneration.current;
		const savedSettings = ai.settings;
		const input = draft;
		const session = vault.session;
		let savedEntryId: string | undefined;
		const isCurrent = () =>
			mounted.current &&
			saveGeneration.current === current &&
			settingsRef.current === savedSettings;
		try {
			// A new key has no entry reference until the encrypted write completes.
			// Validate its destination before saving anything to the vault.
			const target = normalizeAiSettings({
				...input,
				keySource: input.keySource === "vault" ? "session" : input.keySource,
			});
			if (input.keySource === "vault") {
				if (session?.getSnapshot().status !== "unlocked")
					throw new AiSettingsError("aiSettingsVaultLocked");
				const apiKey = input.apiKey?.trim() ?? "";
				if (apiKey.length > 4096)
					throw new AiSettingsError("aiSettingsInvalid");
				let entry: PasswordVaultEntryDraft;
				if (input.vaultEntryId) {
					try {
						entry = session.readEntry(input.vaultEntryId);
					} catch {
						throw new AiSettingsError("aiSettingsVaultReadFailed");
					}
				} else {
					if (!apiKey) throw new AiSettingsError("aiSettingsKeyRequired");
					entry = {
						title: `${t(providerCopy[target.provider])} API Key`,
						username: "",
						password: apiKey,
						url: target.baseURL,
						notes: "",
						linkedAssetIds: [],
					};
				}
				if (!(apiKey || entry.password.trim()))
					throw new AiSettingsError("aiSettingsKeyRequired");
				if ((apiKey || entry.password.trim()).length > 4096)
					throw new AiSettingsError("aiSettingsInvalid");
				const binding = {
					version: 1 as const,
					provider: target.provider,
					baseURL: target.baseURL,
				};
				const needsBinding =
					input.autoActivate === true &&
					(entry.aiKeyBinding?.version !== binding.version ||
						entry.aiKeyBinding.provider !== binding.provider ||
						entry.aiKeyBinding.baseURL !== binding.baseURL);
				if (!input.vaultEntryId || apiKey || needsBinding) {
					savedEntryId = await session.saveEntry({
						...entry,
						password: apiKey || entry.password,
						...(input.autoActivate === true ? { aiKeyBinding: binding } : {}),
					});
				} else savedEntryId = input.vaultEntryId;
				if (isCurrent())
					setDraft({ ...input, vaultEntryId: savedEntryId, apiKey: "" });
				if (!isCurrent() || session.getSnapshot().status !== "unlocked") {
					if (mounted.current) setMessage("aiSettingsVaultSavedNotActivated");
					return;
				}
			}
			ai.saveConfiguration({
				...input,
				...(savedEntryId ? { vaultEntryId: savedEntryId } : {}),
				apiKey:
					input.keySource === "session" &&
					!input.apiKey?.trim() &&
					hasSessionKey
						? undefined
						: input.apiKey,
			});
			setDraft({
				...input,
				...(savedEntryId ? { vaultEntryId: savedEntryId } : {}),
				apiKey: "",
			});
			setMessage(
				input.keySource === "vault"
					? "aiSettingsVaultSaved"
					: input.keySource === "session"
						? "aiSettingsSessionSaved"
						: "aiSettingsSaved",
			);
		} catch (caught) {
			if (!mounted.current) return;
			if (savedEntryId && isCurrent()) {
				// A metadata-only retry reuses the entry already saved to KDBX.
				setDraft({ ...input, vaultEntryId: savedEntryId, apiKey: "" });
				setError("aiSettingsVaultConfigSaveFailed");
			} else if (isCurrent()) reportError(caught, "aiSettingsVaultSaveFailed");
		} finally {
			savingRef.current = false;
			if (mounted.current) setSaving(false);
		}
	};
	const clear = () => {
		invalidateTest();
		setMessage("");
		setError("");
		try {
			ai.clearConfiguration();
			setDraft(createDefaultAiConfiguration("deepseek", "vault"));
			setMaster("");
			setMessage("aiSettingsCleared");
		} catch (caught) {
			reportError(caught);
		}
	};
	const activate = () => {
		invalidateTest();
		setMessage("");
		setError("");
		try {
			ai.activateVaultKey();
			setMessage("aiSettingsVaultActivated");
		} catch (caught) {
			reportError(caught);
		}
	};
	const openVault = async () => {
		setVaultBusy(true);
		setError("");
		try {
			await vault.ensureReady();
		} catch {
			if (mounted.current) setError("aiSettingsVaultReadFailed");
		} finally {
			if (mounted.current) setVaultBusy(false);
		}
	};
	const unlockVault = async () => {
		if (!vault.session || !master || vaultBusy) return;
		setVaultBusy(true);
		setError("");
		const password = master;
		setMaster("");
		try {
			await vault.session.unlock(password);
		} catch {
			if (mounted.current) setError("aiSettingsVaultUnlockFailed");
		} finally {
			if (mounted.current) setVaultBusy(false);
		}
	};
	const runTest = async () => {
		if (controller.current) return;
		invalidateTest();
		setMessage("");
		setError("");
		const current = generation.current;
		const request = new AbortController();
		controller.current = request;
		setBusy(true);
		try {
			const settings = normalizeAiSettings({
				...draft,
				keySource: draft.keySource === "vault" ? "session" : draft.keySource,
			});
			let apiKey = draft.apiKey?.trim() ?? "";
			if (draft.keySource === "session" && !apiKey && hasSessionKey)
				apiKey = ai.connection?.apiKey ?? "";
			if (draft.keySource === "vault" && !apiKey) {
				if (vault.snapshot.status !== "unlocked" || !vault.session)
					throw new AiSettingsError("aiSettingsVaultLocked");
				if (
					!vault.snapshot.entries.some(
						(entry) => entry.id === draft.vaultEntryId,
					)
				)
					throw new AiSettingsError("aiSettingsVaultEntryRequired");
				try {
					apiKey = vault.session
						.readEntry(draft.vaultEntryId as string)
						.password.trim();
				} catch {
					throw new AiSettingsError("aiSettingsVaultReadFailed");
				}
			}
			if (settings.keySource !== "none" && !apiKey)
				throw new AiSettingsError("aiSettingsKeyRequired");
			if (apiKey.length > 4096) throw new AiSettingsError("aiSettingsInvalid");
			const connection: AiConnection = {
				provider: settings.provider,
				baseURL: settings.baseURL,
				model: settings.model,
				apiKey: settings.keySource === "none" ? "" : apiKey,
			};
			const answer = await generateAiText(connection, {
				system: "You are testing a model connection. Reply briefly.",
				prompt: "Reply only with OK, without an explanation.",
				maxOutputTokens: 256,
				signal: request.signal,
			});
			if (
				!mounted.current ||
				request.signal.aborted ||
				generation.current !== current ||
				draftRef.current !== draft
			)
				return;
			if (!answer.text.trim()) throw new Error();
			setTestResult({
				model: (answer.model || settings.model).slice(0, 120),
				...answer.usage,
			});
		} catch (caught) {
			if (
				mounted.current &&
				!request.signal.aborted &&
				generation.current === current
			)
				reportError(caught, "aiSettingsTestFailed");
		} finally {
			if (mounted.current && generation.current === current) {
				setBusy(false);
				controller.current = null;
			}
		}
	};
	let canUseWithoutKey =
		draft.provider === "ollama" || draft.provider === "compatible";
	try {
		canUseWithoutKey ||= ["localhost", "127.0.0.1", "[::1]"].includes(
			new URL(draft.baseURL).hostname,
		);
	} catch {
		/* URL validation is shown when saved or tested. */
	}
	const selectedVaultSaved =
		ai.settings?.keySource === "vault" &&
		draft.keySource === "vault" &&
		ai.settings.vaultEntryId === draft.vaultEntryId &&
		ai.settings.provider === draft.provider &&
		ai.settings.baseURL === draft.baseURL &&
		ai.settings.model === draft.model;
	const connectionStatus = ai.connection
		? "aiSettingsReady"
		: !ai.configured
			? "aiSettingsNotConfigured"
			: ai.settings?.keySource === "vault" &&
					vault.snapshot.status !== "unlocked"
				? "aiSettingsVaultNeedsUnlock"
				: ai.settings?.keySource === "vault" &&
						!ai.settings.autoActivate &&
						vault.snapshot.entries.some(
							(entry) => entry.id === ai.settings?.vaultEntryId,
						)
					? "aiSettingsVaultNeedsActivation"
					: "aiSettingsNeedsKey";
	return (
		<section
			className="card padded ai-settings-panel"
			aria-labelledby="ai-settings-title"
		>
			<h2 id="ai-settings-title">{t("aiSettingsTitle")}</h2>
			<p>{t("aiSettingsHint")}</p>
			<p className="notice" role="status">
				{t(connectionStatus)}
			</p>
			<div className="form-grid">
				<AiConnectionFields
					value={draft}
					onChange={changeDraft}
					showApiKey={false}
					hasSessionKey={hasSessionKey}
					idPrefix="ai-settings"
					defaultKeySource="vault"
					disabled={saving || vaultBusy}
				/>
				<div className="field wide">
					<label htmlFor="ai-settings-key-source">
						{t("aiSettingsKeySource")}
					</label>
					<Select
						id="ai-settings-key-source"
						value={draft.keySource}
						disabled={saving || vaultBusy}
						onValueChange={(source) =>
							changeDraft({
								...draft,
								keySource: source as AiConfigurationInput["keySource"],
								apiKey:
									source === "none"
										? ""
										: draft.apiKey ||
											(source === "vault" && hasSessionKey
												? ai.connection?.apiKey
												: ""),
								vaultEntryId: "",
								...(source === "vault" ? { autoActivate: true } : {}),
							})
						}
					>
						<SelectOption value="vault">{t("aiSettingsKeyVault")}</SelectOption>
						<SelectOption value="session">
							{t("aiSettingsKeySession")}
						</SelectOption>
						{(canUseWithoutKey || draft.keySource === "none") && (
							<SelectOption value="none" disabled={!canUseWithoutKey}>
								{t("aiSettingsKeyNone")}
							</SelectOption>
						)}
					</Select>
				</div>
				{draft.keySource === "session" && (
					<div className="field wide">
						<label htmlFor="ai-settings-api-key">{t("aiSettingsApiKey")}</label>
						<input
							id="ai-settings-api-key"
							type="password"
							autoComplete="off"
							spellCheck={false}
							maxLength={4096}
							value={draft.apiKey ?? ""}
							disabled={saving || vaultBusy}
							placeholder={t(
								hasSessionKey
									? "aiSettingsKeepSessionKey"
									: "aiSettingsApiKeyPlaceholder",
							)}
							onChange={(event) =>
								changeDraft({ ...draft, apiKey: event.target.value })
							}
							aria-describedby="ai-settings-session-hint"
						/>
						<small id="ai-settings-session-hint">
							{t("aiSettingsSessionHint")}
						</small>
					</div>
				)}
				{draft.keySource === "vault" && (
					<div className="field wide ai-settings-vault">
						<p>{t("aiSettingsVaultHint")}</p>
						<label htmlFor="ai-settings-api-key">{t("aiSettingsApiKey")}</label>
						<input
							id="ai-settings-api-key"
							type="password"
							autoComplete="off"
							spellCheck={false}
							maxLength={4096}
							value={draft.apiKey ?? ""}
							disabled={saving || vaultBusy}
							placeholder={t(
								draft.vaultEntryId
									? "aiSettingsKeepVaultKey"
									: "aiSettingsApiKeyPlaceholder",
							)}
							onChange={(event) =>
								changeDraft({ ...draft, apiKey: event.target.value })
							}
							aria-describedby="ai-settings-vault-key-hint"
						/>
						<small id="ai-settings-vault-key-hint">
							{t(
								draft.vaultEntryId
									? "aiSettingsVaultReplacementHint"
									: "aiSettingsVaultNewKeyHint",
							)}
						</small>
						<label className="ai-settings-auto-activate">
							<input
								id="ai-settings-auto-activate"
								type="checkbox"
								checked={draft.autoActivate === true}
								disabled={saving || vaultBusy}
								onChange={(event) =>
									changeDraft({ ...draft, autoActivate: event.target.checked })
								}
							/>
							{t("aiSettingsAutoActivate")}
						</label>
						<small>
							{t(
								draft.autoActivate === true
									? "aiSettingsAutoActivateHint"
									: "aiSettingsManualActivateHint",
							)}
						</small>
						{vault.snapshot.status === "loading" && (
							<Button
								disabled={vaultBusy || saving}
								onClick={() => void openVault()}
							>
								{t("aiSettingsOpenVault")}
							</Button>
						)}
						{vault.snapshot.status === "empty" && (
							<>
								<p>{t("aiSettingsVaultEmpty")}</p>
								<TextLink asChild>
									<Link to="/assets/$kind" params={{ kind: "vault" }}>
										{t("aiSettingsCreateVault")}
									</Link>
								</TextLink>
							</>
						)}
						{vault.snapshot.status === "locked" && (
							<div className="ai-settings-unlock">
								<label htmlFor="ai-settings-master">
									{t("pwVaultMasterPassword")}
								</label>
								<input
									id="ai-settings-master"
									type="password"
									autoComplete="off"
									value={master}
									disabled={vaultBusy || saving}
									onChange={(event) => setMaster(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											void unlockVault();
										}
									}}
								/>
								<Button
									disabled={vaultBusy || saving || !master}
									onClick={() => void unlockVault()}
								>
									{t("aiSettingsUnlockVault")}
								</Button>
							</div>
						)}
						{vault.snapshot.status === "unlocked" && (
							<>
								<label htmlFor="ai-settings-vault-entry">
									{t("aiSettingsVaultEntry")}
								</label>
								<Select
									id="ai-settings-vault-entry"
									value={draft.vaultEntryId ?? ""}
									disabled={saving || vaultBusy}
									onValueChange={(entryId) =>
										changeDraft({ ...draft, vaultEntryId: entryId, apiKey: "" })
									}
								>
									<SelectOption value="">
										{t("aiSettingsChooseVaultEntry")}
									</SelectOption>
									{draft.vaultEntryId &&
										!vault.snapshot.entries.some(
											(entry) => entry.id === draft.vaultEntryId,
										) && (
											<SelectOption value={draft.vaultEntryId} disabled>
												{t("aiSettingsMissingVaultEntry")}
											</SelectOption>
										)}
									{vault.snapshot.entries.map((entry) => (
										<SelectOption key={entry.id} value={entry.id}>
											{entry.title}
										</SelectOption>
									))}
								</Select>
								<small>{t("aiSettingsVaultReady")}</small>
								{selectedVaultSaved && !ai.connection && (
									<Button
										disabled={saving || !draft.vaultEntryId}
										onClick={activate}
									>
										{t("aiSettingsActivateVaultKey")}
									</Button>
								)}
							</>
						)}
					</div>
				)}
			</div>
			<div className="actions">
				<Button
					variant="primary"
					disabled={
						saving ||
						vaultBusy ||
						(draft.keySource === "vault" &&
							vault.snapshot.status !== "unlocked")
					}
					onClick={() => void save()}
				>
					{t(saving ? "aiSettingsSaving" : "aiSettingsSave")}
				</Button>
				<Button
					disabled={busy || vaultBusy || saving}
					onClick={() => void runTest()}
				>
					{t(busy ? "aiSettingsTesting" : "aiSettingsTest")}
				</Button>
				{ai.configured && (
					<Button
						variant="danger"
						disabled={vaultBusy || saving}
						onClick={clear}
					>
						{t("aiSettingsClear")}
					</Button>
				)}
			</div>
			<small className="ai-settings-test-hint">{t("aiSettingsTestHint")}</small>
			{testResult && (
				<div className="notice" role="status">
					<p>{t("aiSettingsTestPassed", { model: testResult.model })}</p>
					<small>
						{t("aiSettingsTestUsage", {
							input: testResult.inputTokens ?? t("aiSettingsUsageUnknown"),
							output: testResult.outputTokens ?? t("aiSettingsUsageUnknown"),
						})}
					</small>
				</div>
			)}
			{message && (
				<p className="notice" role="status">
					{t(message)}
				</p>
			)}
			{error && (
				<p className="notice danger" role="alert">
					{t(error)}
				</p>
			)}
		</section>
	);
}
