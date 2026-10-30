import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { portableCandidate } from "./portable-candidate";
/** Compile-only local acceptance has an index manifest; portable gates still require their archive. */
export function acceptanceCandidate(): {
	release: {
		sourceCommit: string;
		sourceDirty: boolean;
		webFiles: { path: string; sha256: string }[];
	};
	archiveSha256: string | null;
} {
	if (!process.env.KEEPANY_WEB_CANDIDATE) return portableCandidate();
	const release = JSON.parse(
		readFileSync(
			resolve(process.env.KEEPANY_WEB_CANDIDATE, "CANDIDATE.json"),
			"utf8",
		),
	);
	if (release.schema !== "keepany.catalog-web.v1")
		throw Error("Invalid compiled Web candidate.");
	return { release, archiveSha256: null };
}
