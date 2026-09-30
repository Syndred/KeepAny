import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import {
	type Asset,
	type Category,
	type History,
	newAsset,
	type Relation,
	type Submission,
	type Task,
} from "../../../packages/domain/src";
import {
	database,
	type PendingCategoryEdit,
	localRepository,
	type RecordRow,
	saveBatch,
} from "../../../packages/local-db/src";
export function useData() {
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
	const get = <T>(type: string) =>
		rows.filter((r) => r.type === type).map((r) => JSON.parse(r.payload) as T);
	return {
		pendingCategoryEdits,
		categoryEditsLoading,
		categoryEditsError,
		assets: get<Asset>("asset"),
		categories: get<Category>("category"),
		relations: get<Relation>("relation"),
		tasks: get<Task>("task"),
		history: get<History>("history"),
		submissions: get<Submission>("submission"),
		preferences: get<{ id: string; value: unknown }>("preference"),
		loading,
		error,
	};
}
export type Data = ReturnType<typeof useData>;
export async function seed() {
	const a = {
		...newAsset("project"),
		name: "Mori Notes",
		category: "website",
		url: "https://example.com",
		description: "A quiet place for ideas",
		tags: ["Personal", "Writing"],
	};
	const b = {
		...newAsset("account"),
		name: "Studio Mail",
		category: "email",
		username: "hello@example.com",
		tags: ["Work"],
	};
	const c = {
		...newAsset("subscription"),
		name: "Cloud hosting",
		category: "service",
		amount: 9800,
		currency: "CNY" as const,
		dueDate: "2026-10-22",
		tags: ["Mori Notes"],
	};
	const d = {
		...newAsset("item"),
		name: "Work laptop",
		category: "device",
		amount: 1299900,
		purchaseDate: "2023-05-10",
		location: "Studio · Desk",
		tags: ["Work"],
	};
	const accountRelation = {
		id: crypto.randomUUID(),
		from: a.id,
		to: b.id,
		label: "Contact email",
		createdAt: new Date().toISOString(),
	};
	const hostingRelation = {
		id: crypto.randomUUID(),
		from: c.id,
		to: a.id,
		label: "Hosting",
		createdAt: new Date().toISOString(),
	};
	await saveBatch([
		...[a, b, c, d].map((value) => ({ type: "asset" as const, value })),
		{ type: "relation", value: accountRelation },
		{ type: "relation", value: hostingRelation },
	]);
}
