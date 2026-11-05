import { verifyMobileCandidate } from "./lib/mobile-candidate.mjs";

const usage = "Usage: node scripts/verify-mobile-candidate.mjs <manifest> <apk> [<acceptance-results>] [--bundle-only]";
const args = process.argv.slice(2);
const positional = args.filter(arg => arg !== "--bundle-only");
let report;
if (positional.length < 2 || positional.length > 3 || positional.some(arg => arg.startsWith("--")) || args.filter(arg => arg === "--bundle-only").length > 1) {
  report = { schema: "keepany.mobile-verification.v1", status: "FAIL", errors: [usage] };
} else {
  try {
    report = verifyMobileCandidate({ manifestPath: positional[0], apkPath: positional[1], acceptancePath: positional[2], bundleOnly: args.includes("--bundle-only") });
  } catch (error) {
    report = { schema: "keepany.mobile-verification.v1", status: "FAIL", errors: [`Verification failed: ${error.message}`] };
  }
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === "PASS" ? 0 : 1;
