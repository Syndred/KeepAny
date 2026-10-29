import Papa from "papaparse";
import { assetSchema, newAsset, type AssetKind } from "../../../packages/domain/src";
import { stageReviewedCandidates, type ReviewedCandidate } from "./intake-review-store";
import { isPdfFile } from "./ai-import-input";

const importKinds = ["project", "account", "subscription", "item"] as const;
const maxCsvBytes = 2 * 1024 * 1024;
const maxRows = 200;

async function fingerprint(bytes: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function stageCsvForReview(file: File): Promise<number> {
	if (isPdfFile(file)) throw Error("pdf");
	if (!file.name.toLowerCase().endsWith(".csv") || file.size > maxCsvBytes) throw Error("limit");
	const staged: ReviewedCandidate[] = [];
	try {
		const bytes = await file.arrayBuffer();
		const hash = await fingerprint(bytes);
		// Keep the original BOM and line endings for review and encrypted backup.
		// Papa handles a UTF-8 BOM itself; do not normalize the saved source text.
		const sourceText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
		const parsed = Papa.parse<Record<string, string>>(sourceText, { header: true, skipEmptyLines: true });
		if (parsed.errors.length || parsed.data.length > maxRows || !parsed.data.length) throw Error("invalid");
		const importedAt = new Date().toISOString();
		for (const [index, source] of parsed.data.entries()) {
			const kind = source.kind?.trim() as AssetKind;
			if (!importKinds.includes(kind as typeof importKinds[number]) || !source.name?.trim()) continue;
			const asset = assetSchema.safeParse({
				...newAsset(kind), id: `csv-${hash.slice(0, 48)}-${index + 2}`,
				name: source.name.trim(), url: source.url?.trim() ?? "",
				category: source.category?.trim() ?? "", description: source.description?.trim() ?? "",
				createdAt: importedAt, updatedAt: importedAt,
			});
			if (asset.success) staged.push({
				id: `csv-${hash}-${index + 2}`, fileHash: hash, fileName: file.name,
				rowNumber: index + 2, asset: asset.data, status: "pending",
				...(staged.length ? { sourceTextRef: hash } : { sourceText }),
			});
		}
		if (!staged.length) throw Error("invalid");
	} catch {
		throw Error("invalid");
	}
	await stageReviewedCandidates(staged);
	return staged.length;
}
