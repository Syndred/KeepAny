import { expect, test } from 'vitest';
import { readCollections } from './collection-model';

test('deleted collections keep original identities and members while every default reader hides them', () => {
  const deleted = { id: 'original', name: 'Travel', assetIds: ['p1', 'a1'], deleted: true, deletedAt: '2026-10-27T00:00:00Z' };
  const active = { id: 'new', name: 'Travel', assetIds: ['i1'] };
  expect(readCollections([deleted, active])).toEqual([active]);
  expect(readCollections([deleted, active], true)).toEqual([deleted, active]);
  expect(readCollections([active, deleted], true)).toEqual([active, deleted]);
});

test('eight active collections do not discard recoverable tombstones or count them as active slots', () => {
  const deleted = Array.from({ length: 12 }, (_, index) => ({ id: `deleted-${index}`, name: 'Old name', assetIds: [`member-${index}`], deleted: true }));
  const active = Array.from({ length: 8 }, (_, index) => ({ id: `active-${index}`, name: `Active ${index}`, assetIds: [] }));
  expect(readCollections([...deleted, ...active])).toEqual(active);
  expect(readCollections([...deleted, ...active], true)).toEqual([...deleted, ...active]);
  expect(readCollections([...active, { id: 'ninth', name: 'Ninth', assetIds: [] }])).toEqual(active);
});
