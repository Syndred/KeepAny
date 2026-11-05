import { readCandidate, selectCandidate, type CandidateRelease } from "../../../scripts/lib/portable-candidate.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

/** Candidate receipts use the same checked input boundary as the public test server. */
export function portableCandidate() {
 if (process.env.KEEPANY_WEB_CANDIDATE) {
  const directory = process.env.KEEPANY_WEB_CANDIDATE;
  const release = JSON.parse(readFileSync(join(directory, "CANDIDATE.json"), "utf8")) as CandidateRelease;
  for (const file of release.webFiles) if (createHash("sha256").update(readFileSync(join(directory, file.path))).digest("hex") !== file.sha256) throw Error(`Candidate file changed: ${file.path}`);
  return { release, archiveSha256: null, indexSha256: release.webFiles.find((file: {path:string}) => file.path === "index.html")?.sha256 };
 }
 const { release, archiveSha256 } = readCandidate(selectCandidate({ archiveOnly: true }));
 if (!archiveSha256) throw Error("Candidate receipt requires an archive digest.");
 return { release, archiveSha256 };
}
