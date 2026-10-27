import { describe, expect, it } from 'vitest';
import { emptyTrashFilters, matchesTrashFilters, readTrashFilters } from './trash-filter-state';
describe('ordinary trash filter preferences', () => {
  it('keeps type and query as an intersection across all ordinary record groups', () => {
    const filter = { type: 'task' as const, query: 'ＡＬＰＨＡ' };
    expect(matchesTrashFilters(filter, 'task', ['Alpha invoice task'])).toBe(true);
    expect(matchesTrashFilters(filter, 'history', ['Alpha invoice task'])).toBe(false);
    expect(matchesTrashFilters(filter, 'task', ['Other'])).toBe(false);
    expect(matchesTrashFilters(emptyTrashFilters, 'vault', ['External reference'])).toBe(true);
  });
  it('restores valid empty-result preferences without inventing a record or inspecting private fields', () => {
    expect(readTrashFilters('{"type":"history","query":"Old name"}')).toEqual({ type: 'history', query: 'Old name' });
    expect(readTrashFilters('{"type":"task","query":"missing","notes":"private"}')).toEqual({ type: 'task', query: 'missing' });
    expect(matchesTrashFilters({ type: 'all', query: 'private' }, 'task', ['Public task title'])).toBe(false);
  });
  it('ignores corrupt preferences and unknown types, retaining a bounded user query', () => {
    for (const raw of ['invalid', 'null', '[]', '5']) expect(readTrashFilters(raw)).toEqual(emptyTrashFilters);
    expect(readTrashFilters('{"type":"password-entry","query":"Keep input"}')).toEqual({ type: 'all', query: 'Keep input' });
    expect(readTrashFilters(JSON.stringify({ type: 'account', query: 'x'.repeat(2001) }))).toEqual({ type: 'account', query: '' });
  });
});
