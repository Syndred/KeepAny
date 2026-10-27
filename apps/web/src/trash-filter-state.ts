export const trashFilterStorageKey = 'keepany-trash-filters';
export const trashFilterTypes = ['all', 'project', 'account', 'subscription', 'item', 'vault', 'relation', 'task', 'history'] as const;
export type TrashFilterType = typeof trashFilterTypes[number];
export interface TrashFilters { type: TrashFilterType; query: string }
export const emptyTrashFilters: TrashFilters = { type: 'all', query: '' };
export function readTrashFilters(raw: string | null): TrashFilters {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...emptyTrashFilters };
    return { type: trashFilterTypes.includes(value.type) ? value.type : 'all', query: typeof value.query === 'string' && value.query.length <= 2000 ? value.query : '' };
  } catch { return { ...emptyTrashFilters }; }
}
export function matchesTrashFilters(filters: TrashFilters, type: Exclude<TrashFilterType, 'all'>, visibleText: readonly string[]): boolean {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim();
  return (filters.type === 'all' || filters.type === type) && (!filters.query.trim() || normalize(visibleText.join(' ')).includes(normalize(filters.query)));
}
