import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./components/ui/button";
import "./route-load-error.css";

export function routeErrorKind(error: unknown): "module-load" | "unexpected" {
	if (
		error instanceof TypeError &&
		(/^(Failed to fetch dynamically imported module:|error loading dynamically imported module:)/i.test(
			error.message,
		) || /^Importing a module script failed\.?$/i.test(error.message))
	)
		return "module-load";
	return "unexpected";
}

export function RouteLoadError({ error }: { error: unknown }) {
	const { t } = useTranslation();
	const heading = useRef<HTMLHeadingElement>(null);
	const kind = routeErrorKind(error);
	useEffect(() => {
		if (!document.querySelector('[role="dialog"], dialog[open]'))
			heading.current?.focus();
	}, []);
	return (
		<main className="page route-load-error">
			<section
				className="card"
				role="alert"
				aria-labelledby="route-load-error-title"
				data-testid="route-load-error"
				data-error-kind={kind}
			>
				<h1 id="route-load-error-title" ref={heading} tabIndex={-1}>
					{t(kind === "module-load" ? "pageLoadErrorTitle" : "pageUnexpectedErrorTitle")}
				</h1>
				<p>{t("pageLoadErrorHint")}</p>
				<Button variant="primary" onClick={() => window.location.reload()}>
					{t("pageLoadErrorReload")}
				</Button>
			</section>
		</main>
	);
}
