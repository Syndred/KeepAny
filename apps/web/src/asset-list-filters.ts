type FilterStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Keep the existing single-tag key readable by older clients and list links. */
export function readAssetTagFilters(kind: string, storage: FilterStorage = sessionStorage): string[] {
	const first = storage.getItem(`keepany-tag-${kind}`) || '';
	if (!first) return [];
	try {
		const value: unknown = JSON.parse(storage.getItem(`keepany-tags-${kind}`) || 'null');
		if (Array.isArray(value) && value[0] === first && value.every(tag => typeof tag === 'string' && !!tag)) return [...new Set(value)];
	} catch { /* A legacy or malformed optional hint must not hide the list. */ }
	return [first];
}

export function saveAssetTagFilters(kind: string, values: string[], storage: FilterStorage = sessionStorage): void {
	const tags = [...new Set(values.filter(Boolean))];
	storage.setItem(`keepany-tag-${kind}`, tags[0] || '');
	if (tags.length > 1) storage.setItem(`keepany-tags-${kind}`, JSON.stringify(tags));
	else storage.removeItem(`keepany-tags-${kind}`);
}

export function assetListFilterSnapshot(kind: string, search: string) {
	return { category: sessionStorage.getItem(`keepany-category-${kind}`) || '', tag: sessionStorage.getItem(`keepany-tag-${kind}`) || '', tags: readAssetTagFilters(kind), search };
}
