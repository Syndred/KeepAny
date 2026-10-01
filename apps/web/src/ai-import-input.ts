/** Reject clearly labelled secrets before a text/PDF import leaves this device. */
export function hasExplicitImportSecret(text: string): boolean {
	const normalized = text.normalize("NFKC");
	if (
		/(?:密码|口令)\s*(?:[：:=]\s*\S+|(?:是\s*)?[A-Za-z0-9!@#$%^&*()[\]{}?._~+/=-]{4,})/u.test(
			normalized,
		) ||
		/\b(?:password|passwd|api[\s_-]*key|secret[\s_-]*key|access[\s_-]*token|private[\s_-]*key)["']?\s*[:=]\s*["']?\S+/iu.test(
			normalized,
		) ||
		/\bsk-[A-Za-z0-9_-]{16,}\b|\bBearer\s+[A-Za-z0-9._~-]{16,}|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/u.test(
			normalized,
		)
	)
		return true;
	for (const match of normalized.matchAll(/https?:\/\/[^\s<>"']+/giu)) {
		try {
			const url = new URL(match[0]);
			if (url.username || url.password) return true;
			for (const [key, value] of url.searchParams)
				if (
					value &&
					/^(?:password|passwd|api[_-]?key|access[_-]?token|token|secret|credential)$/i.test(
						key,
					)
				)
					return true;
		} catch {
			/* The normal import validator handles malformed URLs. */
		}
	}
	return false;
}
