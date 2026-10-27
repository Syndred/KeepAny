import { forwardRef, useEffect, useRef, useState, type AnchorHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { deliverExportUrl, hasFileDeliveryHandler, type FileDeliveryMessage } from "../file-delivery";
import "../file-delivery-copy";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "download"> & {
	href: string;
	download: string;
	onDeliveryMessage: (key: FileDeliveryMessage) => void;
};

// Keep the actual download link on Web, including keyboard and automation behavior.
export const ExportFileLink = forwardRef<HTMLAnchorElement, Props>(function ExportFileLink(
	{ href, download, onDeliveryMessage, onClick, children, ...props }, ref,
) {
	const { t } = useTranslation();
	const inFlight = useRef(false);
	const mounted = useRef(true);
	const source = `${href}\n${download}`;
	const currentSource = useRef(source);
	currentSource.current = source;
	useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
	const [busy, setBusy] = useState(false);
	const native = hasFileDeliveryHandler();
	return <a {...props} ref={ref} href={href} download={download}
		aria-busy={native && busy ? true : undefined}
		aria-disabled={native && busy ? true : undefined}
		onClick={event => {
			onClick?.(event);
			if (!native || event.defaultPrevented) return;
			event.preventDefault();
			if (inFlight.current) return;
			inFlight.current = true;
			setBusy(true);
			onDeliveryMessage("exportFileOpening");
			const report = (key: FileDeliveryMessage) => {
				if (mounted.current && currentSource.current === source) onDeliveryMessage(key);
			};
			void deliverExportUrl(href, download).then(result => {
				report(result.status === "cancelled" ? "exportFileCancelled" : "exportFileOpened");
			}).catch(() => {
				report("exportFileFailed");
			}).finally(() => { inFlight.current = false; if (mounted.current) setBusy(false); });
		}}>{native ? t("exportFileOpen") : children}</a>;
});
