import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
	DndContext,
	PointerSensor,
	KeyboardSensor,
	closestCenter,
	useSensor,
	useSensors,
	type DragEndEvent,
} from "@dnd-kit/core";
import {
	SortableContext,
	horizontalListSortingStrategy,
	sortableKeyboardCoordinates,
	useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AssetKind } from "../../../packages/domain/src";
import { save } from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import {
	AssetRow,
	Empty,
	PageTitle,
	builtins,
	kinds,
	liveAssets,
	niceCategory,
	useAppContext,
	validKind,
} from "./view-shared";
const AssetEditor = lazy(() =>
	import("./workflows").then((module) => ({ default: module.AssetEditor })),
);
function SortablePill({
	id,
	label,
	active,
	onClick,
}: {
	id: string;
	label: string;
	active: boolean;
	onClick: () => void;
}) {
	const { t } = useTranslation();
	const { attributes, listeners, setNodeRef, transform, transition } =
		useSortable({ id });
	return (
		<div
			ref={setNodeRef}
			className="sortable-pill"
			style={{ transform: CSS.Transform.toString(transform), transition }}
		>
			<button
				type="button"
				className="drag-handle"
				{...attributes}
				{...listeners}
				aria-label={`${label} ${t("drag")}`}
			>
				<GripVertical size={14} />
			</button>
			<button
				type="button"
				className={active ? "active" : ""}
				aria-pressed={active}
				onClick={onClick}
			>
				{label}
			</button>
		</div>
	);
}
function CategoryStrip({
	kind,
	chosen,
	choose,
}: {
	kind: AssetKind;
	chosen: string;
	choose: (x: string) => void;
}) {
	const { data, notify } = useAppContext();
	const { t } = useTranslation();
	const categoryNames = [
		...builtins[kind],
		...data.categories
			.filter((c) => c.kind === kind && !c.deleted)
			.map((c) => c.name),
	].filter((v, i, a) => a.indexOf(v) === i);
	const preference = data.preferences.find(
		(p) => p.id === `categoryOrder-${kind}`,
	);
	const savedOrder = Array.isArray(preference?.value)
		? (preference.value as string[])
		: [];
	const ordered = [...categoryNames].sort((a, b) => {
		const ai = savedOrder.indexOf(a),
			bi = savedOrder.indexOf(b);
		return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
	});
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	const [manage, setManage] = useState(false);
	const [name, setName] = useState("");
	async function onDragEnd(e: DragEndEvent) {
		if (!e.over || e.active.id === e.over.id) return;
		const from = ordered.indexOf(String(e.active.id)),
			to = ordered.indexOf(String(e.over.id));
		const next = [...ordered];
		next.splice(to, 0, next.splice(from, 1)[0]);
		await save("preference", { id: `categoryOrder-${kind}`, value: next });
	}
	async function addCategory() {
		const trimmed = name.trim();
		if (!trimmed || categoryNames.includes(trimmed)) return;
		await save("category", {
			id: crypto.randomUUID(),
			kind,
			name: trimmed,
			order: categoryNames.length,
			deleted: false,
		});
		setName("");
		setManage(false);
		choose(trimmed);
		notify(t("saved"));
	}
	return (
		<>
			<div className="tabs">
				<button
					type="button"
					className={chosen === "" ? "active" : ""}
					onClick={() => choose("")}
				>
					{t("all")}
				</button>
				<DndContext
					sensors={sensors}
					collisionDetection={closestCenter}
					onDragEnd={onDragEnd}
				>
					<SortableContext
						items={ordered}
						strategy={horizontalListSortingStrategy}
					>
						{ordered.map((id) => (
							<SortablePill
								key={id}
								id={id}
								label={niceCategory(id, t)}
								active={chosen === id}
								onClick={() => choose(id)}
							/>
						))}
					</SortableContext>
				</DndContext>
				<Button variant="ghost" size="small" onClick={() => setManage(true)}>
					<Plus size={14} />
					{t("manage")}
				</Button>
			</div>
			{manage && (
				<Dialog title={t("category")} onClose={() => setManage(false)}>
					<div className="field">
						<label htmlFor="category-name">{t("categoryName")}</label>
						<input
							id="category-name"
							value={name}
							maxLength={60}
							onChange={(e) => setName(e.target.value)}
						/>
					</div>
					<div className="actions">
						<Button onClick={addCategory} disabled={!name.trim()}>
							{t("save")}
						</Button>
					</div>
					<div className="list">
						{data.categories
							.filter((c) => c.kind === kind && !c.deleted)
							.map((c) => (
								<div className="list-row" key={c.id}>
									<strong>{c.name}</strong>
									<Button
										variant="danger"
										size="small"
										onClick={async () => {
											await save("category", { ...c, deleted: true });
											if (chosen === c.name) choose("");
										}}
									>
										{t("remove")}
									</Button>
								</div>
							))}
					</div>
					<p className="subtitle">{t("categoryHelp")}</p>
				</Dialog>
			)}
		</>
	);
}

export function AssetList() {
	const { kind: rawKind } = (useRouterState({
		select: (s) => s.matches.at(-1)?.params,
	}) ?? {}) as { kind?: string };
	const kind = validKind(rawKind ?? "project");
	const { data, search } = useAppContext();
	const { t } = useTranslation();
	const [categories, setCategories] = useState<Record<string, string>>(() =>
		Object.fromEntries(
			kinds.map((k) => [
				k,
				sessionStorage.getItem(`keepany-category-${k}`) || "",
			]),
		),
	);
	const category = categories[kind] || "";
	const choose = (value: string) => {
		sessionStorage.setItem(`keepany-category-${kind}`, value);
		setCategories((prev) => ({ ...prev, [kind]: value }));
	};
	const [edit, setEdit] = useState(false);
	const assets = liveAssets(data).filter(
		(a) =>
			a.kind === kind &&
			(!category || a.category === category) &&
			(!search ||
				`${a.name} ${a.tags.join(" ")} ${a.url} ${a.username}`
					.toLowerCase()
					.includes(search.toLowerCase())),
	);
	const restored = useRef("");
	useEffect(() => {
		if (data.loading || !assets.length || restored.current === kind) return;
		restored.current = kind;
		const y = Number(sessionStorage.getItem(`keepany-scroll-${kind}`) || 0);
		if (y) {
			const frame = requestAnimationFrame(() => window.scrollTo(0, y));
			return () => cancelAnimationFrame(frame);
		}
	}, [kind, data.loading, assets.length]);
	return (
		<main className="page">
			<PageTitle
				eyebrow="KeepAny"
				title={t(kind)}
				subtitle={t("summary")}
				action={
					<Button variant="primary" onClick={() => setEdit(true)}>
						<Plus size={17} />
						{t("add")}
					</Button>
				}
			/>
			<CategoryStrip kind={kind} chosen={category} choose={choose} />
			<section className="card">
				{assets.length ? (
					<div className="list">
						{assets.map((a) => (
							<AssetRow asset={a} key={a.id} />
						))}
					</div>
				) : (
					<Empty hint={!search} />
				)}
			</section>
			{edit && (
				<Suspense
					fallback={
						<div className="toast" role="status">
							{t("loading")}
						</div>
					}
				>
					<AssetEditor
						kind={kind}
						categories={data.categories}
						onClose={() => setEdit(false)}
					/>
				</Suspense>
			)}
		</main>
	);
}
