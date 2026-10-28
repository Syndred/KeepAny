import { Component, Suspense, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { routeErrorKind } from "../RouteLoadError";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import "./DeferredVaultTool.css";

class ModuleLoadBoundary extends Component<
	{ children: ReactNode; fallback: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };

	static getDerivedStateFromError(error: unknown) {
		const cssLoadFailure =
			error instanceof Error &&
			error.message.startsWith("Unable to preload CSS for ");
		if (routeErrorKind(error) !== "module-load" && !cssLoadFailure) throw error;
		return { failed: true };
	}

	render() {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}

export function DeferredVaultTool({
	children,
	title,
	onClose,
	returnFocusTo,
}: {
	children: ReactNode;
	title: string;
	onClose: () => void;
	returnFocusTo: () => HTMLElement | null;
}) {
	const { t } = useTranslation();
	return (
		<ModuleLoadBoundary
			fallback={
				<Dialog
					title={t("featureLoadErrorTitle")}
					onClose={onClose}
					returnFocusTo={returnFocusTo}
					focusTitleOnOpen
					className="deferred-vault-tool-dialog"
				>
					<p role="alert" data-vault-tool-phase="error">
						{t("pageLoadErrorHint")}
					</p>
					<div className="actions">
						<Button onClick={onClose}>{t("close")}</Button>
						<Button variant="primary" onClick={() => window.location.reload()}>
							{t("pageLoadErrorReload")}
						</Button>
					</div>
				</Dialog>
			}
		>
			<Suspense
				fallback={
					<Dialog
						title={title}
						onClose={onClose}
						returnFocusTo={returnFocusTo}
						focusTitleOnOpen
						className="deferred-vault-tool-dialog"
					>
						<p role="status" data-vault-tool-phase="loading">
							{t("featureLoading")}
						</p>
						<div className="actions">
							<Button onClick={onClose}>{t("cancel")}</Button>
						</div>
					</Dialog>
				}
			>
				{children}
			</Suspense>
		</ModuleLoadBoundary>
	);
}
