import { readCandidate, selectCandidate } from "../../../scripts/lib/portable-candidate.mjs";

/** Candidate receipts use the same checked input boundary as the public test server. */
export function portableCandidate() {
 const { release, archiveSha256 } = readCandidate(selectCandidate({ archiveOnly: true }));
 if (!archiveSha256) throw Error("Candidate receipt requires an archive digest.");
 return { release, archiveSha256 };
}
