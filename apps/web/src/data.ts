import { useEffect, useMemo, useState } from "react";

import {
	type Asset,
	type Category,
	type History,
	newAsset,
	normalizeCategoryName,
	type Relation,
	type Submission,
	type Task,
} from "../../../packages/domain/src";
import {
	type PendingCategoryEdit,
	localRepository,
	type RecordRow,
	saveBatch,
} from "../../../packages/local-db/src";
import { projectGlobalSearchCandidate, type GlobalSearchCandidate } from "./global-search";
import { COLLECTIONS_PREFERENCE_ID, readCollections } from "./collection-model";
export function useData() {
	const [reviewedCandidates, setReviewedCandidates] = useState<GlobalSearchCandidate[]>([]);
	const [reviewedCandidatesLoaded, setReviewedCandidatesLoaded] = useState(false);
	useEffect(() => {
		let active = true;
		let dispose: (() => void) | undefined;
		void localRepository().then((repository) => {
			if (!active) return;
			const unsubscribe = repository.observe(async () => {
				const candidates = await repository.fileStore.intakeReview.equals("status", "accepted");
				return candidates.map(projectGlobalSearchCandidate);
			}, {
				next: (candidates) => { if (active) { setReviewedCandidates(candidates); setReviewedCandidatesLoaded(true); } },
				error: () => { if (active) { setReviewedCandidates([]); setReviewedCandidatesLoaded(false); } },
			});
			dispose = unsubscribe;
		}).catch(() => { if (active) setReviewedCandidatesLoaded(false); });
		return () => { active = false; dispose?.(); };
	}, []);
	const [categoryEditsLoading, setCategoryEditsLoading] = useState(true);
	const [categoryEditsError, setCategoryEditsError] = useState(false);
	const [pendingCategoryEdits, setPendingCategoryEdits] = useState<PendingCategoryEdit[]>([]);
	useEffect(() => {
		let active = true;
		let dispose: (() => void) | undefined;
		void localRepository().then((repository) => {
			if (!active) return;
			const unsubscribe = repository.observe(async () => {
				const pending = await Promise.all((["project", "account", "subscription", "item", "vault"] as const).map((kind) => repository.getPendingCategoryEdit(kind)));
				return pending.filter((edit): edit is PendingCategoryEdit => edit !== null);
			}, {
				next: (pending) => { setPendingCategoryEdits(pending); setCategoryEditsError(false); setCategoryEditsLoading(false); },
				error: () => { setCategoryEditsError(true); setCategoryEditsLoading(false); },
			});
			dispose = unsubscribe;
		}).catch(() => { if (active) { setCategoryEditsError(true); setCategoryEditsLoading(false); } });
		return () => { active = false; dispose?.(); };
	}, []);
	const [rows, setRows] = useState<RecordRow[]>([]),
		[error, setError] = useState(""),
		[loading, setLoading] = useState(true);
	useEffect(() => {
		let dispose: (() => void) | undefined;
		let active = true;
		localRepository()
			.then((repository) => {
				if (!active) return;
				dispose = repository.observe(current => current.allRecords(), {
					next: (rows) => { setRows(rows); setLoading(false); setError(""); },
					error: (error) => { setError(String(error)); setLoading(false); },
				});
			})
			.catch((e) => { if (active) { setError(String(e)); setLoading(false); } });
		return () => {
			active = false;
			dispose?.();
		};
	}, []);
	const entities = useMemo(() => {
		const get = <T>(type: string) =>
			rows.filter((r) => r.type === type).map((r) => JSON.parse(r.payload) as T);
		return {
			assets: get<Asset>("asset"), categories: get<Category>("category"),
			relations: get<Relation>("relation"), tasks: get<Task>("task"),
			history: get<History>("history"), submissions: get<Submission>("submission"),
			preferences: get<{ id: string; value: unknown }>("preference"),
		};
	}, [rows]);
	return {
		...entities,
		reviewedCandidates,
		reviewedCandidatesLoaded,
		pendingCategoryEdits,
		categoryEditsLoading,
		categoryEditsError,
		loading,
		error,
	};
}
export type Data = ReturnType<typeof useData>;
export async function seed(t: (key: string) => string, language: string, existingCollections?: unknown) {
	const now = new Date();
	const createdAt = now.toISOString();
	const day = (offset: number) => {
		const value = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
		return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
	};
	const english = !language.startsWith("zh");
	const currency = english ? "USD" as const : "CNY" as const;
	const a = {
		...newAsset("project"), currency,
		name: t("sampleProject"), category: "website", url: "https://example.com",
		description: t("sampleProjectDescription"),
		tags: [t("samplePersonalTag"), t("sampleWritingTag")],
	};
	const b = {
		...newAsset("account"), currency,
		name: t("sampleAccount"), category: "email", username: "hello@example.com",
		accountProvider: "Example Mail", tags: [t("sampleWorkTag")],
	};
	const c = {
		...newAsset("subscription"), currency,
		name: t("sampleHosting"), category: "service", amount: english ? 1200 : 9800,
		dueDate: day(7), tags: [t("sampleProject")],
	};
	const d = {
		...newAsset("item"), currency,
		name: t("sampleLaptop"), category: "device", amount: english ? 149900 : 1299900,
		purchaseDate: "2023-05-10", location: t("sampleLocation"), tags: [t("sampleWorkTag")],
	};
	const e = {
		...newAsset("vault"), currency,
		name: t("sampleVault"), category: "other", location: t("sampleVaultLocation"),
		dueDate: day(0), tags: [t("sampleWorkTag")],
	};
	const relations = [
		{ from: a.id, to: b.id, label: t("sampleContactRelation") },
		{ from: c.id, to: a.id, label: t("sampleHostingRelation") },
		{ from: e.id, to: b.id, label: t("sampleVaultRelation") },
		{ from: d.id, to: a.id, label: t("sampleLaptopRelation") },
	].map(value => ({ ...value, id: crypto.randomUUID(), createdAt }));
	const tasks = [
		{ name: t("sampleReviewTask"), assetId: a.id, dueDate: day(1) },
		{ name: t("sampleBackupTask"), assetId: d.id, dueDate: day(3) },
	].map(value => ({ ...value, id: crypto.randomUUID(), createdAt }));
	const collections = readCollections(existingCollections);
	const collectionName = t("sampleCollection");
	const addCollection = collections.length < 8 && !collections.some(collection => normalizeCategoryName(collection.name) === normalizeCategoryName(collectionName));
	await saveBatch([
		...[a, b, c, d, e].map(value => ({ type: "asset" as const, value })),
		...relations.map(value => ({ type: "relation" as const, value })),
		...tasks.map(value => ({ type: "task" as const, value })),
		{ type: "history", value: {
			id: crypto.randomUUID(), assetId: c.id, action: "expense", title: t("sampleBill"),
			source: t("sampleBillSource"), note: "", amount: c.amount, currency, eventDate: day(-30), createdAt,
		} },
		...(addCollection ? [{ type: "preference" as const, value: { id: COLLECTIONS_PREFERENCE_ID, value: [
			...collections, { id: crypto.randomUUID(), name: collectionName, assetIds: [a.id, b.id, c.id, d.id, e.id] },
		] } }] : []),
	]);
}
