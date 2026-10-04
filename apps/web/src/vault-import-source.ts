import type {
	VaultImportCandidate,
	VaultImportIssue,
	VaultImportSourceReference,
} from "./vault-import-model";

export type VaultImportSourceExcerpt = {
	id: string;
	title?: string;
	username?: string;
	usernameAliases?: string[];
	rows: {
		lineNumber: number;
		text: string;
		maskedText: string;
		focused: boolean;
	}[];
	selection: { start: number; end: number };
};

type SourceLine = { number: number; start: number; end: number; text: string };
function sourceLines(source: string): SourceLine[] {
	const result: SourceLine[] = [];
	const ending = /\r\n|\r|\n/g;
	let start = 0;
	for (const match of source.matchAll(ending)) {
		const end = match.index;
		result.push({
			number: result.length + 1,
			start,
			end,
			text: source.slice(start, end),
		});
		start = end + match[0].length;
	}
	result.push({
		number: result.length + 1,
		start,
		end: source.length,
		text: source.slice(start),
	});
	return result;
}

/** Adjacent warnings form one fragment instead of a list of line numbers. */
export function groupVaultImportIssues(
	issues: VaultImportIssue[],
): VaultImportIssue[][] {
	const unique = [
		...new Map(
			issues.map((issue) => [`${issue.lineNumber}:${issue.code}`, issue]),
		).values(),
	].sort((a, b) => a.lineNumber - b.lineNumber);
	const groups: VaultImportIssue[][] = [];
	for (const issue of unique) {
		const previous = groups.at(-1);
		if (
			previous &&
			issue.lineNumber <= previous[previous.length - 1].lineNumber + 1
		)
			previous.push(issue);
		else groups.push([issue]);
	}
	return groups;
}

function validReference(
	reference: VaultImportSourceReference | undefined,
	length: number,
): reference is VaultImportSourceReference {
	return (
		!!reference &&
		Number.isInteger(reference.start) &&
		Number.isInteger(reference.end) &&
		reference.start >= 0 &&
		reference.start < reference.end &&
		reference.end <= length
	);
}

/** Source text stays in dialog memory. Only proven names/accounts are visible by default. */
export function buildVaultImportSourceExcerpt(
	source: string,
	focusLines: number[],
	candidates: VaultImportCandidate[],
	ownerCandidate?: VaultImportCandidate,
): VaultImportSourceExcerpt {
	const lines = sourceLines(source);
	const ownerAnchor =
		ownerCandidate?.sourceFields?.username?.line ??
		ownerCandidate?.sourceFields?.password?.line ??
		ownerCandidate?.sourceLine ??
		1;
	const focus = [
		...new Set(
			focusLines.filter(
				(line) => Number.isInteger(line) && line >= 1 && line <= lines.length,
			),
		),
	].sort((a, b) => a - b);
	if (!focus.length)
		focus.push(Math.max(1, Math.min(lines.length, ownerAnchor)));
	const first = focus[0];
	const last = focus[focus.length - 1];
	let sectionStart = first;
	let sectionEnd = last;
	while (sectionStart > 1 && lines[sectionStart - 2].text.trim())
		sectionStart--;
	while (sectionEnd < lines.length && lines[sectionEnd].text.trim())
		sectionEnd++;
	const owner =
		ownerCandidate ??
		candidates
			.map((candidate) => {
				const anchor =
					candidate.sourceFields?.username?.line ??
					candidate.sourceFields?.password?.line ??
					candidate.sourceLine;
				return {
					candidate,
					anchor,
					distance: Math.min(...focus.map((line) => Math.abs(line - anchor))),
				};
			})
			.filter(({ anchor }) => anchor >= sectionStart && anchor <= sectionEnd)
			.sort((a, b) => a.distance - b.distance)[0]?.candidate;
	const visible = new Set<number>();
	// Keep the excerpt compact even for a large multiline field or paragraph.
	for (
		let number = Math.max(sectionStart, first - 2);
		number <= Math.min(sectionEnd, last + 2) && visible.size < 12;
		number++
	)
		visible.add(number);
	for (const field of ["title", "username"] as const) {
		const reference = owner?.sourceFields?.[field];
		if (
			validReference(reference, source.length) &&
			reference.line >= 1 &&
			reference.line <= lines.length
		)
			visible.add(reference.line);
	}
	for (const reference of owner?.sourceUsernameAliases ?? []) {
		if (
			validReference(reference, source.length) &&
			reference.line >= 1 &&
			reference.line <= lines.length
		)
			visible.add(reference.line);
	}
	const safe: VaultImportSourceReference[] = [];
	const privateRanges: { start: number; end: number }[] = [];
	const secrets = new Set<string>();
	for (const candidate of candidates) {
		for (const reference of candidate.sourceUsernameAliases ?? []) {
			if (validReference(reference, source.length)) safe.push(reference);
		}
		for (const [field, reference] of Object.entries(
			candidate.sourceFields ?? {},
		)) {
			if (!validReference(reference, source.length)) continue;
			if (field === "title" || field === "username") safe.push(reference);
			else privateRanges.push(reference);
		}
		// Secret text wins even if another reference calls the same text a name.
		for (const secret of [candidate.draft.password, candidate.draft.notes]) {
			if (secret) secrets.add(secret);
		}
	}
	// An identity can be explicitly JSON-quoted in the source. Escapes must not
	// reveal a password or note merely because its plaintext differs from its syntax.
	for (const reference of safe) {
		try {
			const decoded: unknown = JSON.parse(
				source.slice(reference.start, reference.end),
			);
			if (
				typeof decoded === "string" &&
				[...secrets].some((secret) => decoded.includes(secret))
			)
				privateRanges.push(reference);
		} catch {
			/* Ordinary unquoted identities are handled below. */
		}
	}
	// Unknown text is already masked. Search only near proven identity ranges,
	// including a multiline secret that begins before one of those ranges.
	const identityRanges: { start: number; end: number }[] = [];
	for (const reference of [...safe].sort(
		(left, right) => left.start - right.start,
	)) {
		const previous = identityRanges.at(-1);
		if (previous && reference.start <= previous.end)
			previous.end = Math.max(previous.end, reference.end);
		else identityRanges.push({ start: reference.start, end: reference.end });
	}
	for (const secret of secrets) {
		for (const range of identityRanges) {
			const start = Math.max(0, range.start - secret.length + 1);
			const end = Math.min(source.length, range.end + secret.length - 1);
			const window = source.slice(start, end);
			let offset = window.indexOf(secret);
			let maskingRange: { start: number; end: number } | undefined;
			while (offset >= 0) {
				const secretStart = start + offset;
				const secretEnd = secretStart + secret.length;
				if (secretStart < range.end && range.start < secretEnd) {
					if (maskingRange && secretStart <= maskingRange.end)
						maskingRange.end = Math.max(maskingRange.end, secretEnd);
					else {
						maskingRange = { start: secretStart, end: secretEnd };
						privateRanges.push(maskingRange);
					}
				}
				offset = window.indexOf(secret, offset + 1);
			}
		}
	}
	const rows = [...visible]
		.sort((a, b) => a - b)
		.map((number) => {
			const line = lines[number - 1];
			const publicCharacters = new Uint8Array(line.text.length);
			for (const reference of safe)
				publicCharacters.fill(
					1,
					Math.max(0, reference.start - line.start),
					Math.max(0, Math.min(line.text.length, reference.end - line.start)),
				);
			for (const reference of privateRanges)
				publicCharacters.fill(
					0,
					Math.max(0, reference.start - line.start),
					Math.max(0, Math.min(line.text.length, reference.end - line.start)),
				);
			let maskedText = "";
			let masking = false;
			for (let offset = line.start; offset < line.end; offset++) {
				const publicCharacter = publicCharacters[offset - line.start];
				if (publicCharacter) {
					maskedText += source[offset];
					masking = false;
				} else if (!masking) {
					maskedText += "••••••";
					masking = true;
				}
			}
			return {
				lineNumber: number,
				text: line.text,
				maskedText,
				focused: focus.includes(number),
			};
		});
	function contextIdentity(
		reference: VaultImportSourceReference | undefined,
	): string | undefined {
		if (
			!validReference(reference, source.length) ||
			privateRanges.some(
				(privateRange) =>
					privateRange.start < reference.end &&
					reference.start < privateRange.end,
			)
		)
			return undefined;
		return source.slice(reference.start, reference.end);
	}
	const title = contextIdentity(owner?.sourceFields?.title);
	const username = contextIdentity(owner?.sourceFields?.username);
	const usernameAliases = (owner?.sourceUsernameAliases ?? []).flatMap(
		(reference) => {
			const value = contextIdentity(reference);
			return value ? [value] : [];
		},
	);
	return {
		id: `source-${first}-${last}-${owner?.id ?? "fragment"}`,
		...(title ? { title } : {}),
		...(username ? { username } : {}),
		...(usernameAliases.length ? { usernameAliases } : {}),
		rows,
		selection: { start: lines[first - 1].start, end: lines[last - 1].end },
	};
}
