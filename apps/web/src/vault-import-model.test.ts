import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiConnection } from "../../../packages/ai/src";
import {
	applyVaultImportAiTitles,
	buildVaultImportAiPreview,
	parseVaultImportText,
	requestVaultImportAiTitles,
	VAULT_IMPORT_MAX_BYTES,
	type VaultImportCandidate,
	validateVaultImportFields,
	withFilledVaultIdentifiers,
} from "./vault-import-model";

vi.mock("../../../packages/ai/src", () => ({ generateAiText: vi.fn() }));

import { generateAiText } from "../../../packages/ai/src";

const connection: AiConnection = {
	provider: "deepseek",
	apiKey: "mock-key",
	baseURL: "https://api.deepseek.com",
	model: "synthetic",
};
const text =
	"标题=Example\n账号=reader@example.test\n密码=mock-secret-你好!\n网址=https://example.test/login?token=mock-query-secret#mock-fragment-secret\n备注=mock-note-secret";
const candidates = () => parseVaultImportText(text).candidates;
afterEach(() => vi.resetAllMocks());

describe("local password paste parsing", () => {
	it("keeps punctuation in explicit passwordless notes and still separates following fields", () => {
		const result = parseVaultImportText(
			"名称=Notion\n账号=demo.reader@gmail.com\n备注=使用 Google 登录，无独立密码; 请保留备注。",
		);
		expect(result.issues).toEqual([]);
		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0]).toMatchObject({
			needsReview: true,
			draft: {
				title: "Notion",
				username: "demo.reader@gmail.com",
				password: "",
				notes: "使用 Google 登录，无独立密码; 请保留备注。",
			},
		});
		const inline = parseVaultImportText(
			"title=Notion;username=demo@example.test;notes=One, two;password=explicit",
		);
		expect(inline.candidates[0].draft).toMatchObject({
			notes: "One, two",
			password: "explicit",
		});
	});
	it("accepts passwordless sign-ins and requires explicit review without missing-field errors", () => {
		for (const input of [
			"title=Example;username=reader@example.test;notes=Google sign-in",
			"title=Example\npassword=",
			"name,username,password,notes\nExample,reader@example.test,,Google sign-in",
			"name,email,notes\nExample,reader@example.test,Google sign-in",
		]) {
			const result = parseVaultImportText(input);
			expect(result.issues).toEqual([]);
			expect(result.candidates).toHaveLength(1);
			expect(result.candidates[0]).toMatchObject({
				needsReview: true,
				draft: { title: "Example", password: "" },
			});
		}
		const validated = validateVaultImportFields({
			title: "Example",
			username: "reader@example.test",
			notes: "Google sign-in",
		});
		expect(validated.issues).toEqual([]);
		expect(validated.candidates[0]).toMatchObject({
			needsReview: true,
			draft: { password: "", notes: "Google sign-in" },
		});
	});
	it("retains exact alternative identifiers while ignoring empty optional form rows", () => {
		const values = {
			title: "App",
			username: "main@example.test",
			password: "synthetic",
			usernameAliases: [
				"main@example.test",
				"",
				"  ",
				"LoginName",
				"loginname",
				" LoginName ",
				"LoginName",
			],
		};
		const result = validateVaultImportFields(values);
		expect(result.issues).toEqual([]);
		expect(result.candidates[0].draft.usernameAliases).toEqual([
			"LoginName",
			"loginname",
			" LoginName ",
		]);
		expect(values.usernameAliases).toHaveLength(7);
		expect(
			withFilledVaultIdentifiers({
				...result.candidates[0].draft,
				usernameAliases: ["LoginName", "", "  "],
			}).usernameAliases,
		).toEqual(["LoginName"]);
		for (const aliases of [
			Array(1),
			["bad\0value"],
			["x".repeat(1025)],
			Array(21).fill("value"),
		]) {
			const invalid = validateVaultImportFields({
				...values,
				usernameAliases: aliases,
			});
			expect(invalid.candidates).toEqual([]);
			expect(invalid.issues).toEqual([
				{ lineNumber: 1, code: "invalid-field" },
			]);
		}
	});
	it("filters alternative login identifiers and their encodings from domain-only AI", () => {
		const rows = candidates();
		const identifier = "synthetic-alias-token";
		const hex = [...new TextEncoder().encode(identifier)]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join("");
		const base64 = btoa(identifier).replace(/=+$/, "").toLowerCase();
		const preview = buildVaultImportAiPreview([
			...rows,
			...([identifier, hex, base64] as const).map((host, index) => ({
				...rows[0],
				id: `vault-import-${index + 2}`,
				draft: { ...rows[0].draft, url: `https://${host}.example.test` },
			})),
			{
				...rows[0],
				id: "vault-manual-1",
				aiEligible: false,
				draft: { ...rows[0].draft, usernameAliases: [identifier] },
			},
		]);
		expect(preview.records).toEqual([
			{ id: "vault-import-1", host: "example.test" },
		]);
	});
	it("extracts explicit fields without changing password, account, notes or query/hash", () => {
		const result = parseVaultImportText(text);
		expect(result.issues).toEqual([]);
		expect(result.candidates[0]).toMatchObject({
			id: "vault-import-1",
			sourceLine: 1,
			aiEligible: true,
			draft: {
				title: "Example",
				username: "reader@example.test",
				password: "mock-secret-你好!",
				url: "https://example.test/login?token=mock-query-secret#mock-fragment-secret",
				notes: "mock-note-secret",
				linkedAssetIds: [],
			},
		});
		expect(
			parseVaultImportText("标题=A\n密码=  保留空格  ").candidates[0].draft
				.password,
		).toBe("  保留空格  ");
	});
	it("accepts explicit blocks with no blank separator and complete single-line lists", () => {
		const result = parseVaultImportText(
			"网站=A\n账号=u\n密码=p\n网站=B\n账号=v\n密码=q\n\n网站=C;账号=w;密码=r",
		);
		expect(
			result.candidates.map(({ draft }) => [
				draft.title,
				draft.username,
				draft.password,
			]),
		).toEqual([
			["A", "u", "p"],
			["B", "v", "q"],
			["C", "w", "r"],
		]);
		expect(result.issues).toEqual([]);
	});
	it("keeps an unlabelled service, email and password as an unselected local review candidate", () => {
		const result = parseVaultImportText(
			"outlook\ndemo.one@example.test\nSyntheticPass!42\ndemo.two@example.test",
		);
		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0]).toMatchObject({
			sourceLine: 1,
			needsReview: true,
			aiEligible: false,
			draft: {
				title: "outlook",
				username: "demo.one@example.test",
				password: "SyntheticPass!42",
			},
		});
		expect(result.issues).toEqual([
			{ lineNumber: 4, code: "unrecognized-line" },
		]);
		expect(buildVaultImportAiPreview(result.candidates)).toEqual({
			records: [],
		});
	});
	it("preserves unlabelled passwords literally and separates repeated email-anchored groups", () => {
		const result = parseVaultImportText(
			"1. Outlook\ndemo.one@example.test\n  a;b|c,密码：value  \nhttps://github.com/login\ndemo.two@example.test\nsecond-pass",
		);
		expect(result.issues).toEqual([]);
		expect(
			result.candidates.map(
				({ sourceLine, draft, needsReview, aiEligible }) => ({
					sourceLine,
					title: draft.title,
					username: draft.username,
					password: draft.password,
					url: draft.url,
					needsReview,
					aiEligible,
				}),
			),
		).toEqual([
			{
				sourceLine: 1,
				title: "Outlook",
				username: "demo.one@example.test",
				password: "  a;b|c,密码：value  ",
				url: "",
				needsReview: true,
				aiEligible: false,
			},
			{
				sourceLine: 4,
				title: "github.com",
				username: "demo.two@example.test",
				password: "second-pass",
				url: "https://github.com/login",
				needsReview: true,
				aiEligible: false,
			},
		]);
	});
	it("leaves incomplete or ambiguous unlabelled groups for review instead of borrowing the next identity", () => {
		for (const input of [
			"Outlook\ndemo.one@example.test",
			"Outlook\ndemo.one@example.test\ndemo.two@example.test",
			"Outlook\ndemo.one@example.test\n2. GitHub\ndemo.two@example.test",
			"Outlook\ndemo-user\npassword-value",
			"Outlook\ndemo.one@example.test\n\npassword-value",
		]) {
			const result = parseVaultImportText(input);
			expect(result.candidates).toEqual([]);
			expect(result.issues.length).toBeGreaterThan(0);
		}
	});
	it("recognizes a 173-line synthetic list while retaining the trailing unmapped email and text", () => {
		const lines = Array.from({ length: 57 }, (_, index) => [
			`Synthetic service ${index + 1}`,
			`demo.${index + 1}@example.test`,
			`SyntheticPass!${index + 1};|,`,
		]).flat();
		lines.push("extra.account@example.test", "Unmapped source line");
		expect(lines).toHaveLength(173);
		const result = parseVaultImportText(lines.join("\n"));
		expect(result.candidates).toHaveLength(57);
		expect(
			result.candidates.every(
				({ needsReview, aiEligible }) => needsReview && !aiEligible,
			),
		).toBe(true);
		expect(result.candidates[56]).toMatchObject({
			sourceLine: 169,
			draft: {
				username: "demo.57@example.test",
				password: "SyntheticPass!57;|,",
			},
		});
		expect(result.issues).toEqual([
			{ lineNumber: 172, code: "unrecognized-line" },
			{ lineNumber: 173, code: "unrecognized-line" },
		]);
	});
	it("accepts common login labels, Markdown groups and explicitly labelled account-password lines", () => {
		const result = parseVaultImportText(
			"## GitHub\n- **登录账号**：demo.one@example.test 登录密码：first-pass\n---\n2. Outlook\n账户名：demo.two@example.test\n登陆密码：second-pass\n网址：https://outlook.example.test",
		);
		expect(result.issues).toEqual([]);
		expect(
			result.candidates.map(({ draft }) => [
				draft.title,
				draft.username,
				draft.password,
			]),
		).toEqual([
			["GitHub", "demo.one@example.test", "first-pass"],
			["Outlook", "demo.two@example.test", "second-pass"],
		]);
	});
	it("rejects trailing delimiter ambiguity instead of silently dropping a password character", () => {
		for (const password of ["p;", "p|", "p,", "p，", "p\t"]) {
			const result = parseVaultImportText(
				`title=Example\npassword=${password}`,
			);
			expect(result.candidates).toEqual([]);
			expect(result.issues).toContainEqual({
				lineNumber: 2,
				code: "ambiguous-line",
			});
		}
	});
	it("never silently splits a label-looking password suffix at a space", () => {
		for (const suffix of [
			"username:demo",
			"url:https://example.test",
			"备注:private-note",
			"登录账号：demo",
		]) {
			const password = `p ${suffix}`;
			for (const source of [
				`title=Example\npassword=${password}`,
				`title=Example\nusername=reader password=${password}`,
			]) {
				const result = parseVaultImportText(source);
				expect(result.candidates).toEqual([]);
				expect(result.issues).toContainEqual({
					lineNumber: 2,
					code: "ambiguous-line",
				});
			}
			const quoted = parseVaultImportText(
				`title=Example\nusername=reader password=${JSON.stringify(password)}`,
			);
			expect(quoted.issues).toEqual([]);
			expect(quoted.candidates[0].draft.password).toBe(password);
		}
		expect(
			parseVaultImportText(
				"title=Example\nusername=reader password=  literal pass  ",
			).candidates[0].draft.password,
		).toBe("  literal pass  ");
	});
	it("treats explicit Chinese website URLs as URLs and plain service names as titles", () => {
		const result = parseVaultImportText(
			"网站=https://github.com/login\n账号=reader\n密码=first-secret\n\n网站=GitHub\n账号=other\n密码=second-secret\n\n网站=example.test:443/path\n密码=third-secret",
		);
		expect(result.issues).toEqual([]);
		expect(
			result.candidates.map(({ draft }) => [draft.title, draft.url]),
		).toEqual([
			["github.com", "https://github.com/login"],
			["GitHub", ""],
			["example.test", "https://example.test/path"],
		]);
		expect(buildVaultImportAiPreview(result.candidates).records).toEqual([
			{ id: "vault-import-1", host: "github.com" },
			{ id: "vault-import-3", host: "example.test" },
		]);
		expect(
			parseVaultImportText(
				"网站,账号,密码\nhttps://github.com,reader,password-value",
			).candidates[0].draft.url,
		).toBe("https://github.com/");
		expect(
			parseVaultImportText(
				"网站,名称,账号,密码\nhttps://github.com,GitHub登录,reader,password-value",
			).candidates[0].draft,
		).toMatchObject({ title: "GitHub登录", url: "https://github.com/" });
	});
	it("supports colon labels, TSV key lists and JSON quoted values", () => {
		const result = parseVaultImportText(
			'Title=Quoted;username="名字";password="  a;b|c,\\"d\\n尾  ";url=https://quoted.example.test\n\n标题：冒号\n密码：p\n\nname=Tab\tuser=user\tpassword=pwd',
		);
		expect(result.issues).toEqual([]);
		expect(result.candidates[0].draft.password).toBe('  a;b|c,"d\n尾  ');
		expect(result.candidates[1].draft.password).toBe("p");
		expect(result.candidates[2].draft.password).toBe("pwd");
	});
	it("preserves Chrome CSV commas, quotes, multiline credentials and leading/trailing Unicode spaces", () => {
		const result = parseVaultImportText(
			'\uFEFFname,url,username,password,note\r\nChrome,https://example.test,"名字,reader","  p,""quote""\n第二行  ",备注\r\nOther,https://other.example.test,reader2,"\u3000密码\u3000",',
		);
		expect(result.issues).toEqual([]);
		expect(result.candidates.map(({ draft }) => draft.password)).toEqual([
			'  p,"quote"\n第二行  ',
			"\u3000密码\u3000",
		]);
		expect(result.candidates[0].draft.username).toBe("名字,reader");
		expect(result.candidates[0].draft.notes).toBe("备注");
	});
	it("accepts Bitwarden login CSV while marking unknown secrets for local review and rejecting card rows", () => {
		const result = parseVaultImportText(
			"folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\nwork,1,login,Example,private,,0,https://example.test,user,mock-pass,\nwork,0,1,Other,,custom-secret,0,https://other.example.test,user2,mock-pass2,mock-totp\n,0,2,Card,,,,,,123,",
		);
		expect(result.candidates).toHaveLength(2);
		expect(result.candidates[0].aiEligible).toBe(true);
		expect(result.candidates[1].aiEligible).toBe(false);
		expect(result.issues).toEqual([
			{ lineNumber: 3, code: "unknown-field" },
			{ lineNumber: 4, code: "unsupported-type" },
		]);
	});
	it("accepts TSV and semicolon-delimited CSV without trimming password values", () => {
		for (const delimiter of ["\t", ";"]) {
			const result = parseVaultImportText(
				["name", "url", "username", "password"].join(delimiter) +
					"\n" +
					["Service", "https://example.test", "user", "  pass  "].join(
						delimiter,
					),
			);
			expect(result.issues).toEqual([]);
			expect(result.candidates[0].draft.password).toBe("  pass  ");
		}
	});
	it("retains repeated passwords as independent candidates and never merges identities", () => {
		const result = parseVaultImportText(
			"title=A;username=one;password=shared\ntitle=B;username=two;password=shared",
		);
		expect(
			result.candidates.map(({ id, draft }) => [
				id,
				draft.username,
				draft.password,
			]),
		).toEqual([
			["vault-import-1", "one", "shared"],
			["vault-import-2", "two", "shared"],
		]);
	});
	it("reports unclear text instead of guessing passwords or assigning a password across blocks", () => {
		const result = parseVaultImportText(
			"GitHub user pass\n\n标题=Explicit\n账号=reader\n\n密码=lonely\n\n标题=Known\n密码=actual\nunknown: leftovers",
		);
		expect(result.candidates).toHaveLength(2);
		expect(result.candidates[0]).toMatchObject({
			needsReview: true,
			draft: { title: "Explicit", username: "reader", password: "" },
		});
		expect(result.candidates[1]).toMatchObject({
			aiEligible: false,
			draft: { title: "Known", password: "actual" },
		});
		expect(result.issues.map(({ code }) => code)).toEqual([
			"unrecognized-line",
			"missing-identity",
			"unknown-field",
		]);
		expect(JSON.stringify(result.issues)).not.toContain("leftovers");
	});
	it("rejects partial same-line lists, duplicate fields, malformed quotes and missing required values", () => {
		for (const input of [
			"title=A;password=p;unclear",
			"title=A;password=p;secret=x",
			'title=A;password="broken',
			"title=A\npassword=one\npassword=two",
			"password=alone",
		]) {
			const result = parseVaultImportText(input);
			expect(result.candidates).toEqual([]);
			expect(result.issues.length).toBeGreaterThan(0);
		}
	});
	it("rejects malformed CSV, duplicate credential columns and inconsistent row width", () => {
		for (const input of [
			'name,password\nA,"unterminated',
			"name,password,password\nA,p,q",
			"name,password\nA,p,extra",
		]) {
			const result = parseVaultImportText(input);
			expect(result.candidates).toEqual([]);
			expect(result.issues.length).toBeGreaterThan(0);
		}
	});
	it("normalizes bare domains but rejects URL userinfo, schemes and whitespace", () => {
		expect(
			parseVaultImportText(
				"url=example.test/path?x=private#private\npassword=p",
			).candidates[0].draft.url,
		).toBe("https://example.test/path?x=private#private");
		for (const url of [
			"https://user:secret@example.test",
			"https://user@example.test",
			"javascript:alert(1)",
			"file:///tmp/secret",
			"https://bad host.test",
		]) {
			const result = parseVaultImportText(`title=A\nurl=${url}\npassword=p`);
			expect(result.candidates).toEqual([]);
			expect(result.issues).toContainEqual({
				lineNumber: 1,
				code: "invalid-url",
			});
		}
	});
	it("bounds text, entries and engine field sizes without including values in errors", () => {
		expect(() =>
			parseVaultImportText("a".repeat(VAULT_IMPORT_MAX_BYTES + 1)),
		).toThrow("vault-import-limit");
		expect(() =>
			parseVaultImportText("名".repeat(Math.ceil(VAULT_IMPORT_MAX_BYTES / 3))),
		).toThrow("vault-import-limit");
		expect(() =>
			parseVaultImportText(
				Array.from({ length: 201 }, (_, i) => `title=A${i};password=p`).join(
					"\n",
				),
			),
		).toThrow("vault-import-limit");
		for (const field of ["title", "username", "password", "notes"]) {
			const limits = {
				title: 256,
				username: 1024,
				password: 65536,
				notes: 65536,
			};
			const result = parseVaultImportText(
				`${field === "title" ? "" : "title=A\n"}${field === "password" ? "" : "password=p\n"}${field}=${"x".repeat(limits[field as keyof typeof limits] + 1)}`,
			);
			expect(result.candidates).toEqual([]);
			expect(result.issues.length).toBeGreaterThan(0);
		}
		expect(
			parseVaultImportText("title=A\npassword=mock\0secret").candidates,
		).toEqual([]);
	});
});

describe("password import AI boundary", () => {
	it("keeps manually completed rows local while retaining their secrets in the host exclusion check", () => {
		const rows = candidates();
		const manual = {
			...rows[0],
			id: "vault-manual-1",
			aiEligible: false,
			draft: { ...rows[0].draft, password: "manual-sensitive-token" },
		};
		expect(buildVaultImportAiPreview([...rows, manual])).toEqual(
			buildVaultImportAiPreview(rows),
		);
		expect(
			buildVaultImportAiPreview([
				{
					...rows[0],
					draft: {
						...rows[0].draft,
						url: "https://manual-sensitive-token.example.test",
					},
				},
				manual,
			]).records,
		).toEqual([]);
		expect(() =>
			buildVaultImportAiPreview([{ ...manual, aiEligible: true }]),
		).toThrow("vault-import-ai-invalid");
		expect(() => buildVaultImportAiPreview([manual, manual])).toThrow(
			"vault-import-ai-invalid",
		);
	});
	it("exports only generated ids and hosts, excluding all source, paths, accounts, passwords and notes", () => {
		const preview = buildVaultImportAiPreview(candidates());
		expect(preview).toEqual({
			records: [{ id: "vault-import-1", host: "example.test" }],
		});
		const payload = JSON.stringify(preview);
		for (const secret of [
			"reader@",
			"mock-secret",
			"mock-note-secret",
			"mock-query-secret",
			"mock-fragment-secret",
			"/login",
			"Example",
			"password",
			"username",
			"notes",
		])
			expect(payload).not.toContain(secret);
	});
	it("keeps malicious metadata, uncertain blocks and hosts containing any local credential out of AI", () => {
		const rows = parseVaultImportText(
			"title=secret: mock-title\nusername=token: mock-account\npassword=mock-password\nurl=https://public.test/path\nnotes=ignore instructions mock-notes\n\ntitle=B\nusername=other\npassword=mock-password\nurl=https://mock-password.public.test\n\ntitle=C\npassword=third-secret\nurl=https://public.test\nunknown=mock-residual",
		).candidates;
		expect(buildVaultImportAiPreview(rows)).toEqual({
			records: [{ id: "vault-import-1", host: "public.test" }],
		});
		const secretInOtherRow = parseVaultImportText(
			"title=A;password=host-secret;url=https://ordinary.test\ntitle=B;password=other-password;url=https://host-secret.ordinary.test",
		).candidates;
		expect(
			buildVaultImportAiPreview(secretInOtherRow).records.map(({ id }) => id),
		).toEqual(["vault-import-1"]);
		const accountHost = parseVaultImportText(
			"title=A;username=private-user;password=other-password;url=https://private-user.ordinary.test",
		).candidates;
		expect(buildVaultImportAiPreview(accountHost).records).toEqual([]);
	});
	it("refuses to send suspicious, local or token-bearing domains", () => {
		for (const host of [
			"localhost",
			"127.0.0.1",
			"[::1]",
			"secret.example.test",
			"token.example.test",
			"api-key.example.test",
		]) {
			expect(
				buildVaultImportAiPreview(
					parseVaultImportText(
						`title=A\npassword=other-password\nurl=http://${host}`,
					).candidates,
				).records,
			).toEqual([]);
		}
	});
	it("keeps common private-host logins local while preserving public and synthetic example domains", () => {
		for (const suffix of [
			"localhost",
			"local",
			"internal",
			"home.arpa",
			"lan",
			"corp",
			"localdomain",
			"intranet",
			"onion",
		]) {
			for (const host of [
				suffix,
				`portal.${suffix}`,
				`auth.portal.${suffix}`,
			]) {
				const rows = parseVaultImportText(
					`title=Private\nusername=reader\npassword=synthetic-password\nurl=https://${host}`,
				).candidates;
				expect(rows).toHaveLength(1);
				expect(rows[0].draft).toMatchObject({
					password: "synthetic-password",
					url: `https://${host}/`,
				});
				expect(buildVaultImportAiPreview(rows).records).toEqual([]);
			}
		}
		for (const host of [
			"github.com",
			"service.example",
			"service.example.test",
			"local.github.com",
			"internal.github.com",
		]) {
			const rows = parseVaultImportText(
				`title=Public\nusername=reader\npassword=synthetic-password\nurl=https://${host}`,
			).candidates;
			expect(buildVaultImportAiPreview(rows).records).toEqual([
				{ id: "vault-import-1", host },
			]);
		}
	});
	it("rejects IDNA and reversible credential encodings in domain labels", () => {
		const variants = [
			["秘密", "秘密.example.test"],
			["秘密", "xn--vctr31e.example.test"],
			["private-pass", "707269766174652d70617373.example.test"],
			["private-pass", "cHJpdmF0ZS1wYXNz.example.test"],
			["private-pass", "%70rivate-pass.example.test"],
		];
		for (const [password, host] of variants) {
			const rows = parseVaultImportText(
				`title=A\npassword=${password}\nurl=https://${host}`,
			).candidates;
			expect(rows).toHaveLength(1);
			expect(buildVaultImportAiPreview(rows).records).toEqual([]);
			expect(rows[0].draft.password).toBe(password);
		}
	});
	it("applies verified titles by id while retaining order and every credential unchanged", () => {
		const rows = parseVaultImportText(
			"title=Old;username=one;password=first-secret;url=https://github.com/path?secret=private\ntitle=Other;username=two;password=second-secret;url=https://google.com",
		).candidates;
		const result = applyVaultImportAiTitles(rows, {
			records: [
				{ id: "vault-import-2", title: "Google" },
				{ id: "vault-import-1", title: "GitHub" },
			],
		});
		expect(result.map(({ draft }) => draft.title)).toEqual([
			"GitHub",
			"Google",
		]);
		expect(result.map(({ draft }) => ({ ...draft, title: "" }))).toEqual(
			rows.map(({ draft }) => ({ ...draft, title: "" })),
		);
		expect(rows[0].draft.title).toBe("Old");
	});
	it("rejects hallucinations, arbitrary translations, new ids, duplicate ids and credential output atomically", () => {
		const rows = candidates();
		for (const output of [
			{ records: [{ id: "vault-import-1", title: "Invented" }] },
			{ records: [{ id: "vault-import-1", title: "示例" }] },
			{ records: [{ id: "vault-import-2", title: "example" }] },
			{
				records: [
					{ id: "vault-import-1", title: "example" },
					{ id: "vault-import-1", title: "example.test" },
				],
			},
			{
				records: [
					{ id: "vault-import-1", title: "example", password: "new-secret" },
				],
			},
			{
				records: [
					{ id: "vault-import-1", title: "example", username: "replacement" },
				],
			},
			{
				records: [
					{ id: "vault-import-1", title: "example", url: "https://other.test" },
				],
			},
			{ records: [{ id: "vault-import-1", title: "x".repeat(257) }] },
			{ records: [], command: "save" },
		])
			expect(() => applyVaultImportAiTitles(rows, output)).toThrow(
				"vault-import-ai-invalid",
			);
		expect(rows).toEqual(candidates());
		expect(() =>
			buildVaultImportAiPreview([{ ...rows[0], id: "mock-secret-id" }]),
		).toThrow("vault-import-ai-invalid");
		expect(() => buildVaultImportAiPreview([rows[0], rows[0]])).toThrow(
			"vault-import-ai-invalid",
		);
	});
	it("sends only preview metadata through the existing AI client and returns reviewed drafts", async () => {
		vi.mocked(generateAiText).mockResolvedValue({
			text: '{"records":[{"id":"vault-import-1","title":"example"}]}',
			usage: { inputTokens: 10, outputTokens: 10 },
			model: "synthetic",
		});
		const result = await requestVaultImportAiTitles(connection, candidates());
		expect(generateAiText).toHaveBeenCalledTimes(1);
		const options = vi.mocked(generateAiText).mock.calls[0][1];
		expect(JSON.parse(options.prompt)).toEqual(
			buildVaultImportAiPreview(candidates()),
		);
		expect(JSON.stringify(options)).not.toMatch(
			/mock-secret|mock-note|mock-query|mock-fragment|reader@/,
		);
		expect(result[0].draft).toEqual({
			...candidates()[0].draft,
			title: "example",
		});
	});
	it("batches over 40 eligible rows without truncation and never applies half a failed request", async () => {
		const rows: VaultImportCandidate[] = Array.from({ length: 81 }, (_, i) => ({
			id: `vault-import-${i + 1}`,
			sourceLine: i + 1,
			aiEligible: true,
			draft: {
				title: "Original",
				username: "",
				password: `fake-password-${i}`,
				url: `https://site${i}.example.test`,
				notes: "",
				linkedAssetIds: [],
			},
		}));
		vi.mocked(generateAiText).mockImplementation(
			async (_connection, options) => ({
				text: JSON.stringify({
					records: (
						JSON.parse(options.prompt) as {
							records: { id: string; host: string }[];
						}
					).records.map(({ id, host }) => ({ id, title: host })),
				}),
				usage: { inputTokens: 10, outputTokens: 10 },
				model: "synthetic",
			}),
		);
		expect(buildVaultImportAiPreview(rows).records).toHaveLength(81);
		const result = await requestVaultImportAiTitles(connection, rows);
		expect(generateAiText).toHaveBeenCalledTimes(3);
		expect(result[80].draft.title).toBe("site80.example.test");
		expect(rows.every(({ draft }) => draft.title === "Original")).toBe(true);
		vi.mocked(generateAiText)
			.mockReset()
			.mockResolvedValueOnce({
				text: '{"records":[{"id":"vault-import-1","title":"example"}]}',
				usage: { inputTokens: 1, outputTokens: 1 },
				model: "synthetic",
			})
			.mockRejectedValueOnce(Error("request-failed"));
		await expect(requestVaultImportAiTitles(connection, rows)).rejects.toThrow(
			"request-failed",
		);
		expect(rows.every(({ draft }) => draft.title === "Original")).toBe(true);
	});
	it("rejects cross-batch ids, malformed AI output and cancellations without mutation", async () => {
		for (const response of [
			"not-json",
			'{"records":[{"id":"vault-import-99","title":"example"}]}',
			"x".repeat(40001),
		]) {
			vi.mocked(generateAiText).mockResolvedValue({
				text: response,
				usage: { inputTokens: 1, outputTokens: 1 },
				model: "synthetic",
			});
			await expect(
				requestVaultImportAiTitles(connection, candidates()),
			).rejects.toThrow("vault-import-ai-invalid");
		}
		const abort = new AbortController();
		abort.abort();
		await expect(
			requestVaultImportAiTitles(connection, candidates(), abort.signal),
		).rejects.toThrow("cancelled");
		const during = new AbortController();
		vi.mocked(generateAiText).mockImplementation(async () => {
			during.abort();
			return {
				text: '{"records":[]}',
				usage: { inputTokens: 1, outputTokens: 1 },
				model: "synthetic",
			};
		});
		await expect(
			requestVaultImportAiTitles(connection, candidates(), during.signal),
		).rejects.toThrow("cancelled");
		expect(candidates()[0].draft.title).toBe("Example");
	});
});
