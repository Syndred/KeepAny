import { Textarea } from "./ui/textarea";
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { generateAiText } from "../../../../packages/ai/src";
import { acquireAiConnection, useAiConnection } from "../ai-settings-store";
import { hasExplicitImportSecret } from "../ai-import-input";
import {
	aiImportSchema,
	buildAiCandidates,
	importSystem,
	parseAiJson,
} from "../ai-workflow-model";
import { stageReviewedCandidates } from "../intake-review-store";
import { Button } from "./ui/button";
import { FilePicker } from "./ui/file-picker";
import { TextLink } from "./ui/text-link";
import { usePasswordVault } from "./PasswordVaultProvider";

async function fingerprint(bytes: ArrayBuffer) {
	return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}
function imageData(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).split(",")[1]);
		reader.onerror = () => reject(Error("ai-input"));
		reader.readAsDataURL(file);
	});
}
export function AiImportPanel({ onStaged }: { onStaged: () => void }) {
	const { t } = useTranslation();
	const { connection, revision, settings } = useAiConnection();
	const vault = usePasswordVault();
	const [text, setText] = useState(""),
		[file, setFile] = useState<File | null>(null),
		[preview, setPreview] = useState("");
	const [busy, setBusy] = useState(false),
		[message, setMessage] = useState("");
	const generation = useRef(0),
		controller = useRef<AbortController | null>(null),
		running = useRef(false);
	const cancel = () => {
		generation.current++;
		controller.current?.abort();
		controller.current = null;
		running.current = false;
		setBusy(false);
		setMessage("");
	};
	useEffect(() => {
		void revision;
		generation.current++;
		controller.current?.abort();
		running.current = false;
		setBusy(false);
	}, [revision]);
	useEffect(
		() => () => {
			generation.current++;
			controller.current?.abort();
		},
		[],
	);
	useEffect(() => {
		if (!file?.type.startsWith("image/")) {
			setPreview("");
			return;
		}
		const url = URL.createObjectURL(file);
		setPreview(url);
		return () => URL.revokeObjectURL(url);
	}, [file]);
	async function generate() {
		if (running.current || !connection || (!file && !text.trim())) return;
		running.current = true;
		setBusy(true);
		setMessage("");
		const current = ++generation.current,
			abort = new AbortController();
		controller.current = abort;
		let lease: Awaited<ReturnType<typeof acquireAiConnection>> | undefined;
		try {
			if (text.length > 20000 || (file && file.size > 10 * 1024 * 1024))
				throw Error("ai-limit");
			lease = await acquireAiConnection(abort.signal);
			let sourceText = text,
				image: { data: string; mediaType: string } | undefined;
			let hash: string;
			if (file) {
				hash = await fingerprint(await file.arrayBuffer());
				if (file.name.toLowerCase().endsWith(".pdf"))
					sourceText = (await (await import("../intake-pdf")).readPdfText(file))
						.text;
				else if (
					["image/png", "image/jpeg", "image/webp"].includes(file.type)
				) {
					image = { data: await imageData(file), mediaType: file.type };
					sourceText = "";
				} else if (/\.(csv|txt)$/i.test(file.name))
					sourceText = await file.text();
				else throw Error("ai-input");
			} else
				hash = await fingerprint(
					new TextEncoder().encode(sourceText).buffer as ArrayBuffer,
				);
			if (sourceText.length > 20000 || (!sourceText.trim() && !image))
				throw Error("ai-limit");
			if (hasExplicitImportSecret(sourceText)) throw Error("ai-secret");
			if (current !== generation.current || !lease.isCurrent()) return;
			const response = await generateAiText(lease.connection, {
				system: importSystem,
				prompt:
					sourceText ||
					"Transcribe and extract the supplied image. Return the specified JSON.",
				image,
				signal: lease.signal,
				json: true,
				maxOutputTokens: 6000,
			});
			const output = aiImportSchema.parse(parseAiJson(response.text));
			const rows = buildAiCandidates(output, {
				hash,
				name: file?.name || t("aiImportText"),
				text: sourceText,
				provider: lease.connection.provider,
				model: response.model || lease.connection.model,
			});
			if (current !== generation.current || !lease.isCurrent()) return;
			await stageReviewedCandidates(
				rows,
				() => current === generation.current && Boolean(lease?.isCurrent()),
			);
			if (current !== generation.current) return;
			onStaged();
			setMessage(t("reviewCsvStaged", { count: rows.length }));
		} catch (error) {
			if (current === generation.current && !abort.signal.aborted)
				setMessage(
					t(
						error instanceof Error && error.message === "ai-limit"
							? "aiInputLimit"
							: error instanceof Error && error.message === "ai-secret"
								? "aiSensitiveInput"
								: "aiInvalid",
					),
				);
		} finally {
			lease?.release();
			if (current === generation.current) {
				running.current = false;
				setBusy(false);
				controller.current = null;
			}
		}
	}
	return (
		<section className="card padded ai-import-panel">
			<h2>{t("aiImportTitle")}</h2>
			<p>{t("aiImportHint")}</p>
			{!connection && (
				<p className="notice">
					{t(
						!settings
							? "aiNeedsConfig"
							: settings.keySource === "session"
								? "aiImportSessionNeedsKey"
								: vault.snapshot.status === "unlocked"
									? "aiImportVaultNeedsKey"
									: "aiImportVaultLocked",
						{ model: settings?.model },
					)}{" "}
					<TextLink asChild>
						<Link to="/settings" hash="assistant">
							{t(settings ? "aiEnableKey" : "aiConfigure")}
						</Link>
					</TextLink>
				</p>
			)}
			{connection && (
				<p className="ai-import-model">
					{t("aiImportCurrentModel", { model: connection.model })}
				</p>
			)}
			<label className="field" htmlFor="ai-import-text">
				<span>{t("aiImportText")}</span>
				<Textarea
					id="ai-import-text"
					rows={4}
					value={text}
					disabled={Boolean(file)}
					maxLength={20000}
					onChange={(event) => {
						cancel();
						setText(event.target.value);
					}}
				/>
			</label>
			<FilePicker
				id="ai-import-file"
				label={t("aiImportFile")}
				chooseLabel={t("aiImportChooseFile")}
				emptyLabel={t("aiImportNoFile")}
				file={file}
				accept=".csv,.txt,.pdf,image/png,image/jpeg,image/webp"
				onFileChange={(nextFile) => {
					cancel();
					setFile(nextFile);
				}}
			/>
			{file && (
				<div className="actions">
					<Button
						onClick={() => {
							cancel();
							setFile(null);
						}}
					>
						{t("aiImportRemoveFile")}
					</Button>
				</div>
			)}
			{preview && (
				<>
					<img
						className="ai-import-image"
						src={preview}
						alt={file?.name || ""}
					/>
					<p>{t("aiImportImageHint")}</p>
				</>
			)}
			<div className="actions">
				<Button
					variant="primary"
					disabled={!connection || busy || (!file && !text.trim())}
					onClick={() => void generate()}
				>
					{busy ? t("aiBusy") : t("aiImportGenerate")}
				</Button>
				{busy && <Button onClick={cancel}>{t("aiCancelRequest")}</Button>}
			</div>
			{message && <p role="status">{message}</p>}
		</section>
	);
}
