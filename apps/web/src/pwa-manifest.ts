/** Filesystem glob order differs by OS; cache identities must not depend on it. */
export function stablePrecacheManifest<T extends { url: string }>(entries: readonly T[]) {
	return {
		manifest: [...entries].sort((left, right) => {
			if (left.url < right.url) return -1;
			if (left.url > right.url) return 1;
			return 0;
		}),
		warnings: [] as string[],
	};
}
