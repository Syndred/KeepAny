import { AssetsPage, AssetsNavigation } from "./page-assets";
import { useRouterState } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./components/ui/button";
import { usePasswordVault } from "./components/PasswordVaultProvider";
import { AssetKindList, type AccountListFilters } from "./page-asset-list";
import { FinancePage } from "./page-finance";
import { SAMPLE_LIBRARY_ID, sampleLibraryAssetIds } from "./sample-library";
import { partitionAccountPasswords } from "./workspace-summary";
import { useAppContext } from "./view-shared";
import "./workspaces.css";
const AssetEditor = lazy(() =>
	import("./workflow-asset-editor").then((module) => ({
		default: module.AssetEditor,
	})),
);
type AssetView =
	| "all"
	| "project"
	| "item"
	| "subscription"
	| "domains"
	| "ledger"
	| "online"
	| "physical";
const PasswordVaultPanel = lazy(() =>
	import("./components/PasswordVaultPanel").then((module) => ({
		default: module.PasswordVaultPanel,
	})),
);

export function AccountsWorkspace() {
	const { data, search, notify } = useAppContext();
	const { t } = useTranslation();
	const { snapshot } = usePasswordVault();
	const hash = useRouterState({ select: (state) => state.location.hash });
	const [editAccount, setEditAccount] = useState(false);
	const [filters, setFilters] = useState<AccountListFilters>(() => ({
		search: sessionStorage.getItem("keepany-account-list-search") ?? "",
		category: "",
		tag: "",
	}));
	const sampleIds = sampleLibraryAssetIds(
		data.preferences.find((preference) => preference.id === SAMPLE_LIBRARY_ID)
			?.value,
	);
	const sampleAccounts = data.assets.filter(
		(asset) =>
			!asset.deleted &&
			asset.kind === "account" &&
			sampleIds.includes(asset.id),
	);
	const grouped = useMemo(
		() =>
			partitionAccountPasswords(
				snapshot.status === "unlocked" ? snapshot.entries : [],
				data.assets,
			),
		[snapshot.status, snapshot.entries, data.assets],
	);
	const searchExtras = useMemo(
		() =>
			new Map(
				[...grouped.linked].map(([id, entries]) => [
					id,
					entries
						.flatMap((entry) => [
							entry.title,
							entry.username,
							...(entry.usernameAliases ?? []),
							entry.url,
						])
						.join(" ")
						.toLocaleLowerCase(),
				]),
			),
		[grouped.linked],
	);
	const unlinked = grouped.unlinked.filter((entry) =>
		[search, filters.search].every(
			(query) =>
				!query.trim() ||
				[
					entry.title,
					entry.username,
					...(entry.usernameAliases ?? []),
					entry.url,
				]
					.join(" ")
					.toLocaleLowerCase()
					.includes(query.trim().toLocaleLowerCase()),
		),
	);
	return (
		<main className="page unified-accounts-page">
			<Suspense fallback={<p role="status">{t("pwVaultLoading")}</p>}>
				<PasswordVaultPanel
					assets={data.assets}
					sampleAccounts={sampleAccounts}
					notify={notify}
					focusAssetId={hash.startsWith("asset-") ? hash.slice(6) : undefined}
					headerAction={
						<Button
							variant="primary"
							title={t("workspaceAddAccount")}
							disabled={data.pendingCategoryEdits.some(
								(pending) => pending.kind === "account",
							)}
							onClick={() => setEditAccount(true)}
						>
							<Plus size={17} />
							{t("add")}
						</Button>
					}
					renderAccounts={({ renderEntry, addEntry }) => (
						<AssetKindList
							kind="account"
							embedded
							hideTitle
							privateSearch={snapshot.status === "unlocked"}
							accountSearchExtras={searchExtras}
							onAccountFiltersChange={setFilters}
							renderAccountDetails={(asset) =>
								snapshot.status === "unlocked" ? (
									<details className="unified-account-passwords">
										<summary>
											{t("workspacePasswordCount", {
												count: grouped.linked.get(asset.id)?.length ?? 0,
											})}
										</summary>
										<div className="password-vault-entry-list">
											{(grouped.linked.get(asset.id) ?? []).map(renderEntry)}
										</div>
										<Button size="small" onClick={() => addEntry(asset.id)}>
											<Plus size={15} />
											{t("pwVaultNewEntry")}
										</Button>
									</details>
								) : (
									<p className="unified-account-locked">
										{t(
											snapshot.status === "empty"
												? "workspacePasswordsNotCreated"
												: snapshot.status === "loading"
													? "pwVaultLoading"
													: "workspacePasswordsLocked",
										)}
									</p>
								)
							}
							afterList={
								snapshot.status === "unlocked" &&
								!filters.category &&
								!filters.tag &&
								unlinked.length > 0 ? (
									<section
										className="workspace-password-only"
										aria-labelledby="workspace-unlinked-passwords"
									>
										<h2 id="workspace-unlinked-passwords">
											{t("workspacePasswordOnly")}
										</h2>
										<div className="password-vault-entry-list">
											{unlinked.map(renderEntry)}
										</div>
									</section>
								) : null
							}
						/>
					)}
				/>
			</Suspense>
			{editAccount && (
				<Suspense fallback={<p role="status">{t("loading")}</p>}>
					<AssetEditor
						kind="account"
						categories={data.categories}
						onClose={() => setEditAccount(false)}
					/>
				</Suspense>
			)}
		</main>
	);
}

export function AssetsWorkspace({ view = "all" }: { view?: AssetView }) {
	if (view === "ledger")
		return (
			<div className="assets-finance-workspace">
				<AssetsNavigation />
				<FinancePage expenseOnly />
			</div>
		);
	return (
		<AssetsPage
			key={view}
			section={
				view === "all"
					? "overview"
					: view === "item" || view === "physical"
						? "physical"
						: "online"
			}
			initialCategory={
				view === "domains"
					? "domains"
					: view === "project" || view === "subscription"
						? view
						: "all"
			}
		/>
	);
}
export function FinanceWorkspaceRoute() {
	return <AssetsWorkspace view="ledger" />;
}
export function WorkspaceLegacyRoute() {
	const params = useRouterState({
		select: (state) => state.matches.at(-1)?.params,
	}) as { kind?: string } | undefined;
	const kind = params?.kind;
	if (kind === "account" || kind === "vault") return <AccountsWorkspace />;
	return (
		<AssetsWorkspace
			view={
				kind === "item" ||
				kind === "subscription" ||
				kind === "domains" ||
				kind === "online" ||
				kind === "physical"
					? kind
					: "project"
			}
		/>
	);
}
