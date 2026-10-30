import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Category } from "../../../packages/domain/src";
import { localRepository, save } from "../../../packages/local-db/src";
import { catalogCategories, catalogCategoryLabel } from "./catalog-records";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { useAppContext } from "./view-shared";

export function useCatalogCategories() {
	const { data } = useAppContext();
	const categories = catalogCategories(
		data.categories,
		data.preferences.find((p) => p.id === "catalogCategoryOrder")?.value,
	);
	const [error, setError] = useState(false);
	const running = useRef(false);
	const [retry, setRetry] = useState(0);
	useEffect(() => {
		if (data.loading || running.current || error) return;
		const legacy = data.assets.filter(
			(asset) => !asset.deleted && asset.kind === "project",
		);
		const sources = [
			...(legacy.some(
				(asset) =>
					asset.catalogCategoryId === undefined &&
					!data.categories.some(
						(category) =>
							category.kind === "project" &&
							(category.scope === "catalog"
								? category.legacyName
								: category.name) === asset.category,
					),
			)
				? ["project" as const]
				: []),
			...(legacy.some((asset) =>
				asset.projectDomains.some((domain) => !domain.catalog),
			)
				? ["domains" as const]
				: []),
		].filter(
			(source) =>
				!data.categories.some(
					(category) =>
						category.scope === "catalog" && category.source === source,
				),
		);
		if (!sources.length) return;
		running.current = true;
		void (async () => {
			const repo = await localRepository();
			for (const source of sources)
				await repo.saveCatalogCategory(null, { name: source, source });
		})()
			.catch(() => setError(true))
			.finally(() => {
				running.current = false;
			});
	}, [data.assets, data.categories, data.loading, error, retry]);
	return {
		categories,
		error,
		retry: () => {
			setError(false);
			setRetry((value) => value + 1);
		},
	};
}

export function CatalogCategoryManager({
	onClose,
	onCreated,
	creating = false,
}: {
	onClose: () => void;
	onCreated: (id: string) => void;
	creating?: boolean;
}) {
	const { t } = useTranslation();
	const { data, notify } = useAppContext();
	const categories = catalogCategories(
		data.categories,
		data.preferences.find((p) => p.id === "catalogCategoryOrder")?.value,
	);
	const [name, setName] = useState("");
	const [edit, setEdit] = useState<Category | null>(null);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const inFlight = useRef(false);
	const [remove, setRemove] = useState<Category | null>(null);
	function failure(reason: unknown) {
		const message = reason instanceof Error ? reason.message : "";
		return t(
			["category-duplicate", "category-reserved"].includes(message)
				? "categoryDuplicate"
				: message === "category-name"
					? "categoryNameInvalid"
					: message === "category-stale" || message === "asset-stale"
						? "categoryEditStale"
						: "error",
		);
	}
	async function run(action: () => Promise<void>) {
		if (inFlight.current) return;
		inFlight.current = true;
		setBusy(true);
		setError("");
		try {
			await action();
		} catch (reason) {
			setError(failure(reason));
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	}
	function submit(event: React.FormEvent) {
		event.preventDefault();
		void run(async () => {
			const trimmed = name.trim();
			if (
				categories.some(
					(category) =>
						category.id !== edit?.id &&
						[category.name, catalogCategoryLabel(category, t)].some(
							(value) =>
								value.normalize("NFKC").toLocaleLowerCase() ===
								trimmed.normalize("NFKC").toLocaleLowerCase(),
						),
				) ||
				categories.some(
					(category) =>
						category.id !== edit?.id &&
						category.source &&
						category.name === category.source &&
						(category.source === "project"
							? ["project", "projects", "项目"]
							: ["domains", "domain", "域名"]
						).includes(trimmed.normalize("NFKC").toLocaleLowerCase()),
				)
			)
				throw Error("category-duplicate");
			const category = await (await localRepository()).saveCatalogCategory(
				edit,
				{ name: trimmed },
			);
			if (edit) {
				setEdit(null);
				setName("");
				notify(t("saved"));
			} else {
				onCreated(category.id);
				onClose();
			}
		});
	}
	function move(category: Category, offset: number) {
		void run(async () => {
			const ids = categories.map((value) => value.id),
				index = ids.indexOf(category.id);
			[ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
			await save("preference", { id: "catalogCategoryOrder", value: ids });
		});
	}
	return (
		<Dialog
			title={t(creating ? "catalogNew" : "catalogManage")}
			onClose={onClose}
			closeDisabled={busy}
		>
			<form className="asset-editor" onSubmit={submit}>
				<label className="field" htmlFor="catalog-category-name">
					{t("catalogName")}
					<Input
						id="catalog-category-name"
						value={name}
						maxLength={60}
						required
						disabled={busy}
						onChange={(event) => {
							setName(event.target.value);
							setError("");
						}}
					/>
				</label>
				<div className="actions">
					<Button
						variant="primary"
						type="submit"
						disabled={busy || !name.trim()}
					>
						{t(edit ? "save" : "catalogNew")}
					</Button>
					{edit && (
						<Button
							disabled={busy}
							onClick={() => {
								setEdit(null);
								setName("");
							}}
						>
							{t("cancel")}
						</Button>
					)}
				</div>
			</form>
			{error && (
				<p role="alert" className="field-error">
					{error}
				</p>
			)}
			{!creating && (
				<div className="catalog-category-manager">
					{categories.map((category, index) => (
						<section
							className="catalog-category-row"
							key={category.id}
							aria-label={catalogCategoryLabel(category, t)}
						>
							<strong>
								{catalogCategoryLabel(category, t)}
								{category.hidden && (
									<span className="muted"> · {t("catalogHidden")}</span>
								)}
							</strong>
							<div className="actions">
								<Button
									size="small"
									disabled={busy}
									onClick={() => {
										setEdit(structuredClone(category));
										setName(catalogCategoryLabel(category, t));
										setRemove(null);
										setError("");
									}}
								>
									{t("edit")}
								</Button>
								<Button
									size="small"
									disabled={busy}
									onClick={() =>
										void run(async () => {
											await (await localRepository()).saveCatalogCategory(
												category,
												{ name: category.name, hidden: !category.hidden },
											);
										})
									}
								>
									{t(category.hidden ? "catalogShow" : "catalogHide")}
								</Button>
								<Button
									size="small"
									disabled={busy || index === 0}
									aria-label={`${t("catalogMoveUp")} ${catalogCategoryLabel(category, t)}`}
									onClick={() => move(category, -1)}
								>
									{t("catalogMoveUp")}
								</Button>
								<Button
									size="small"
									disabled={busy || index === categories.length - 1}
									aria-label={`${t("catalogMoveDown")} ${catalogCategoryLabel(category, t)}`}
									onClick={() => move(category, 1)}
								>
									{t("catalogMoveDown")}
								</Button>
								<Button
									size="small"
									variant="danger"
									disabled={busy}
									onClick={() => {
										setRemove(category);
										setError("");
									}}
								>
									{t("remove")}
								</Button>
							</div>
						</section>
					))}
				</div>
			)}
			{remove && (
				<section className="notice" aria-label={t("catalogRemoveTitle")}>
					<strong>{catalogCategoryLabel(remove, t)}</strong>
					<p>{t("catalogRemoveHint")}</p>
					<div className="actions">
						<Button
							variant="danger"
							disabled={busy}
							onClick={() =>
								void run(async () => {
									await (await localRepository()).saveCatalogCategory(remove, {
										name: remove.name,
										deleted: true,
									});
									setRemove(null);
									notify(t("catalogCategoryRemoved"));
								})
							}
						>
							{t("catalogRemoveTitle")}
						</Button>
						<Button disabled={busy} onClick={() => setRemove(null)}>
							{t("cancel")}
						</Button>
					</div>
				</section>
			)}
			<div className="actions">
				<Button disabled={busy} onClick={onClose}>
					{t("close")}
				</Button>
			</div>
		</Dialog>
	);
}
