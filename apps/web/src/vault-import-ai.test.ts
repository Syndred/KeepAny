import { afterEach, describe, expect, it, vi } from "vitest";
import { type AiConnection, generateAiText } from "../../../packages/ai/src";
import {
	requestVaultImportAiRecognition,
	VAULT_IMPORT_AI_MAX_CHARS,
	VAULT_IMPORT_AI_MAX_LINES,
	VAULT_IMPORT_AI_MAX_OUTPUT_TOKENS,
} from "./vault-import-ai";

vi.mock("../../../packages/ai/src", () => ({ generateAiText: vi.fn() }));
const connection: AiConnection = {
	provider: "deepseek",
	baseURL: "https://api.deepseek.com",
	model: "synthetic",
	apiKey: "synthetic-key",
};
type Ref = {
	line: number;
	endLine?: number;
	substring?: string;
	encoding?: "json-string";
};
const record = (
	value: Partial<
		Record<"title" | "username" | "password" | "url" | "notes", Ref | null>
	> & { usernameAliases?: Ref[] },
) => ({
	title: null,
	username: null,
	password: null,
	url: null,
	notes: null,
	...value,
});
function answer(records: unknown[], ignoredLines: number[] = []) {
	vi.mocked(generateAiText).mockResolvedValue({
		text: JSON.stringify({ records, ignoredLines }),
		usage: { inputTokens: null, outputTokens: null },
		model: null,
	});
}
afterEach(() => vi.resetAllMocks());

describe("configured AI password recognition", () => {
	it("extracts email, handle and phone alternatives only from individually proven source references", async () => {
		const source =
			"网站=Example\n邮箱=reader@example.test\n用户名=synthetic-handle\n手机号=+15550123456\n密码=synthetic-password";
		answer([
			record({
				title: { line: 1, substring: "Example" },
				username: { line: 2, substring: "reader@example.test" },
				usernameAliases: [
					{ line: 3, substring: "synthetic-handle" },
					{ line: 4, substring: "+15550123456" },
				],
				password: { line: 5, substring: "synthetic-password" },
			}),
		]);
		const result = await requestVaultImportAiRecognition(connection, source);
		expect(result.issues).toEqual([]);
		expect(result.candidates[0].draft).toMatchObject({
			username: "reader@example.test",
			usernameAliases: ["synthetic-handle", "+15550123456"],
		});
		expect(result.candidates[0].sourceUsernameAliases).toEqual(
			["synthetic-handle", "+15550123456"].map((text, index) => ({
				start: source.indexOf(text),
				end: source.indexOf(text) + text.length,
				line: index + 3,
				endLine: index + 3,
			})),
		);
	});
	it("keeps separate platform accounts and their alternatives in separate records", async () => {
		const source =
			"Example\none@example.test\none-handle\none-secret\ntwo@example.test\n+15550120002\ntwo-secret\nOther\nthird@example.test\nthird-handle\nthird-secret";
		answer([
			record({
				title: { line: 1 },
				username: { line: 2 },
				usernameAliases: [{ line: 3 }],
				password: { line: 4 },
			}),
			record({
				title: { line: 1 },
				username: { line: 5 },
				usernameAliases: [{ line: 6 }],
				password: { line: 7 },
			}),
			record({
				title: { line: 8 },
				username: { line: 9 },
				usernameAliases: [{ line: 10 }],
				password: { line: 11 },
			}),
		]);
		const result = await requestVaultImportAiRecognition(connection, source);
		expect(result.issues).toEqual([]);
		expect(
			result.candidates.map(({ draft }) => [
				draft.title,
				draft.username,
				draft.usernameAliases,
				draft.password,
			]),
		).toEqual([
			["Example", "one@example.test", ["one-handle"], "one-secret"],
			["Example", "two@example.test", ["+15550120002"], "two-secret"],
			["Other", "third@example.test", ["third-handle"], "third-secret"],
		]);
	});
	it("preserves exact quoted alias characters and never infers aliases from repeated username labels", async () => {
		const alias = "  Synthetic handle;|  ";
		const quoted = JSON.stringify(alias);
		answer([
			record({
				title: { line: 1 },
				username: { line: 2, substring: "reader@example.test" },
				usernameAliases: [
					{ line: 3, substring: quoted, encoding: "json-string" },
				],
				password: { line: 4 },
			}),
		]);
		const result = await requestVaultImportAiRecognition(
			connection,
			`Example\nusername=reader@example.test\nusername=${quoted}\nsynthetic-password`,
		);
		expect(result.issues).toEqual([]);
		expect(result.candidates[0].draft.usernameAliases).toEqual([alias]);
		answer([
			record({
				title: { line: 1 },
				username: { line: 2, substring: "reader@example.test" },
				password: { line: 4 },
			}),
		]);
		const missingAlias = await requestVaultImportAiRecognition(
			connection,
			`Example\nusername=reader@example.test\nusername=${quoted}\nsynthetic-password`,
		);
		expect(missingAlias.candidates[0].draft).not.toHaveProperty(
			"usernameAliases",
		);
		expect(missingAlias.candidates[0]).not.toHaveProperty(
			"sourceUsernameAliases",
		);
		expect(missingAlias.issues).toContainEqual({
			lineNumber: 3,
			code: "unrecognized-line",
		});
	});
	it.each([
		{ line: 0 },
		{ line: 9 },
		{ line: 3, endLine: 2 },
		{ line: 3, substring: "invented" },
		{ line: 3, substring: "repeated" },
		{ line: 1 },
		{ line: 2 },
		{ line: 4 },
	])(
		"rejects invalid, ambiguous or overlapping alias references without consuming the record: %j",
		async (alias) => {
			const source =
				"Example\nreader@example.test\nrepeated repeated\nsynthetic-password";
			answer([
				record({
					title: { line: 1 },
					username: { line: 2 },
					usernameAliases: [alias],
					password: { line: 4 },
				}),
			]);
			const result = await requestVaultImportAiRecognition(connection, source);
			expect(result.candidates).toEqual([]);
			expect(
				result.issues.some(
					({ code }) => code === "invalid-field" || code === "ambiguous-line",
				),
			).toBe(true);
			for (const lineNumber of [1, 2, 3, 4])
				expect(result.issues).toContainEqual({
					lineNumber,
					code: "unrecognized-line",
				});
		},
	);
	it("rejects repeated alias spans and reserves accepted aliases against later entry credentials", async () => {
		const source =
			"Example\nreader@example.test\nsynthetic-handle\nsynthetic-password\nsecond-secret";
		answer([
			record({
				title: { line: 1 },
				username: { line: 2 },
				usernameAliases: [{ line: 3 }, { line: 3 }],
				password: { line: 4 },
			}),
		]);
		expect(
			(await requestVaultImportAiRecognition(connection, source)).candidates,
		).toEqual([]);
		answer([
			record({
				title: { line: 1 },
				username: { line: 2 },
				usernameAliases: [{ line: 3 }],
				password: { line: 4 },
			}),
			record({
				title: { line: 1 },
				username: { line: 3 },
				password: { line: 5 },
			}),
		]);
		const result = await requestVaultImportAiRecognition(connection, source);
		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0].draft.usernameAliases).toEqual([
			"synthetic-handle",
		]);
		expect(result.issues).toEqual(
			expect.arrayContaining([
				{ lineNumber: 3, code: "ambiguous-line" },
				{ lineNumber: 5, code: "unrecognized-line" },
			]),
		);
	});
	it("rejects excessive aliases and unsafe alias values without covering any source span", async () => {
		const aliases = Array.from(
			{ length: 21 },
			(_, index) => `synthetic-alias-${index}`,
		);
		const source = [
			"Example",
			"reader@example.test",
			"synthetic-password",
			...aliases,
		].join("\n");
		answer([
			record({
				title: { line: 1 },
				username: { line: 2 },
				password: { line: 3 },
				usernameAliases: aliases.map((_, index) => ({ line: index + 4 })),
			}),
		]);
		await expect(
			requestVaultImportAiRecognition(connection, source),
		).rejects.toThrow(/^vault-import-ai-invalid-response$/);
		for (const alias of ["x".repeat(1025), "synthetic\0alias"]) {
			answer([
				record({
					title: { line: 1 },
					username: { line: 2 },
					password: { line: 3 },
					usernameAliases: [{ line: 4 }],
				}),
			]);
			const result = await requestVaultImportAiRecognition(
				connection,
				`Example\nreader@example.test\nsynthetic-password\n${alias}`,
			);
			expect(result.candidates).toEqual([]);
			expect(result.issues).toContainEqual({
				lineNumber: 1,
				code: "invalid-field",
			});
			for (const lineNumber of [1, 2, 3, 4])
				expect(result.issues).toContainEqual({
					lineNumber,
					code: "unrecognized-line",
				});
		}
	});
	it("sends exactly the current source lines through the existing client with a bounded output", async () => {
		const controller = new AbortController();
		const source = "Example\r\nreader@example.test\r\n  synthetic;|,!?  ";
		answer([
			record({
				title: { line: 1 },
				username: { line: 2 },
				password: { line: 3 },
			}),
		]);
		const result = await requestVaultImportAiRecognition(
			connection,
			source,
			controller.signal,
		);
		expect(generateAiText).toHaveBeenCalledTimes(1);
		const [usedConnection, options] = vi.mocked(generateAiText).mock.calls[0];
		expect(usedConnection).toBe(connection);
		expect(options).toMatchObject({
			json: true,
			maxOutputTokens: VAULT_IMPORT_AI_MAX_OUTPUT_TOKENS,
			signal: controller.signal,
		});
		expect(JSON.parse(options.prompt)).toEqual({
			lines: [
				{ line: 1, text: "Example", ending: "\r\n" },
				{ line: 2, text: "reader@example.test", ending: "\r\n" },
				{ line: 3, text: "  synthetic;|,!?  ", ending: "" },
			],
		});
		expect(result.issues).toEqual([]);
		expect(result.candidates[0].draft).not.toHaveProperty("usernameAliases");
		expect(result.candidates[0]).not.toHaveProperty("sourceUsernameAliases");
		expect(result.candidates[0].sourceFields).toEqual({
			title: { start: 0, end: 7, line: 1, endLine: 1 },
			username: { start: 9, end: 28, line: 2, endLine: 2 },
			password: { start: 30, end: source.length, line: 3, endLine: 3 },
		});
		expect(result.candidates[0]).toMatchObject({
			sourceLine: 1,
			aiEligible: false,
			needsReview: true,
			draft: {
				title: "Example",
				username: "reader@example.test",
				password: "  synthetic;|,!?  ",
			},
		});
	});
	it("preserves mixed line endings, multiline password, BOM metadata and original note punctuation", async () => {
		const source =
			"\uFEFFExample\nreader@example.test\r\n  first\rsecond  \nprivate;|, note";
		answer([
			record({
				title: { line: 1 },
				username: { line: 2 },
				password: { line: 3, endLine: 4 },
				notes: { line: 5 },
			}),
		]);
		const result = await requestVaultImportAiRecognition(connection, source);
		expect(result.issues).toEqual([]);
		expect(result.candidates[0].draft).toMatchObject({
			title: "Example",
			password: "  first\rsecond  ",
			notes: "private;|, note",
		});
	});
	it("restores full-line whitespace when the model supplies a trimmed whole value", async () => {
		answer([
			record({
				title: { line: 1 },
				password: { line: 2, substring: "synthetic pass;" },
			}),
		]);
		const result = await requestVaultImportAiRecognition(
			connection,
			"Example\n  synthetic pass;  ",
		);
		expect(result.candidates[0].draft.password).toBe("  synthetic pass;  ");
		expect(result.issues).toEqual([]);
	});
	it("extracts explicitly labelled same-line values and lets the existing parser prove residual syntax", async () => {
		const source =
			"title=Example;username=reader@example.test;password=synthetic;notes=sample";
		answer([
			record({
				title: { line: 1, substring: "Example" },
				username: { line: 1, substring: "reader@example.test" },
				password: { line: 1, substring: "synthetic" },
				notes: { line: 1, substring: "sample" },
			}),
		]);
		const result = await requestVaultImportAiRecognition(connection, source);
		expect(result.candidates[0].draft).toMatchObject({
			username: "reader@example.test",
			password: "synthetic",
			notes: "sample",
		});
		expect(result.issues).toEqual([]);
	});
	it("proves ordinary separate labels without duplicating alias rules", async () => {
		answer([
			record({
				title: { line: 1, substring: "Example" },
				username: { line: 2, substring: "reader@example.test" },
				password: { line: 3, substring: "synthetic" },
			}),
		]);
		const result = await requestVaultImportAiRecognition(
			connection,
			"网站=Example\n登录账号=reader@example.test\n登录密码=synthetic",
		);
		expect(result.candidates).toHaveLength(1);
		expect(result.issues).toEqual([]);
	});
	it("decodes explicit JSON quoting locally from an exact quoted source reference", async () => {
		const value = '  first\nsecond\\tail;|,"  ';
		const quoted = JSON.stringify(value);
		answer([
			record({
				title: { line: 1 },
				password: { line: 2, substring: quoted, encoding: "json-string" },
			}),
		]);
		const result = await requestVaultImportAiRecognition(
			connection,
			`Example\npassword=${quoted}`,
		);
		expect(result.candidates[0].draft.password).toBe(value);
		expect(result.issues).toEqual([]);
	});
	it("rejects invalid or non-string JSON decoding and preserves literal unlabelled quotes", async () => {
		for (const value of ["broken", "123", "{}", "[1]", '"broken\\x"']) {
			answer([
				record({
					title: { line: 1 },
					password: { line: 2, encoding: "json-string" },
				}),
			]);
			expect(
				(await requestVaultImportAiRecognition(connection, `Example\n${value}`))
					.candidates,
			).toEqual([]);
		}
		answer([record({ title: { line: 1 }, password: { line: 2 } })]);
		expect(
			(
				await requestVaultImportAiRecognition(
					connection,
					'Example\n"literal\\nquotes"',
				)
			).candidates[0].draft.password,
		).toBe('"literal\\nquotes"');
	});
	it("supports unordered fields and accounts under a shared service heading", async () => {
		answer([
			record({
				title: { line: 1 },
				password: { line: 2 },
				username: { line: 3 },
			}),
			record({
				title: { line: 1 },
				username: { line: 4 },
				password: { line: 5 },
			}),
		]);
		const result = await requestVaultImportAiRecognition(
			connection,
			"Example\nfirst-synthetic\none@example.test\ntwo@example.test\nsecond-synthetic",
		);
		expect(result.issues).toEqual([]);
		expect(
			result.candidates.map(({ id, draft }) => [
				id,
				draft.username,
				draft.password,
			]),
		).toEqual([
			["vault-import-1", "one@example.test", "first-synthetic"],
			["vault-import-2", "two@example.test", "second-synthetic"],
		]);
	});
	it("keeps URL query/hash values and derives a title using existing local validation", async () => {
		answer([record({ url: { line: 1 }, password: { line: 2 } })]);
		const result = await requestVaultImportAiRecognition(
			connection,
			"https://example.test/login?token=synthetic#sample\nsynthetic-pass",
		);
		expect(result.candidates[0].draft).toMatchObject({
			title: "example.test",
			url: "https://example.test/login?token=synthetic#sample",
		});
	});
	it("keeps omitted and model-ignored nonempty lines visible, even if they might be secrets", async () => {
		answer([record({ title: { line: 1 }, password: { line: 2 } })], [3, 4]);
		const result = await requestVaultImportAiRecognition(
			connection,
			"Example\nsynthetic\n---\nother@example.test\nunknown-synthetic",
		);
		expect(result.issues).toEqual(
			[3, 4, 5].map((lineNumber) => ({
				lineNumber,
				code: "unrecognized-line",
			})),
		);
	});
	it("does not let a broad reference range hide lines outside the actual substring", async () => {
		answer([
			record({
				title: { line: 1, endLine: 3, substring: "Example" },
				password: { line: 4 },
			}),
		]);
		const result = await requestVaultImportAiRecognition(
			connection,
			"unused-one\nunused-two\nExample\nsynthetic",
		);
		expect(result.candidates[0].sourceLine).toBe(3);
		expect(result.issues).toEqual(
			[1, 2].map((lineNumber) => ({ lineNumber, code: "unrecognized-line" })),
		);
	});
	it("keeps unknown same-line remnants rather than silently dropping another credential", async () => {
		answer([
			record({
				title: { line: 1 },
				username: { line: 2, substring: "one@example.test" },
				password: { line: 3 },
			}),
		]);
		const result = await requestVaultImportAiRecognition(
			connection,
			"Example\none@example.test two@example.test\nsynthetic",
		);
		expect(result.candidates).toHaveLength(1);
		expect(result.issues).toEqual([
			{ lineNumber: 2, code: "unrecognized-line" },
		]);
	});
	it.each([
		{ line: 2, substring: "invented" },
		{ line: 2, substring: "synthetic" },
		{ line: 2, substring: "" },
		{ line: 0 },
		{ line: 9 },
		{ line: 2, endLine: 1 },
	])(
		"rejects invented, ambiguous or invalid references without echoing them: %j",
		async (password) => {
			answer([record({ title: { line: 1 }, password })]);
			const result = await requestVaultImportAiRecognition(
				connection,
				"Example\nsynthetic synthetic",
			);
			expect(result.candidates).toEqual([]);
			expect(result.issues.some(({ code }) => code === "invalid-field")).toBe(
				true,
			);
			expect(result.issues).toContainEqual({
				lineNumber: 2,
				code: "unrecognized-line",
			});
		},
	);
	it("rejects overlapping fields and repeated credential spans but permits shared service text", async () => {
		answer([
			record({
				title: { line: 1 },
				username: { line: 2 },
				password: { line: 2 },
			}),
		]);
		expect(
			(await requestVaultImportAiRecognition(connection, "Example\nsynthetic"))
				.candidates,
		).toEqual([]);
		answer([
			record({ title: { line: 1 }, password: { line: 2 } }),
			record({ title: { line: 1 }, password: { line: 2 } }),
		]);
		const result = await requestVaultImportAiRecognition(
			connection,
			"Example\nsynthetic",
		);
		expect(result.candidates).toHaveLength(1);
		expect(result.issues).toContainEqual({
			lineNumber: 2,
			code: "ambiguous-line",
		});
	});
	it("keeps missing fields and invalid URLs editable without duplicate unrecognized-line warnings", async () => {
		answer([
			record({ title: { line: 1 } }),
			record({ password: { line: 2 } }),
			record({ title: { line: 3 }, password: { line: 4 }, url: { line: 5 } }),
		]);
		const result = await requestVaultImportAiRecognition(
			connection,
			"Example\nsynthetic-one\nOther\nsynthetic-two\nhttps://user:synthetic@example.test",
		);
		expect(result.candidates).toHaveLength(3);
		expect(result.candidates.map(({ reviewIssues }) => reviewIssues)).toEqual([
			[{ lineNumber: 1, code: "missing-password" }],
			[{ lineNumber: 2, code: "missing-identity" }],
			[{ lineNumber: 5, code: "invalid-url" }],
		]);
		expect(result.candidates[0].draft).toMatchObject({
			title: "Example",
			password: "",
		});
		expect(result.candidates[1].draft).toMatchObject({
			title: "",
			password: "synthetic-one",
		});
		expect(result.candidates[2].draft.url).toBe(
			"https://user:synthetic@example.test",
		);
		expect(result.issues).toEqual([]);
	});
	it("retains labelled incomplete entries and reports only genuinely unassigned content", async () => {
		answer([
			record({
				title: { line: 1, substring: "Example" },
				username: { line: 2, substring: "reader@example.test" },
			}),
		]);
		const result = await requestVaultImportAiRecognition(
			connection,
			"网站=Example\n登录账号=reader@example.test\nunknown-synthetic-secret",
		);
		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0].reviewIssues).toEqual([
			{ lineNumber: 1, code: "missing-password" },
		]);
		expect(result.issues).toEqual([
			{ lineNumber: 3, code: "unrecognized-line" },
		]);
	});
	it("keeps incomplete credential spans reserved and rejects unsafe oversized or NUL fields", async () => {
		answer([
			record({ username: { line: 1 } }),
			record({ title: { line: 2 }, password: { line: 1 } }),
			record({ title: { line: 3 } }),
			record({ title: { line: 4 }, notes: { line: 5 } }),
		]);
		const result = await requestVaultImportAiRecognition(
			connection,
			`reader@example.test\nExample\n${"x".repeat(257)}\nOther\nunsafe\0synthetic`,
		);
		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0].draft.username).toBe("reader@example.test");
		expect(result.issues).toEqual(
			expect.arrayContaining([
				{ lineNumber: 1, code: "ambiguous-line" },
				{ lineNumber: 3, code: "invalid-field" },
				{ lineNumber: 4, code: "invalid-field" },
				{ lineNumber: 5, code: "unrecognized-line" },
			]),
		);
	});
	it("rejects unsupported response fields, malformed JSON, excess records and response limits with safe codes", async () => {
		for (const text of [
			"synthetic-response-not-json",
			JSON.stringify({
				records: [
					{
						...record({ title: { line: 1 }, password: { line: 2 } }),
						invented: "synthetic-response",
					},
				],
				ignoredLines: [],
			}),
			JSON.stringify({
				records: [
					record({ title: { line: 1, arbitrary: "synthetic" } as Ref }),
				],
				ignoredLines: [],
			}),
			JSON.stringify({ records: [], ignoredLines: [99] }),
			JSON.stringify({
				records: Array.from({ length: 201 }, () => record({})),
				ignoredLines: [],
			}),
			"x".repeat(80_001),
		]) {
			vi.mocked(generateAiText).mockResolvedValue({
				text,
				usage: { inputTokens: null, outputTokens: null },
				model: null,
			});
			await expect(
				requestVaultImportAiRecognition(connection, "Example\nsynthetic"),
			).rejects.toThrow(/^vault-import-ai-invalid-response$/);
		}
	});
	it("accepts a fenced JSON response but never a fabricated field string", async () => {
		vi.mocked(generateAiText).mockResolvedValue({
			text: `\`\`\`json\n${JSON.stringify({ records: [record({ title: { line: 1 }, password: { line: 2 } })], ignoredLines: [] })}\n\`\`\``,
			usage: { inputTokens: null, outputTokens: null },
			model: null,
		});
		expect(
			(await requestVaultImportAiRecognition(connection, "Example\nsynthetic"))
				.candidates,
		).toHaveLength(1);
		answer([
			record({
				title: { line: 1 },
				password: "invented-value" as unknown as Ref,
			}),
		]);
		await expect(
			requestVaultImportAiRecognition(connection, "Example\nsynthetic"),
		).rejects.toThrow(/^vault-import-ai-invalid-response$/);
	});
	it("checks source limits before the provider request and skips empty sources", async () => {
		await expect(
			requestVaultImportAiRecognition(
				connection,
				"x".repeat(VAULT_IMPORT_AI_MAX_CHARS + 1),
			),
		).rejects.toThrow(/^vault-import-ai-limit$/);
		await expect(
			requestVaultImportAiRecognition(
				connection,
				"\n".repeat(VAULT_IMPORT_AI_MAX_LINES),
			),
		).rejects.toThrow(/^vault-import-ai-limit$/);
		expect(
			await requestVaultImportAiRecognition(connection, "\r\n \n"),
		).toEqual({ candidates: [], issues: [] });
		expect(generateAiText).not.toHaveBeenCalled();
	});
	it("sanitizes provider failures and supports cancellation before and after a response", async () => {
		vi.mocked(generateAiText).mockRejectedValue(
			Error("synthetic request and secret response"),
		);
		await expect(
			requestVaultImportAiRecognition(connection, "Example\nsynthetic"),
		).rejects.toThrow(/^vault-import-ai-failed$/);
		const controller = new AbortController();
		controller.abort();
		await expect(
			requestVaultImportAiRecognition(
				connection,
				"Example\nsynthetic",
				controller.signal,
			),
		).rejects.toThrow(/^vault-import-ai-cancelled$/);
		const late = new AbortController();
		vi.mocked(generateAiText).mockImplementation(async () => {
			late.abort();
			return {
				text: "secret response never parsed",
				usage: { inputTokens: null, outputTokens: null },
				model: null,
			};
		});
		await expect(
			requestVaultImportAiRecognition(
				connection,
				"Example\nsynthetic",
				late.signal,
			),
		).rejects.toThrow(/^vault-import-ai-cancelled$/);
	});
});
