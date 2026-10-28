import { build } from "esbuild";
import { expect, it } from "vitest";

it("keeps manual identifier cleanup independent of CSV and AI runtime modules", async () => {
	const result = await build({
		entryPoints: ["apps/web/src/vault-entry-identifiers.ts"],
		bundle: true,
		write: false,
		metafile: true,
		platform: "browser",
	});
	expect(Object.keys(result.metafile.inputs)).toEqual([
		"apps/web/src/vault-entry-identifiers.ts",
	]);
});
