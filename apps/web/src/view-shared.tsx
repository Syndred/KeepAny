import { createContext, useContext } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
	ArchiveRestore,
	Boxes,
	CircleHelp,
	Shield,
	WalletCards,
} from "lucide-react";
import { formatMinorUnits, type Asset, type AssetKind } from "../../../packages/domain/src";
import type { Data } from "./data";
type AppContextValue = {
	data: Data;
	search: string;
	setSearch: (s: string) => void;
	notify: (s: string) => void;
	registerFeedbackTarget?: (node: HTMLElement | null) => void;
};
export const AppContext = createContext<AppContextValue | null>(null);
export function useAppContext() {
	const value = useContext(AppContext);
	if (!value) throw Error("missing-app-context");
	return value;
}
export const kinds: AssetKind[] = [
	"project",
	"account",
	"subscription",
	"item",
];
export const icons = {
	project: Boxes,
	account: Shield,
	subscription: WalletCards,
	item: ArchiveRestore,
	vault: Shield,
};
export const builtins: Record<AssetKind, string[]> = {
	project: ["website", "repository", "tool"],
	account: ["email", "phone", "social", "other"],
	subscription: ["software", "service"],
	item: ["device", "other"],
	vault: ["other"],
};
export function validKind(value: string): AssetKind {
	return value === "vault" || kinds.includes(value as AssetKind) ? (value as AssetKind) : "project";
}
export function money(amount: number | bigint, currency: string, lang: string) {
	return formatMinorUnits(amount, currency, lang);
}
export function date(value: string, lang: string) {
	if (!value) return "—";
	const time = new Date(`${value}T12:00:00Z`);
	return Number.isNaN(time.getTime())
		? value
		: new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeZone: "UTC" }).format(time);
}
export function niceCategory(value: string, t: (s: string) => string) {
	return builtins.project
		.concat(builtins.account, builtins.subscription, builtins.item)
		.includes(value)
		? t(value)
		: value;
}
export function liveAssets(data: Data) {
	return data.assets.filter((a) => !a.deleted && a.kind !== "vault");
}

export function PageTitle({
	eyebrow,
	title,
	subtitle,
	action,
}: {
	eyebrow?: string;
	title: string;
	subtitle?: string;
	action?: React.ReactNode;
}) {
	return (
		<div className="page-header">
			<div>
				{eyebrow && <div className="eyebrow">{eyebrow}</div>}
				<h1>{title}</h1>
				{subtitle && <p className="subtitle">{subtitle}</p>}
			</div>
			{action && <div className="actions">{action}</div>}
		</div>
	);
}

export function Empty({ hint = true }: { hint?: boolean }) {
	const { t } = useTranslation();
	return (
		<div className="empty">
			<CircleHelp size={24} />
			<strong>{t("empty")}</strong>
			{hint && <span>{t("emptyHint")}</span>}
		</div>
	);
}
export function AssetRow({
	asset,
	rememberListScroll = false,
}: {
	asset: Asset;
	rememberListScroll?: boolean;
}) {
	const { t, i18n } = useTranslation();
	const { search } = useAppContext();
	const Icon = icons[asset.kind];
	return (
		<Link
			className={
				asset.kind === "subscription"
					? "list-row subscription-list-row"
					: "list-row"
			}
			to="/assets/$kind/$id"
			params={{ kind: asset.kind, id: asset.id }}
			onClick={() => {
				if (!rememberListScroll) return;
				sessionStorage.setItem(
					`keepany-scroll-${asset.kind}`,
					String(window.scrollY),
				);
				sessionStorage.setItem(
					`keepany-scroll-filter-${asset.kind}`,
					JSON.stringify({
						category:
							sessionStorage.getItem(`keepany-category-${asset.kind}`) || "",
						tag: sessionStorage.getItem(`keepany-tag-${asset.kind}`) || "",
						search,
					}),
				);
			}}
		>
			<span className="row-icon">
				<Icon size={18} />
			</span>
			<div className="row-main">
				<strong>{asset.name}</strong>
				<small>
					{niceCategory(asset.category, t)}
					{asset.description ? ` · ${asset.description}` : ""}
				</small>
			</div>
			{asset.kind === "subscription" && (
				<b>{money(asset.amount, asset.currency, i18n.language)}</b>
			)}
			{asset.tags.slice(0, 2).map((tag) => (
				<span className="chip" key={tag}>
					{tag}
				</span>
			))}
		</Link>
	);
}
