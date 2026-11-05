import { Input } from "./components/ui/input";
import { DatePicker } from "./components/ui/date-picker";
import { useLayoutEffect, useRef } from "react";

export function useValidationFocus(errors: Record<string, string>) {
	const formRef = useRef<HTMLFormElement>(null);
	const requested = useRef(false);
	useLayoutEffect(() => {
		if (!requested.current) return;
		requested.current = false;
		const form = formRef.current;
		const error = form?.querySelector<HTMLElement>(".field-error");
		const target = form?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)')
			?? error?.closest(".field")?.querySelector<HTMLElement>('input:not([type="hidden"]):not(:disabled),textarea:not(:disabled),select:not(:disabled),button:not(:disabled)');
		if (!target) return;
		(target.closest(".field") ?? target).scrollIntoView({ block: "center", behavior: "instant" });
		target.focus({ preventScroll: true });
	}, [errors]);
	return { formRef, requestFocus: () => { requested.current = true; } };
}

export function Field({
	label,
	name,
	value,
	onChange,
	type = "text",
	autoComplete,
	disabled,
	error,
	children,
}: {
	label: string;
	name: string;
	value?: string | number;
	onChange?: (s: string) => void;
	type?: string;
	autoComplete?: string;
	disabled?: boolean;
	error?: string;
	children?: React.ReactNode;
}) {
	return (
		<div className="field">
			<label htmlFor={name}>{label}</label>
			{children ?? (type === "date" ? <DatePicker id={name} name={name} value={String(value ?? "")} onValueChange={(next) => onChange?.(next)} disabled={disabled} aria-invalid={!!error} aria-describedby={error ? `${name}-error` : undefined} /> :
				<Input
					id={name}
					name={name}
					type={type}
					autoComplete={autoComplete}
					disabled={disabled}
					step={type === "number" ? "any" : undefined}
					value={value ?? ""}
					onChange={(e) => onChange?.(e.target.value)}
					aria-invalid={!!error}
					aria-describedby={error ? `${name}-error` : undefined}
				/>
			)}
			{error && (
				<small id={`${name}-error`} className="field-error">
					{error}
				</small>
			)}
		</div>
	);
}
