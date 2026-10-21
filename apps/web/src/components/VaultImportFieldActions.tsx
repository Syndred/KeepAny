import type { ReactNode } from "react";
import { VaultImportCopyButton } from "./VaultImportCopyButton";
import { VaultImportPasteButton } from "./VaultImportPasteButton";
import "../vault-import-fields.css";

export function VaultImportFieldActions({
	label,
	copyLabel,
	value,
	disabled,
	readOnly = false,
	onPaste,
	onCopyError,
	children,
}: {
	label: string;
	copyLabel?: string;
	value: string;
	disabled: boolean;
	readOnly?: boolean;
	onPaste?: (value: string) => void;
	onCopyError?: (value: string) => void;
	children?: ReactNode;
}) {
	return (
		<span className="pw-import-field-actions">
			<VaultImportCopyButton
				label={label}
				copyLabel={copyLabel}
				value={value}
				disabled={disabled}
				onCopyError={onCopyError}
			/>
			{onPaste && (
				<VaultImportPasteButton
					label={label}
					value={value}
					disabled={disabled || readOnly}
					onPaste={onPaste}
				/>
			)}
			{children}
		</span>
	);
}
