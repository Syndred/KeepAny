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
	AiSettingsError,
	aiProviderIds,
	normalizeAiSettings,
	useAiConnection,
} from "../ai-settings-store";
import { usePasswordVault } from "./PasswordVaultProvider";
import { Button } from "./ui/button";
import { Select, SelectOption } from "./ui/select";
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
): AiConfigurationInput {
	const preset = providerPresets[provider];
	return {
		provider,
		baseURL: preset.baseURL,
		model: preset.model,
		keySource: provider === "ollama" ? "none" : "session",
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
}: {
	value: AiConfigurationInput;
	onChange(value: AiConfigurationInput): void;
	disabled?: boolean;
	idPrefix?: string;
	showApiKey?: boolean;
	hasSessionKey?: boolean;
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
						onChange(createDefaultAiConfiguration(next as AiProviderId))
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
			: createDefaultAiConfiguration(),
	);
	const [master, setMaster] = useState("");
	const [message, setMessage] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [vaultBusy, setVaultBusy] = useState(false);
	const [testResult, setTestResult] = useState<{
		model: string;
		inputTokens: number | null;
		outputTokens: number | null;
	} | null>(null);
	const controller = useRef<AbortController | null>(null);
	const generation = useRef(0);
	const mounted = useRef(true);
	const draftRef = useRef(draft);
	draftRef.current = draft;
	const invalidateTest = useCallback(() => {
		generation.current += 1;
		controller.current?.abort();
		controller.current = null;
		setBusy(false);
		setTestResult(null);
	}, []);
	useEffect(() => {
		if (ai.settings) setDraft({ ...ai.settings, apiKey: "" });
		else setDraft(createDefaultAiConfiguration());
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
			generation.current += 1;
			controller.current?.abort();
		};
	}, []);
	const changeDraft = (next: AiConfigurationInput) => {
		invalidateTest();
		setDraft(next);
		setMaster("");
		setMessage("");
		setError("");
	};
	const sameSessionTarget =
		ai.settings?.keySource === "session" &&
		draft.keySource === "session" &&
		ai.settings.provider === draft.provider &&
		ai.settings.baseURL === draft.baseURL.trim().replace(/\/$/, "");
	const hasSessionKey = !!(sameSessionTarget && ai.connection?.apiKey);
	const reportError = (caught: unknown, fallback = "aiSettingsInvalid") => {
		setError(caught instanceof AiSettingsError ? caught.code : fallback);
	};
	const save = () => {
		invalidateTest();
		setMessage("");
		setError("");
		try {
			ai.saveConfiguration({
				...draft,
				apiKey:
					draft.keySource === "session" &&
					!draft.apiKey?.trim() &&
					hasSessionKey
						? undefined
						: draft.apiKey,
			});
			setDraft((current) => ({ ...current, apiKey: "" }));
			setMessage("aiSettingsSaved");
		} catch (caught) {
			reportError(caught);
		}
	};
	const clear = () => {
		invalidateTest();
		setMessage("");
		setError("");
		try {
			ai.clearConfiguration();
			setDraft(createDefaultAiConfiguration());
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
			const settings = normalizeAiSettings(draft);
			let apiKey = draft.apiKey?.trim() ?? "";
			if (settings.keySource === "session" && !apiKey && hasSessionKey)
				apiKey = ai.connection?.apiKey ?? "";
			if (settings.keySource === "vault") {
				if (vault.snapshot.status !== "unlocked" || !vault.session)
					throw new AiSettingsError("aiSettingsVaultLocked");
				if (
					!vault.snapshot.entries.some(
						(entry) => entry.id === settings.vaultEntryId,
					)
				)
					throw new AiSettingsError("aiSettingsVaultEntryRequired");
				try {
					apiKey = vault.session
						.readEntry(settings.vaultEntryId as string)
						.password.trim();
				} catch {
					throw new AiSettingsError("aiSettingsVaultReadFailed");
				}
			}
			if (settings.keySource !== "none" && !apiKey)
				throw new AiSettingsError("aiSettingsKeyRequired");
			const connection: AiConnection = {
				provider: settings.provider,
				baseURL: settings.baseURL,
				model: settings.model,
				apiKey: settings.keySource === "none" ? "" : apiKey,
			};
			const answer = await generateAiText(connection, {
				system: "You are testing a model connection. Reply briefly.",
				prompt: "Reply with OK.",
				maxOutputTokens: 16,
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
			setTestResult({ model: answer.model.slice(0, 120), ...answer.usage });
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
	let canUseWithoutKey = draft.provider === "ollama";
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
	return (
		<section
			className="card padded ai-settings-panel"
			aria-labelledby="ai-settings-title"
		>
			<h2 id="ai-settings-title">{t("aiSettingsTitle")}</h2>
			<p>{t("aiSettingsHint")}</p>
			<p className="notice" role="status">
				{t(
					ai.connection
						? "aiSettingsReady"
						: ai.configured
							? "aiSettingsNeedsKey"
							: "aiSettingsNotConfigured",
				)}
			</p>
			<div className="form-grid">
				<AiConnectionFields
					value={draft}
					onChange={changeDraft}
					showApiKey={false}
					hasSessionKey={hasSessionKey}
					idPrefix="ai-settings"
				/>
				<div className="field wide">
					<label htmlFor="ai-settings-key-source">
						{t("aiSettingsKeySource")}
					</label>
					<Select
						id="ai-settings-key-source"
						value={draft.keySource}
						onValueChange={(source) =>
							changeDraft({
								...draft,
								keySource: source as AiConfigurationInput["keySource"],
								apiKey: "",
								vaultEntryId: "",
							})
						}
					>
						<SelectOption value="session">
							{t("aiSettingsKeySession")}
						</SelectOption>
						<SelectOption value="vault">{t("aiSettingsKeyVault")}</SelectOption>
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
						{vault.snapshot.status === "loading" && (
							<Button disabled={vaultBusy} onClick={() => void openVault()}>
								{t("aiSettingsOpenVault")}
							</Button>
						)}
						{vault.snapshot.status === "empty" && (
							<p>{t("aiSettingsVaultEmpty")}</p>
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
									disabled={vaultBusy}
									onChange={(event) => setMaster(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											void unlockVault();
										}
									}}
								/>
								<Button
									disabled={vaultBusy || !master}
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
									onValueChange={(entryId) =>
										changeDraft({ ...draft, vaultEntryId: entryId })
									}
								>
									<SelectOption value="" disabled>
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
									<Button disabled={!draft.vaultEntryId} onClick={activate}>
										{t("aiSettingsActivateVaultKey")}
									</Button>
								)}
							</>
						)}
					</div>
				)}
			</div>
			<div className="actions">
				<Button variant="primary" disabled={vaultBusy} onClick={save}>
					{t("aiSettingsSave")}
				</Button>
				<Button disabled={busy || vaultBusy} onClick={() => void runTest()}>
					{t(busy ? "aiSettingsTesting" : "aiSettingsTest")}
				</Button>
				{ai.configured && (
					<Button variant="danger" disabled={vaultBusy} onClick={clear}>
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
