import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";

/** Copy the stored value, including whitespace, without revealing secret fields. */
export function VaultImportCopyButton({
	label,
	copyLabel,
	value,
	disabled,
	onCopyError,
}: {
	label: string;
	copyLabel?: string;
	value: string;
	disabled: boolean;
	onCopyError?: (value: string) => void;
}) {
	const { t } = useTranslation();
	const generation = useRef(0);
	const [status, setStatus] = useState<"idle" | "pending" | "done" | "error">(
		"idle",
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Do not announce a late result after the field changes or locks.
	useEffect(() => {
		generation.current += 1;
		setStatus("idle");
		return () => {
			generation.current += 1;
		};
	}, [value, disabled]);
	useEffect(() => {
		if (status !== "done") return;
		const timeout = window.setTimeout(() => setStatus("idle"), 2400);
		return () => window.clearTimeout(timeout);
	}, [status]);
	return (
		<span className="pw-import-copy">
			<Button
				type="button"
				size="icon"
				aria-label={copyLabel ?? t("pwSmartCopyField", { field: label })}
				title={copyLabel ?? t("pwSmartCopyField", { field: label })}
				disabled={disabled || !value || status === "pending"}
				onClick={async () => {
					const request = ++generation.current;
					setStatus("pending");
					try {
						await navigator.clipboard.writeText(value);
						if (request === generation.current) setStatus("done");
					} catch {
						if (request !== generation.current) return;
						setStatus(onCopyError ? "idle" : "error");
						onCopyError?.(value);
					}
				}}
			>
				{status === "done" ? <Check size={16} /> : <Copy size={16} />}
			</Button>
			{status === "error" && (
				<span role="status" className="pw-import-paste-error">
					{t("pwSmartCopyFailed")}
				</span>
			)}
			{status === "done" && (
				<span role="status" className="pw-import-clipboard-sr">
					{t("pwVaultCopied")}
				</span>
			)}
		</span>
	);
}
