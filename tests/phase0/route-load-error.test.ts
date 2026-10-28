import { describe, expect, it } from "vitest";
import { routeErrorKind } from "../../apps/web/src/RouteLoadError";

describe("route load error classification", () => {
	it.each([
		"Failed to fetch dynamically imported module: http://127.0.0.1:4180/assets/private-example.js",
		"error loading dynamically imported module: https://synthetic.example.test/private-example.js",
		"Importing a module script failed.",
	])("recognizes a browser module import rejection: %s", (message) => {
		expect(routeErrorKind(new TypeError(message))).toBe("module-load");
	});

	it.each([
		new TypeError("Failed to fetch"),
		new TypeError("Cannot read properties of undefined"),
		new Error("Failed to fetch dynamically imported module: synthetic-business-error"),
		null,
	])("does not classify an unrelated error as module transport", (error) => {
		expect(routeErrorKind(error)).toBe("unexpected");
	});
});
