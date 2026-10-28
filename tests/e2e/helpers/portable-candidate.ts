import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";

type CandidateRelease = {
	schema: "keepany.portable-preview.v1";
	sourceCommit: string;
	sourceDirty: boolean;
	webFiles: Array<{ path: string; sha256: string }>;
};

/** Bind isolated UI receipts to the same checked archive served by the fixture. */
export function portableCandidate() {
	const archive = process.env.KEEPANY_PREVIEW_ARCHIVE;
	if (!archive)
		throw Error("Set KEEPANY_PREVIEW_ARCHIVE to the compiled candidate");
	const bytes = readFileSync(archive);
	const archiveSha256 = createHash("sha256").update(bytes).digest("hex");
	const expected = readFileSync(`${archive}.sha256`, "utf8").split(/\s+/)[0];
	if (archiveSha256 !== expected)
		throw Error("Candidate archive checksum mismatch");
	const members = unzipSync(bytes);
	const manifests = Object.keys(members).filter((path) =>
		path.endsWith("/RELEASE.json"),
	);
	if (manifests.length !== 1)
		throw Error("Expected one candidate release manifest");
	const release = JSON.parse(
		strFromU8(members[manifests[0]]),
	) as CandidateRelease;
	if (
		release.schema !== "keepany.portable-preview.v1" ||
		!/^[a-f0-9]{40}$/.test(release.sourceCommit) ||
		typeof release.sourceDirty !== "boolean" ||
		!Array.isArray(release.webFiles)
	)
		throw Error("Invalid candidate release identity");
	return { archiveSha256, release };
}
