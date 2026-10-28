import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "@daypicker/react";
import { enUS, zhCN } from "@daypicker/react/locale";
import { format, isValid, parse } from "date-fns";
import {
	useEffect,
	useId,
	useRef,
	useState,
	type InputHTMLAttributes,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";
import { Popover, PopoverContent } from "./popover";
import "@daypicker/react/style.css";
import "./date-picker.css";

type Props = Omit<
	InputHTMLAttributes<HTMLInputElement>,
	"type" | "value" | "onChange" | "size"
> & {
	value: string;
	onValueChange: (value: string) => void;
};
export function parseCalendarDate(value: string): Date | undefined {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
	const date = parse(value, "yyyy-MM-dd", new Date(2000, 0, 1));
	return isValid(date) && format(date, "yyyy-MM-dd") === value
		? date
		: undefined;
}

/** One shared date field: editable ISO value, full field opens a localized calendar. */
export function DatePicker({
	value,
	onValueChange,
	disabled,
	readOnly,
	className,
	min,
	max,
	...props
}: Props) {
	const { t, i18n } = useTranslation();
	const popupId = useId();
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState(value);
	const [month, setMonth] = useState(
		() => parseCalendarDate(value) ?? new Date(),
	);
	const inputRef = useRef<HTMLInputElement>(null);
	const focusCalendar = useRef(false);
	const selected = parseCalendarDate(value);
	const minimum = typeof min === "string" ? parseCalendarDate(min) : undefined;
	const maximum = typeof max === "string" ? parseCalendarDate(max) : undefined;
	const editable = !disabled && !readOnly;
	const valid = (text: string) => {
		if (!text) return true;
		const date = parseCalendarDate(text);
		return (
			!!date && (!minimum || date >= minimum) && (!maximum || date <= maximum)
		);
	};
	useEffect(() => {
		setDraft(value);
		inputRef.current?.setCustomValidity("");
	}, [value]);
	const change = (text: string) => {
		setDraft(text);
		inputRef.current?.setCustomValidity(valid(text) ? "" : t("invalidDate"));
		if (valid(text)) onValueChange(text);
	};
	return (
		<Popover
			open={open && editable}
			onOpenChange={(next) => {
				if (next && editable) setMonth(selected ?? new Date());
				setOpen(next && editable);
			}}
		>
			<div
				className={`date-field${disabled ? " is-disabled" : ""}${className ? ` ${className}` : ""}`}
			>
				<input
					{...props}
					ref={inputRef}
					type="text"
					role="combobox"
					aria-autocomplete="none"
					inputMode="numeric"
					value={draft}
					disabled={disabled}
					readOnly={readOnly}
					placeholder={t("datePlaceholder")}
					autoComplete="off"
					aria-haspopup="dialog"
					aria-expanded={open && editable}
					aria-controls={open && editable ? popupId : undefined}
					onClick={(event) => {
						props.onClick?.(event);
						if (!event.defaultPrevented && editable && !open) {
							focusCalendar.current = false;
							setMonth(selected ?? new Date());
							setOpen(true);
						}
					}}
					onChange={(event) => change(event.target.value)}
					onKeyDown={(event) => {
						props.onKeyDown?.(event);
						if (event.key === "ArrowDown" && editable) {
							event.preventDefault();
							focusCalendar.current = true;
							setOpen(true);
						}
						if (event.key === "Escape") setOpen(false);
					}}
				/>
				<span className="date-trigger" aria-hidden="true">
					<CalendarDays size={17} aria-hidden="true" />
				</span>
			</div>
			<PopoverContent
				id={popupId}
				className="date-popover"
				anchor={inputRef}
				aria-label={t("datePickerTitle")}
				initialFocus={() => focusCalendar.current}
				finalFocus={inputRef}
			>
				<DayPicker
					mode="single"
					locale={i18n.language.startsWith("zh") ? zhCN : enUS}
					month={month}
					onMonthChange={setMonth}
					selected={selected}
					captionLayout="dropdown"
					startMonth={minimum ?? new Date(1900, 0)}
					endMonth={maximum ?? new Date(2100, 11)}
					disabled={[
						...(minimum ? [{ before: minimum }] : []),
						...(maximum ? [{ after: maximum }] : []),
					]}
					onSelect={(day) => {
						if (day) {
							change(format(day, "yyyy-MM-dd"));
							setOpen(false);
						}
					}}
					components={{
						Chevron: ({ orientation }) =>
							orientation === "left" ? (
								<ChevronLeft size={16} />
							) : (
								<ChevronRight size={16} />
							),
					}}
				/>
				<div className="date-footer">
					<Button
						size="small"
						variant="ghost"
						onClick={() => {
							change("");
							setOpen(false);
						}}
					>
						{t("taskClearDates")}
					</Button>
					<Button
						size="small"
						onClick={() => {
							const today = format(new Date(), "yyyy-MM-dd");
							if (valid(today)) {
								change(today);
								setOpen(false);
							}
						}}
						disabled={!valid(format(new Date(), "yyyy-MM-dd"))}
					>
						{t("calendarToday")}
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
