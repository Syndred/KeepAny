import * as SelectPrimitive from "@radix-ui/react-select";
import { clsx } from "clsx";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from "react";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "./select.css";

const EMPTY_RADIX_VALUE = "__keepany_select_empty__";

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

function getEmptyRadixValue(
	options: SelectOptionData[],
	current: string | null,
): string {
	if (current && !options.some((option) => option.value === current))
		return current;
	let candidate = EMPTY_RADIX_VALUE;
	while (options.some((option) => option.value === candidate)) candidate += "_";
	return candidate;
}

export function Select({
	value,
	onValueChange,
	children,
	className,
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
	const emptyRadixValueRef = useRef<string | null>(null);
	const options = collectOptions(children);
	const emptyRadixValue = getEmptyRadixValue(
		options,
		emptyRadixValueRef.current,
	);
	emptyRadixValueRef.current = emptyRadixValue;
	const selectedOption = options.find((option) => option.value === value);
	const radixValue = value;
	const triggerValue =
		selectedOption?.children ?? (value === "" ? t("select") : value);
	const callerAriaInvalid = triggerProps["aria-invalid"];
	const callerAriaDescribedBy = triggerProps["aria-describedby"];
	const mergedAriaInvalid = invalid ? "true" : callerAriaInvalid;
	const mergedAriaDescribedBy =
		[callerAriaDescribedBy, invalid ? invalidId : undefined]
			.filter(Boolean)
			.join(" ") || undefined;

	useEffect(() => {
		if (!required || disabled || value !== "") setInvalid(false);
	}, [disabled, required, value]);

	return (
		<span
			className="themed-select-root"
			onInvalid={(event) => {
				if (event.target instanceof HTMLSelectElement) {
					event.preventDefault();
					setInvalid(true);
					triggerRef.current?.focus();
				}
			}}
		>
			<SelectPrimitive.Root
				value={radixValue}
				onValueChange={(nextValue) =>
					onValueChange(nextValue === emptyRadixValue ? "" : nextValue)
				}
				name={name}
				disabled={disabled}
				required={required}
				autoComplete={autoComplete}
				form={form}
			>
				<SelectPrimitive.Trigger
					{...triggerProps}
					ref={triggerRef}
					id={id ?? `select-${invalidId}`}
					aria-invalid={mergedAriaInvalid}
					aria-describedby={mergedAriaDescribedBy}
					className={clsx("themed-select-trigger", className)}
					type="button"
					disabled={disabled}
					data-value={value}
				>
					<SelectPrimitive.Value
						className="themed-select-value"
						placeholder={triggerValue}
					>
						{triggerValue}
					</SelectPrimitive.Value>
					<SelectPrimitive.Icon
						className="themed-select-icon"
						aria-hidden="true"
					>
						<ChevronDown size={18} strokeWidth={2.5} />
					</SelectPrimitive.Icon>
				</SelectPrimitive.Trigger>
				<SelectPrimitive.Portal>
					<SelectPrimitive.Content
						className="themed-select-content"
						position="popper"
						sideOffset={4}
						collisionPadding={8}
					>
						<SelectPrimitive.ScrollUpButton
							className="themed-select-scroll-button"
							aria-hidden="true"
						>
							<ChevronUp size={16} strokeWidth={2.5} />
						</SelectPrimitive.ScrollUpButton>
						<SelectPrimitive.Viewport className="themed-select-viewport">
							{options.map((option) => {
								const itemValue =
									option.value === "" ? emptyRadixValue : option.value;
								return (
									<SelectPrimitive.Item
										key={option.key}
										className="themed-select-item"
										value={itemValue}
										textValue={textValue(option.children)}
										disabled={option.disabled}
										data-value={option.value}
									>
										<SelectPrimitive.ItemText className="themed-select-item-text">
											{option.children}
										</SelectPrimitive.ItemText>
										{option.value === "" && value === "" ? (
											<span
												className="themed-select-item-indicator"
												aria-hidden="true"
											>
												<Check size={16} strokeWidth={2.75} />
											</span>
										) : (
											<SelectPrimitive.ItemIndicator className="themed-select-item-indicator">
												<Check size={16} strokeWidth={2.75} />
											</SelectPrimitive.ItemIndicator>
										)}
									</SelectPrimitive.Item>
								);
							})}
						</SelectPrimitive.Viewport>
						<SelectPrimitive.ScrollDownButton
							className="themed-select-scroll-button"
							aria-hidden="true"
						>
							<ChevronDown size={16} strokeWidth={2.5} />
						</SelectPrimitive.ScrollDownButton>
					</SelectPrimitive.Content>
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
