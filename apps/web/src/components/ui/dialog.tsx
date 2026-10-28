// shadcn Base UI composition; provenance in legal/third-party/shadcn-ui.
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { useTranslation } from "react-i18next";
export function Dialog({
	title,
	children,
	onClose,
	closeDisabled = false,
	returnFocusTo,
	className,
	headerActions,
	focusTitleOnOpen = false,
}: {
	headerActions?: ReactNode;
	focusTitleOnOpen?: boolean;
	className?: string;
	title: string;
	children: ReactNode;
	onClose: () => void;
	closeDisabled?: boolean;
	returnFocusTo?: () => HTMLElement | null;
}) {
	const { t } = useTranslation();
	const titleRef = useRef<HTMLHeadingElement | null>(null);
	const opener = useRef<HTMLElement | null>(null);
	if (
		!opener.current &&
		typeof document !== "undefined" &&
		document.activeElement instanceof HTMLElement
	) {
		opener.current = document.activeElement;
	}
	return (
		<DialogPrimitive.Root
			open
			onOpenChange={(open, details) => {
				if (!open) {
					if (closeDisabled) details.cancel();
					else onClose();
				}
			}}
		>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Backdrop className="overlay" />
				<DialogPrimitive.Popup
					className={`dialog${className ? ` ${className}` : ""}`}
					aria-describedby={undefined}
					initialFocus={focusTitleOnOpen ? titleRef : undefined}
					finalFocus={() => {
						const target = returnFocusTo?.() ?? opener.current;
						return target?.isConnected ? target : false;
					}}
				>
					<header>
						<DialogPrimitive.Title
							ref={titleRef}
							tabIndex={focusTitleOnOpen ? -1 : undefined}
						>
							{title}
						</DialogPrimitive.Title>
						{headerActions}
						<DialogPrimitive.Close
							className="button icon ghost"
							aria-label={t("close")}
							disabled={closeDisabled}
						>
							<X size={18} />
						</DialogPrimitive.Close>
					</header>
					{children}
				</DialogPrimitive.Popup>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
