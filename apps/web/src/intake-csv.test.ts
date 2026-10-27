import { beforeEach, expect, test, vi } from "vitest";

const stage = vi.hoisted(() => vi.fn(async (_rows: unknown[]) => []));
vi.mock("./intake-review-store", () => ({ stageReviewedCandidates: stage }));
import { stageCsvForReview } from "./intake-csv";

beforeEach(() => stage.mockClear());

test("CSV retains the complete original BOM, CRLF, quoted multiline fields and unselected duplicate rows", async () => {
	const original = '\uFEFFkind,name,description\r\nproject,Original,"First line\r\n第二行"\r\nproject,Original,Duplicate\r\nitem,Unselected,Keep me\r\n';
	expect(await stageCsvForReview(new File([original], "original.csv", { type: "text/csv" }))).toBe(3);
	const rows = stage.mock.calls[0]?.[0] as unknown as Array<{ id: string; fileHash: string; sourceText?: string; sourceTextRef?: string; asset: { name: string; description: string } }>;
	expect(rows).toHaveLength(3);
	expect(rows[0].sourceText).toBe(original);
	expect(rows.slice(1).every(row => row.sourceText === undefined && row.sourceTextRef === rows[0].fileHash)).toBe(true);
	expect(rows[0].asset.description).toBe("First line\r\n第二行");
	expect(rows[1].asset.name).toBe("Original");
	expect(rows[2].asset.name).toBe("Unselected");
	expect(new Set(rows.map(row => row.id)).size).toBe(3);
});

test("a near-2MiB CSV with 200 rows stores its original exactly once without reducing the row or file limit", async () => {
	const lines = Array.from({ length: 200 }, (_, index) => `project,Asset ${index},${"a".repeat(10_000)}`);
	const original = `kind,name,unused\r\n${lines.join("\r\n")}\r\n`;
	expect(new Blob([original]).size).toBeGreaterThan(1_900_000);
	expect(await stageCsvForReview(new File([original], "large-valid.csv"))).toBe(200);
	const rows = stage.mock.calls[0]?.[0] as unknown as Array<{ sourceText?: string; sourceTextRef?: string }>;
	expect(rows.filter(row => row.sourceText !== undefined)).toHaveLength(1);
	expect(rows[0].sourceText).toBe(original);
	expect(rows.filter(row => row.sourceTextRef !== undefined)).toHaveLength(199);
	expect(JSON.stringify(rows).length).toBeLessThan(3 * 1024 * 1024);
});

test("invalid UTF-8 and oversized CSV never stage incomplete original content", async () => {
	await expect(stageCsvForReview(new File([new Uint8Array([0xff, 0xfe, 0x61])], "bad.csv"))).rejects.toThrow("invalid");
	await expect(stageCsvForReview(new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.csv"))).rejects.toThrow("limit");
	expect(stage).not.toHaveBeenCalled();
});


test("explicit expense rows retain exact column strings for review without guessing unknown amounts or currency", async () => {
  const original = 'kind,name,amount,currency,eventDate,assetId,note\r\nexpense,Invoice one,12.34,USD,2026-10-27,owner,Keep original\r\nexpense,Invoice two,unknown,unmapped,, ,Unmapped evidence\r\n';
  expect(await stageCsvForReview(new File([original], 'expenses.csv'))).toBe(2);
  const rows = stage.mock.calls[0]?.[0] as Array<{ id: string; reviewMode: string; sourceText?: string; expenseDraft: { amount: string; currency: string; currencyConfirmed: boolean; eventDate: string; assetId: string } }>;
  expect(rows[0]).toMatchObject({ reviewMode: 'expense', sourceText: original, expenseDraft: { amount: '12.34', currency: 'USD', currencyConfirmed: true, eventDate: '2026-10-27', assetId: 'owner' } });
  expect(rows[1]).toMatchObject({ reviewMode: 'expense', expenseDraft: { amount: 'unknown', currencyConfirmed: false, eventDate: '', assetId: '' } });
  expect(rows[0].id).not.toBe(rows[1].id);
});
