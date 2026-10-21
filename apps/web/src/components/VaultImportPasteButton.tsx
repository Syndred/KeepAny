import { Check, ClipboardPaste } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";

/** Explicit clipboard access; never apply a late read to another or edited field. */
export function VaultImportPasteButton({
	label,
	value,
	disabled,
	onPaste,
}: {
	label: string;
	value: string;
	disabled: boolean;
	onPaste: (value: string) => void;
}) {
	const { t } = useTranslation();
	const generation = useRef(0);
	const pasteHandler = useRef(onPaste);
	const [status, setStatus] = useState<"idle" | "pending" | "done" | "error">(
		"idle",
	);
	// A sibling identifier may change or be removed while this read is pending.
	useLayoutEffect(() => {
		pasteHandler.current = onPaste;
	}, [onPaste]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Cancel pending clipboard reads whenever the field changes or becomes disabled.
	useEffect(() => {
		generation.current += 1;
		setStatus("idle");
		return () => {
			generation.current += 1;
		};
	}, [value, disabled]);
	return (
		<span className="pw-import-paste">
			<Button
				type="button"
				size="icon"
				aria-label={t("pwSmartPasteField", { field: label })}
				title={t("pwSmartPasteField", { field: label })}
				disabled={disabled || status === "pending"}
				onClick={async () => {
					const request = ++generation.current;
					setStatus("pending");
					try {
						const text = await navigator.clipboard.readText();
						if (request !== generation.current) return;
						pasteHandler.current(text);
						setStatus("done");
					} catch {
						if (request === generation.current) setStatus("error");
					}
				}}
			>
				{status === "done" ? <Check size={16} /> : <ClipboardPaste size={16} />}
			</Button>
			{status === "error" && (
				<span role="status" className="pw-import-paste-error">
					{t("pwSmartPasteFailed")}
				</span>
			)}
		</span>
	);
}
