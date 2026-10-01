import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { newAsset } from "../../../packages/domain/src";
import { stageReviewedCandidates } from "./intake-review-store";

GlobalWorkerOptions.workerSrc = workerUrl;

/** Text extraction only: no rendering, OCR, transaction or amount inference. */
export async function readPdfText(file: File): Promise<{ text: string; hash: string }> {
	if (!file.name.toLowerCase().endsWith(".pdf") || file.size > 10 * 1024 * 1024) throw Error("pdfLimit");
	const bytes = await file.arrayBuffer();
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
	const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0, stopAtErrors: true,
		useWorkerFetch: false, useWasm: false });
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const text = await Promise.race([
			(async () => {
				const document = await task.promise;
				if (document.numPages > 20) throw Error("pdfLimit");
				const pages: string[] = [];
				let length = 0;
				for (let number = 1; number <= document.numPages; number++) {
					const page = await document.getPage(number);
					const content = await page.getTextContent();
					const text = content.items.map(item => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join("").trim();
					page.cleanup();
					// A scanned or unreadable page must not silently disappear from the preview.
					if (!text) throw Error("pdfNoText");
					length += text.length + (pages.length ? 2 : 0);
					if (length > 20000) throw Error("pdfLimit");
					pages.push(text);
				}
				return pages.join("\n\n");
			})(),
			new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("pdfTimeout")), 30000); }),
		]);
		if (!text) throw Error("pdfNoText");
		return { text, hash };
	} catch (error) {
		if (error instanceof Error && ["pdfLimit", "pdfNoText", "pdfTimeout"].includes(error.message)) throw error;
		throw Error("pdfInvalid");
	} finally {
		clearTimeout(timer);
		await task.destroy();
	}
}

export async function stagePdfForReview(file: File): Promise<number> {
	const { text, hash } = await readPdfText(file);
	const asset = { ...newAsset("item"), id: `pdf-${hash.slice(0, 48)}`, name: file.name.replace(/\.pdf$/i, "").slice(0, 160), description: text };
	await stageReviewedCandidates([{ id: `pdf-${hash}`, fileHash: hash, fileName: file.name, rowNumber: 1,
		asset, status: "pending", source: "pdf", sourceText: text, kindSelected: false }]);
	return 1;
}
