import { type ChangeEvent, useEffect, useRef } from "react";
import { Button } from "./button";
import "./file-picker.css";

export interface FilePickerProps {
	id: string;
	label: string;
	chooseLabel: string;
	emptyLabel: string;
	file: File | null;
	accept: string;
	onFileChange: (file: File | null) => void;
	disabled?: boolean;
	compact?: boolean;
}

export function FilePicker({
	id,
	label,
	chooseLabel,
	emptyLabel,
	file,
	accept,
	onFileChange,
	disabled = false,
	compact = false,
}: FilePickerProps) {
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!file && inputRef.current) inputRef.current.value = "";
	}, [file]);

	function openPicker() {
		if (disabled || !inputRef.current) return;
		inputRef.current.value = "";
		inputRef.current.click();
	}

	function handleChange(event: ChangeEvent<HTMLInputElement>) {
		onFileChange(event.currentTarget.files?.[0] ?? null);
	}

	return (
		<div className={`file-picker${compact ? " file-picker-compact" : ""}`}>
			<label id={`${id}-label`} className="file-picker-label" htmlFor={id}>
				{label}
			</label>
			<div className="file-picker-control">
				<input
					ref={inputRef}
					className="file-picker-input"
					id={id}
					type="file"
					accept={accept}
					disabled={disabled}
					tabIndex={-1}
					aria-hidden="true"
					aria-label={label}
					onClick={(event) => {
						// Clear the browser's remembered path so choosing the same file again
						// still emits change, including when the label opens the picker.
						event.currentTarget.value = "";
					}}
					onChange={handleChange}
				/>
				<Button
					type="button"
					variant="default"
					aria-describedby={`${id}-label ${id}-value`}
					disabled={disabled}
					onClick={openPicker}
				>
					{chooseLabel}
				</Button>
				<span
					id={`${id}-value`}
					className={`file-picker-value${file ? " file-picker-value-selected" : " file-picker-value-empty"}`}
					aria-live="polite"
					title={file?.name}
				>
					{file?.name ?? emptyLabel}
				</span>
			</div>
		</div>
	);
}
