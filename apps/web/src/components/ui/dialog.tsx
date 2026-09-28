import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
export function Dialog({
	title,
	children,
	onClose,
}: {
	title: string;
	children: ReactNode;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	return (
		<DialogPrimitive.Root open onOpenChange={(v) => !v && onClose()}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="overlay" />
				<DialogPrimitive.Content
					className="dialog"
					aria-describedby={undefined}
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
