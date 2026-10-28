import "./overlays.css";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { clsx } from "clsx";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from "react";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "./select.css";

export interface SelectOptionProps {
	value?: string;
	disabled?: boolean;
	children: ReactNode;
}

/** Marker component consumed by Select; it does not render on its own. */
export function SelectOption(_props: SelectOptionProps): null {
	return null;
}

interface SelectOptionData {
	key: string;
	value: string;
	disabled?: boolean;
	children: ReactNode;
}

type TriggerProps = ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>;

export type SelectProps = Omit<
	TriggerProps,
	| "children"
	| "className"
	| "disabled"
	| "id"
	| "name"
	| "onValueChange"
	| "required"
	| "type"
	| "value"
> & {
	value: string;
	onValueChange: (value: string) => void;
	children: ReactNode;
	className?: string;
	contentClassName?: string;
	id?: string;
	name?: string;
	disabled?: boolean;
	required?: boolean;
	autoComplete?: string;
	form?: string;
};

function textValue(node: ReactNode): string {
	if (
		typeof node === "string" ||
		typeof node === "number" ||
		typeof node === "bigint"
	) {
		return String(node);
	}
	if (Array.isArray(node)) return node.map(textValue).join("");
	if (node && typeof node === "object" && "props" in node) {
		return textValue(
			(node as { props?: { children?: ReactNode } }).props?.children,
		);
	}
	return "";
}

function collectOptions(
	children: ReactNode,
	result: SelectOptionData[] = [],
): SelectOptionData[] {
	if (Array.isArray(children)) {
		children.forEach((child) => {
			collectOptions(child, result);
		});
		return result;
	}
	if (
		!children ||
		typeof children === "string" ||
		typeof children === "number" ||
		typeof children === "boolean"
	) {
		return result;
	}
	if (!isReactElement(children)) return result;
	if (children.type === SelectOption) {
		const option = children.props as SelectOptionProps;
		const defaultValue = textValue(option.children);
		result.push({
			key:
				children.key == null
					? `${option.value ?? defaultValue}-${result.length}`
					: String(children.key),
			value: option.value ?? defaultValue,
			disabled: option.disabled,
			children: option.children,
		});
		return result;
	}
	if (children.type === Fragment) {
		collectOptions(children.props.children, result);
	}
	return result;
}

function isReactElement(
	node: ReactNode,
): node is ReactElement<{ children?: ReactNode }> {
	return (
		typeof node === "object" &&
		node !== null &&
		"type" in node &&
		"props" in node
	);
}

export function Select({
	value,
	onValueChange,
	children,
	className,
	contentClassName,
	id,
	name,
	disabled,
	required,
	autoComplete,
	form,
	...triggerProps
}: SelectProps) {
	const { t } = useTranslation();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const invalidId = useId();
	const [invalid, setInvalid] = useState(false);
	const options = collectOptions(children);
	const label =
		options.find((option) => option.value === value)?.children ??
		(value || t("select"));
	useEffect(() => {
		if (!required || disabled || value !== "") setInvalid(false);
	}, [required, disabled, value]);
	return (
		<span
			className="themed-select-root"
			onInvalid={(event) => {
				if (event.target instanceof HTMLInputElement) {
					event.preventDefault();
					setInvalid(true);
					triggerRef.current?.focus();
				}
			}}
		>
			<SelectPrimitive.Root<string>
				value={value}
				onValueChange={(next) => onValueChange(next ?? "")}
				name={name}
				disabled={disabled}
				required={required}
				autoComplete={autoComplete}
				form={form}
				items={options.map((option) => ({
					value: option.value,
					label: option.children,
				}))}
			>
				<SelectPrimitive.Trigger
					{...triggerProps}
					ref={triggerRef}
					id={id ?? `select-${invalidId}`}
					type="button"
					disabled={disabled}
					aria-invalid={invalid ? true : triggerProps["aria-invalid"]}
					aria-describedby={
						[triggerProps["aria-describedby"], invalid ? invalidId : undefined]
							.filter(Boolean)
							.join(" ") || undefined
					}
					className={clsx("themed-select-trigger", className)}
					data-value={value}
				>
					<span className="themed-select-value" title={textValue(label)}>
						<SelectPrimitive.Value>{label}</SelectPrimitive.Value>
					</span>
					<SelectPrimitive.Icon className="themed-select-icon">
						<ChevronDown size={18} />
					</SelectPrimitive.Icon>
				</SelectPrimitive.Trigger>
				<SelectPrimitive.Portal>
					<SelectPrimitive.Positioner
						className="ui-positioner"
						alignItemWithTrigger={false}
						sideOffset={5}
						collisionPadding={10}
					>
						<SelectPrimitive.Popup
							className={clsx("themed-select-content", contentClassName)}
						>
							<SelectPrimitive.ScrollUpArrow className="themed-select-scroll-button">
								<ChevronUp size={16} />
							</SelectPrimitive.ScrollUpArrow>
							<SelectPrimitive.List className="themed-select-viewport">
								{options.map((option) => (
									<SelectPrimitive.Item
										key={option.key}
										value={option.value}
										label={textValue(option.children)}
										disabled={option.disabled}
										className="themed-select-item"
										data-value={option.value}
									>
										<SelectPrimitive.ItemText className="themed-select-item-text">
											{option.children}
										</SelectPrimitive.ItemText>
										<SelectPrimitive.ItemIndicator className="themed-select-item-indicator">
											<Check size={16} />
										</SelectPrimitive.ItemIndicator>
									</SelectPrimitive.Item>
								))}
							</SelectPrimitive.List>
							<SelectPrimitive.ScrollDownArrow className="themed-select-scroll-button">
								<ChevronDown size={16} />
							</SelectPrimitive.ScrollDownArrow>
						</SelectPrimitive.Popup>
					</SelectPrimitive.Positioner>
				</SelectPrimitive.Portal>
			</SelectPrimitive.Root>
			{invalid && (
				<small id={invalidId} className="themed-select-error" role="alert">
					{t("invalid")}
				</small>
			)}
		</span>
	);
}
