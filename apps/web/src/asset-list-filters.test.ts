import { expect, it } from 'vitest';
import { readAssetTagFilters, saveAssetTagFilters } from './asset-list-filters';

it('keeps legacy single-tag keys and rejects stale or malformed optional multi-tag hints', () => {
	const values = new Map<string, string>();
	const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
	storage.setItem('keepany-tag-account', 'Work');
	expect(readAssetTagFilters('account', storage)).toEqual(['Work']);
	saveAssetTagFilters('account', ['Work', 'Critical', 'Work'], storage);
	expect(storage.getItem('keepany-tag-account')).toBe('Work');
	expect(readAssetTagFilters('account', storage)).toEqual(['Work', 'Critical']);
	storage.setItem('keepany-tag-account', 'Legacy selection');
	expect(readAssetTagFilters('account', storage)).toEqual(['Legacy selection']);
	storage.setItem('keepany-tags-account', '{bad json');
	expect(readAssetTagFilters('account', storage)).toEqual(['Legacy selection']);
	saveAssetTagFilters('account', [], storage);
	expect(readAssetTagFilters('account', storage)).toEqual([]);
	expect(storage.getItem('keepany-tags-account')).toBeNull();
	saveAssetTagFilters('item', ['Other'], storage);
	expect(readAssetTagFilters('item', storage)).toEqual(['Other']);
	expect(readAssetTagFilters('account', storage)).toEqual([]);
});
