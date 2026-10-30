import { describe, expect, it } from "vitest";
import type { VaultEntrySummary } from "../../../packages/password-vault/src";
import { accountHttpUrl, accountLoginChoices, nextAccountLogin, preferredAccountLogin } from "./account-login-choices";

const entry = (id: string, username: string, aliases: string[] = []): VaultEntrySummary => ({ id, username, usernameAliases: aliases, title: id, url: `https://${id}.example.test/`, linkedAssetIds: ["account"], modifiedAt: "2026-10-30T00:00:00Z", historyCount: 0 });
describe("compact account login selection", () => {
	it("cycles exact identifiers and entries without confusing their password owner", () => {
		const a = entry("first", "Main@EXAMPLE.test", ["main@example.test", "Main@EXAMPLE.test"]), b = entry("second", "backup@example.test");
		const choices = accountLoginChoices([a, b]);
		expect(choices.map((choice) => [choice.username, choice.entry.id])).toEqual([["Main@EXAMPLE.test", "first"], ["main@example.test", "first"], ["backup@example.test", "second"]]);
		expect(nextAccountLogin(choices, choices[0].key)).toBe(choices[1]);
		expect(nextAccountLogin(choices, choices[2].key)).toBe(choices[0]);
		expect(nextAccountLogin([], "missing")).toBeUndefined();
	});
	it("finds non-default matching logins and falls back safely after removal", () => {
		const choices = accountLoginChoices([entry("first", "main@example.test"), entry("second", "backup@example.test")]);
		expect(preferredAccountLogin(choices, "", ["backup"])).toBe(choices[1]);
		expect(preferredAccountLogin(choices, "", [], "second")).toBe(choices[1]);
		expect(preferredAccountLogin(choices, "removed")).toBe(choices[0]);
		expect(preferredAccountLogin([], "removed")).toBeUndefined();
	});
	it("retains password-only entries and chooses an exact available identifier", () => {
		expect(accountLoginChoices([entry("empty", "")])[0].username).toBe("");
		expect(accountLoginChoices([entry("alias", "", ["one", "one", "two"]) ]).map((choice) => choice.username)).toEqual(["one", "two"]);
	});
	it("rejects executable and malformed URLs while retaining HTTP(S)", () => {
		for (const url of ["javascript:alert(1)", "data:text/html,test", "file:///secret", "not a url", ""]) expect(accountHttpUrl(url)).toBe("");
		expect(accountHttpUrl("https://example.test/path?q=one#part")).toBe("https://example.test/path?q=one#part");
	});
});
