// Compatibility entry: every verification now names the actual compiled portable candidate.
import { readCandidate, selectCandidate } from './lib/portable-candidate.mjs';
const candidate = readCandidate(selectCandidate({ argument: process.argv[2] }));
console.log(`Verified ${candidate.release.webFiles.length} current files for ${candidate.release.sourceCommit}.`);
