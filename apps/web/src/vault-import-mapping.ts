import {
	parseVaultImportText,
	VAULT_IMPORT_MAX_BYTES,
	VAULT_IMPORT_MAX_ENTRIES,
	type VaultImportResult,
} from "./vault-import-model";

export type VaultMappedField =
	| ""
	| "ignore"
	| "title"
	| "username"
	| "password"
	| "url"
	| "notes";
export type VaultMappedLine = {
	lineNumber: number;
	value: string;
	field: VaultMappedField;
	startsEntry: boolean;
};

/** Raw values stay in dialog memory; every assignment is made by the user. */
export function createVaultMappedLines(source: string): VaultMappedLine[] {
	if (new TextEncoder().encode(source).byteLength > VAULT_IMPORT_MAX_BYTES)
		throw Error("vault-import-limit");
	const rows: VaultMappedLine[] = [];
	let startsEntry = true;
	for (const [index, value] of source
		.replace(/^\uFEFF/, "")
		.split(/\r\n|\n|\r/)
		.entries()) {
		if (!value.trim()) {
			startsEntry = true;
			continue;
		}
		rows.push({ lineNumber: index + 1, value, field: "", startsEntry });
		startsEntry = false;
		// Bound the number of controls as well as source bytes.
		if (rows.length > VAULT_IMPORT_MAX_ENTRIES * 10)
			throw Error("vault-import-limit");
	}
	return rows;
}

export function parseVaultMappedLines(
	rows: VaultMappedLine[],
): VaultImportResult & { handledLines: number[] } {
	if (
		rows.length > VAULT_IMPORT_MAX_ENTRIES * 10 ||
		new TextEncoder().encode(rows.map((row) => row.value).join("\n"))
			.byteLength > VAULT_IMPORT_MAX_BYTES
	)
		throw Error("vault-import-limit");
	const result: VaultImportResult & { handledLines: number[] } = {
		candidates: [],
		issues: [],
		handledLines: rows
			.filter((row) => row.field === "ignore")
			.map((row) => row.lineNumber),
	};
	let block: VaultMappedLine[] = [];
	const flush = () => {
		const assigned = block.filter((row) => row.field && row.field !== "ignore");
		if (assigned.length) {
			const seen = new Set<VaultMappedField>();
			let duplicate = false;
			for (const row of assigned) {
				if (seen.has(row.field)) {
					result.issues.push({
						lineNumber: row.lineNumber,
						code: "duplicate-field",
					});
					duplicate = true;
				}
				seen.add(row.field);
			}
			if (duplicate) {
				block = [];
				return;
			}
			// Reuse the existing validation and JSON quoting to preserve exact values.
			const parsed = parseVaultImportText(
				assigned
					.map((row) => `${row.field}=${JSON.stringify(row.value)}`)
					.join("\n"),
			);
			if (parsed.candidates.length)
				result.handledLines.push(...assigned.map((row) => row.lineNumber));
			for (const row of parsed.candidates) {
				result.candidates.push({
					...row,
					id: `vault-import-${result.candidates.length + 1}`,
					sourceLine:
						assigned[row.sourceLine - 1]?.lineNumber ?? block[0].lineNumber,
					aiEligible: false,
				});
			}
			for (const issue of parsed.issues)
				result.issues.push({
					...issue,
					lineNumber:
						assigned[issue.lineNumber - 1]?.lineNumber ?? block[0].lineNumber,
				});
		}
		block = [];
	};
	for (const row of rows) {
		if (row.startsEntry) flush();
		if (!row.field)
			result.issues.push({
				lineNumber: row.lineNumber,
				code: "unrecognized-line",
			});
		block.push(row);
	}
	flush();
	if (
		result.candidates.length > VAULT_IMPORT_MAX_ENTRIES ||
		result.issues.length > VAULT_IMPORT_MAX_ENTRIES
	)
		throw Error("vault-import-limit");
	return result;
}

export function updateVaultMappedSource(
	source: string,
	rows: VaultMappedLine[],
): string {
	const parts = source.split(/(\r\n|\n|\r)/);
	for (const row of rows) {
		const index = (row.lineNumber - 1) * 2;
		if (index < parts.length)
			parts[index] =
				`${index === 0 && source.startsWith("\uFEFF") ? "\uFEFF" : ""}${row.value}`;
	}
	return parts.join("");
}
