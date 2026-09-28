import { useEffect, useState } from "react";
import { database, save, type RecordRow } from "../../../packages/local-db/src";
import {
	type Asset,
	type Category,
	type Relation,
	type Task,
	type History,
	type Submission,
	newAsset,
} from "../../../packages/domain/src";
export function useData() {
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
	for (const asset of [a, b, c, d]) await save("asset", asset);
	await save("relation", {
		id: crypto.randomUUID(),
		from: a.id,
		to: b.id,
		label: "Contact email",
		createdAt: new Date().toISOString(),
	});
	await save("relation", {
		id: crypto.randomUUID(),
		from: c.id,
		to: a.id,
		label: "Hosting",
		createdAt: new Date().toISOString(),
	});
}
