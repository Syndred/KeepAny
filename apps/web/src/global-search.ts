import {
	formatMinorUnits,
	inputFromMinorUnits,
	parseMinorUnits,
	type Asset,
	type AssetKind,
	type History,
	type Task,
} from "../../../packages/domain/src";
import type {
	ReviewedCandidate,
	ReviewedExpenseDraft,
} from "../../../packages/local-db/src/intake-review";

export type GlobalSearchSource = "asset" | "finance" | "intake" | "task";
export type GlobalSearchFinanceAction =
	| "expense"
	| "topup"
	| "refund"
	| "balance"
	| "renew";

/** Public review metadata only; PDF text, descriptions and notes are unnecessary. */
export type GlobalSearchCandidate = Pick<
	ReviewedCandidate,
	"id" | "source" | "fileName" | "rowNumber" | "status" | "reviewMode" | "historyId"
> & {
	asset: Pick<Asset, "id" | "kind" | "name" | "url">;
	expenseDraft?: Pick<
		ReviewedExpenseDraft,
		"assetId" | "title" | "amount" | "currency" | "eventDate" | "source"
	>;
};

export interface GlobalSearchLabels {
	assetKinds: Readonly<Record<AssetKind, string>>;
	financeActions: Readonly<Record<GlobalSearchFinanceAction, string>>;
	sources: Readonly<Record<GlobalSearchSource, string>>;
	taskStates: Readonly<{ pending: string; done: string }>;
	intakeAccepted: string;
}

export type GlobalSearchTarget =
	| { readonly type: "asset"; readonly kind: AssetKind; readonly assetId: string }
	| { readonly type: "finance"; readonly historyId: string }
	| { readonly type: "intake"; readonly candidateId: string }
	| { readonly type: "task"; readonly taskId: string };

export interface GlobalSearchResult {
	readonly key: string;
	readonly source: GlobalSearchSource;
	readonly title: string;
	readonly secondary: string;
	readonly target: GlobalSearchTarget;
}

export interface GlobalSearchEntry extends GlobalSearchResult {
	readonly searchText: string;
}

export interface GlobalSearchInput {
	assets: readonly Asset[];
	history: readonly History[];
	reviewedCandidates: readonly GlobalSearchCandidate[];
	/** Until provenance loads, descriptions must not accidentally index PDF text. */
	reviewedCandidatesLoaded: boolean;
	tasks: readonly Task[];
	locale: string;
	labels: GlobalSearchLabels;
}

const assetOrder: Readonly<Record<AssetKind, number>> = {
	project: 0,
	account: 1,
	item: 2,
	subscription: 3,
	vault: 4,
};
const financeActions = new Set<string>([
	"expense",
	"topup",
	"refund",
	"balance",
	"renew",
]);
const publicAssetTextFields = [
	"name",
	"username",
	"location",
	"category",
	"contact",
	"borrower",
	"accountProvider",
	"subscriptionPaymentMethod",
	"projectTitle",
	"projectMediumDescription",
	"projectFeatures",
	"projectPricing",
	"projectPricingType",
	"projectEmail",
] as const satisfies readonly (keyof Asset)[];

function normalize(text: string): string {
	return text.trim().toLowerCase();
}

function compareText(left: string, right: string): number {
	const a = normalize(left), b = normalize(right);
	return a < b ? -1 : a > b ? 1 : 0;
}

function compareId(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

/** URL credentials, query parameters and fragments are never search material. */
function publicUrl(value: string): string {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" && url.protocol !== "http:") return "";
		return `${url.protocol}//${url.host}${url.pathname}`;
	} catch {
		return "";
	}
}

function publicText(value: string): string {
	return value.replace(
		/\b(?:[a-z][a-z0-9+.-]*|1password):\/\/[^\s<>"']+/gi,
		(url) => publicUrl(url),
	).trim();
}

function joinText(values: readonly (string | undefined)[]): string {
	return values.filter((value): value is string => !!value).map(publicText).filter(Boolean).join(" · ");
}

function entry(result: GlobalSearchResult, values: readonly (string | undefined)[]): GlobalSearchEntry {
	return { ...result, searchText: normalize(joinText([result.title, result.secondary, ...values])) };
}

function moneyText(amount: number | undefined, currency: string | undefined, locale: string): string[] {
	if (amount === undefined || !currency || !Number.isSafeInteger(amount) || amount < 0) return [];
	return [formatMinorUnits(amount, currency, locale), inputFromMinorUnits(amount, currency), currency];
}

/** Build a disposable projection from existing repositories, never a second data store. */
export function buildGlobalSearchIndex(input: GlobalSearchInput): readonly GlobalSearchEntry[] {
	const { assets, history, reviewedCandidates, tasks, locale, labels } = input;
	const result: GlobalSearchEntry[] = [];
	const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
	const pdfAssetIds = new Set(reviewedCandidates.filter((row) => row.source === "pdf").map((row) => row.asset.id));
	const live = assets.filter((asset) => !asset.deleted).sort((a, b) =>
		assetOrder[a.kind] - assetOrder[b.kind] || compareText(a.name, b.name) || compareId(a.id, b.id));
	for (const asset of live) {
		// Legacy archives can contain accepted PDF assets without their review receipt.
		const allowDescription = input.reviewedCandidatesLoaded && !pdfAssetIds.has(asset.id)
			&& !/^pdf-[a-f0-9]{48}$/.test(asset.id);
		const kind = labels.assetKinds[asset.kind];
		result.push(entry({
			key: `asset:${asset.id}`, source: "asset", title: publicText(asset.name),
			secondary: joinText([kind, publicUrl(asset.url), asset.username, asset.location]),
			target: { type: "asset", kind: asset.kind, assetId: asset.id },
		}, [
			kind, ...publicAssetTextFields.map((field) => asset[field]), ...asset.tags,
			publicUrl(asset.url), publicUrl(asset.projectPromoUrl),
			...(allowDescription ? [asset.description, asset.longDescription] : []),
			...(asset.projectDomains ?? []).flatMap((domain) => [domain.name, domain.registrar]),
		]));
	}
	const ledger = history.filter((row) => {
		if (row.deleted || !financeActions.has(row.action)) return false;
		const kind = assetsById.get(row.assetId)?.kind;
		return row.action === "renew" ? kind === "subscription" : kind === "subscription" || kind === "account";
	}).sort((a, b) => compareText(b.eventDate || b.billDate || b.createdAt, a.eventDate || a.billDate || a.createdAt)
		|| compareText(b.createdAt, a.createdAt) || compareId(a.id, b.id));
	for (const row of ledger) {
		const assetName = assetsById.get(row.assetId)?.name;
		const action = labels.financeActions[row.action as GlobalSearchFinanceAction];
		const date = row.eventDate || row.billDate || row.createdAt.slice(0, 10);
		const money = moneyText(row.amount, row.currency, locale);
		const title = publicText(row.title || assetName || action);
		result.push(entry({
			key: `finance:${row.id}`, source: "finance", title,
			secondary: joinText([labels.sources.finance, action, assetName, date, row.source, money[0]]),
			target: { type: "finance", historyId: row.id },
		}, [title, action, assetName, row.eventDate, row.billDate, row.createdAt.slice(0, 10), row.source, ...money]));
	}
	const receipts = reviewedCandidates.filter((row) => row.status === "accepted")
		.sort((a, b) => compareText(a.fileName, b.fileName) || a.rowNumber - b.rowNumber || compareId(a.id, b.id));
	for (const row of receipts) {
		const draft = row.reviewMode === "expense" ? row.expenseDraft : undefined;
		const title = publicText(draft?.title || row.asset.name || row.fileName);
		const money = draft && draft.amount.length <= 32
			? moneyText(parseMinorUnits(draft.amount, draft.currency), draft.currency, locale) : [];
		const kind = draft ? labels.financeActions.expense : labels.assetKinds[row.asset.kind];
		result.push(entry({
			key: `intake:${row.id}`, source: "intake", title,
			secondary: joinText([labels.sources.intake, labels.intakeAccepted, row.fileName, kind,
				row.source === "pdf" ? "" : String(row.rowNumber), draft?.eventDate, money[0]]),
			target: { type: "intake", candidateId: row.id },
		}, [title, row.fileName, row.source === "pdf" ? "" : String(row.rowNumber), kind, labels.intakeAccepted,
			...(draft ? [draft.title, draft.source, draft.eventDate, ...money] : [row.asset.name, publicUrl(row.asset.url)])]));
	}
	const ordinary = tasks.filter((task) => !task.deleted && !task.impactSnapshot && !task.projectWorkflow && !task.maintenancePlan)
		.sort((a, b) => compareText(a.dueDate || "9999", b.dueDate || "9999") || compareText(a.name, b.name) || compareId(a.id, b.id));
	for (const task of ordinary) {
		const related = assetsById.get(task.assetId);
		const assetName = related && !related.deleted ? related.name : undefined;
		const state = labels.taskStates[task.done ? "done" : "pending"];
		result.push(entry({
			key: `task:${task.id}`, source: "task", title: publicText(task.name),
			secondary: joinText([labels.sources.task, state, task.dueDate, assetName]),
			target: { type: "task", taskId: task.id },
		}, [task.name, task.dueDate, state, assetName]));
	}
	return result;
}

/** An empty query browses the same deterministic index; every query has a 15-row cap. */
export function searchGlobalIndex(
	index: readonly GlobalSearchEntry[], query: string, options: { limit?: number } = {},
): readonly GlobalSearchResult[] {
	const requested = options.limit ?? 15;
	const limit = Number.isNaN(requested) ? 15 : Math.max(0, Math.min(15, Math.trunc(requested)));
	const term = normalize(query);
	return index.filter((row) => !term || row.searchText.includes(term)).slice(0, limit)
		.map(({ key, source, title, secondary, target }) => ({ key, source, title, secondary, target }));
}
