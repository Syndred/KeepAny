export const readableFields = ['kind', 'name', 'category', 'tags', 'description', 'url', 'status', 'dueDate'] as const;
export const writableFields = ['name', 'category', 'tags', 'description', 'url'] as const;
export type ReadField = (typeof readableFields)[number];
export type WriteField = (typeof writableFields)[number];
