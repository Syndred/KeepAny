import { describe, expect, it } from 'vitest';
import { newAsset } from '../../../packages/domain/src';
import { applyCatalogEdit, type CatalogRecord } from './catalog-records';

describe('legacy project edits in the unified main card', () => {
 it('retains a derived legacy category when editing contact information', () => {
  const owner = { ...newAsset('project'), contact: 'before@example.test', catalogCategoryId: undefined };
  const record: CatalogRecord = { id: `asset:${owner.id}`, asset: owner, owner, categoryId: 'derived-category' };
  const changed = applyCatalogEdit(record, { ...owner, contact: 'after@example.test' }, 'derived-category');
  expect(changed.contact).toBe('after@example.test');
  expect(changed.catalogCategoryId).toBeUndefined();
  expect(changed.projectDomains).toEqual(owner.projectDomains);
 });
 it('applies an explicitly changed catalog category', () => {
  const owner = { ...newAsset('project'), catalogCategoryId: undefined };
  const record: CatalogRecord = { id: `asset:${owner.id}`, asset: owner, owner, categoryId: 'derived-category' };
  expect(applyCatalogEdit(record, owner, 'chosen-category').catalogCategoryId).toBe('chosen-category');
 });
});
