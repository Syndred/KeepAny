import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { useTranslation } from "react-i18next";
export function Dialog({
	title,
	children,
	onClose,
	returnFocusTo,
}: {
	title: string;
	children: ReactNode;
	onClose: () => void;
	returnFocusTo?: () => HTMLElement | null;
}) {
	const { t } = useTranslation();
	const opener = useRef<HTMLElement | null>(null);
	if (
		!opener.current &&
		typeof document !== "undefined" &&
		document.activeElement instanceof HTMLElement
	) {
		opener.current = document.activeElement;
	}
	return (
		<DialogPrimitive.Root open onOpenChange={(v) => !v && onClose()}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="overlay" />
				<DialogPrimitive.Content
					className="dialog"
					aria-describedby={undefined}
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						const target = returnFocusTo?.() ?? opener.current;
						if (target?.isConnected) target.focus();
					}}
				>
					<header>
						<DialogPrimitive.Title>{title}</DialogPrimitive.Title>
						<DialogPrimitive.Close
							className="button icon ghost"
							aria-label={t("close")}
						>
							<X size={18} />
						</DialogPrimitive.Close>
					</header>
					{children}
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
