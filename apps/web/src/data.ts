import { useEffect, useMemo, useState } from "react";
import { liveQuery } from "dexie";
import type {
	Asset,
	Category,
	History,
	Relation,
	Submission,
	Task,
} from "../../../packages/domain/src";
import {
	database,
	type PendingCategoryEdit,
	localRepository,
	type RecordRow,
} from "../../../packages/local-db/src";
import { projectGlobalSearchCandidate, type GlobalSearchCandidate } from "./global-search";
export function useData() {
	const [reviewedCandidates, setReviewedCandidates] = useState<GlobalSearchCandidate[]>([]);
	const [reviewedCandidatesLoaded, setReviewedCandidatesLoaded] = useState(false);
	useEffect(() => {
		let active = true;
		let dispose: (() => void) | undefined;
		void localRepository().then((repository) => {
			if (!active) return;
			const subscription = liveQuery(async () => {
				const candidates = await repository.fileStore.intakeReview.where("status").equals("accepted").toArray();
				return candidates.map(projectGlobalSearchCandidate);
			}).subscribe({
				next: (candidates) => { if (active) { setReviewedCandidates(candidates); setReviewedCandidatesLoaded(true); } },
				error: () => { if (active) { setReviewedCandidates([]); setReviewedCandidatesLoaded(false); } },
			});
			dispose = () => subscription.unsubscribe();
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
			const subscription = liveQuery(async () => {
				const pending = await Promise.all((["project", "account", "subscription", "item", "vault"] as const).map((kind) => repository.getPendingCategoryEdit(kind)));
				return pending.filter((edit): edit is PendingCategoryEdit => edit !== null);
			}).subscribe({
				next: (pending) => { setPendingCategoryEdits(pending); setCategoryEditsError(false); setCategoryEditsLoading(false); },
				error: () => { setCategoryEditsError(true); setCategoryEditsLoading(false); },
			});
			dispose = () => subscription.unsubscribe();
		}).catch(() => { if (active) { setCategoryEditsError(true); setCategoryEditsLoading(false); } });
		return () => { active = false; dispose?.(); };
	}, []);
	const [rows, setRows] = useState<RecordRow[]>([]),
		[error, setError] = useState(""),
		[loading, setLoading] = useState(true);
	useEffect(() => {
		let dispose: (() => void) | undefined;
		let active = true;
		database()
			.then((db) => {
				if (!active) return;
				const sub = db.records.find().$.subscribe({
					next: (docs) => {
						setRows(docs.map((d) => d.toJSON() as RecordRow));
						setLoading(false);
					},
					error: (e) => setError(String(e)),
				});
				dispose = () => sub.unsubscribe();
			})
			.catch((e) => {
				setError(String(e));
				setLoading(false);
			});
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
export async function seed(t: (key: string) => string, language: string) {
	const { addSampleLibrary } = await import("./sample-library");
	return addSampleLibrary(t, language);
}
