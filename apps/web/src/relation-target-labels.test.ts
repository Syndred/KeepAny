import { expect, it } from 'vitest';
import type { AssetKind } from '../../../packages/domain/src';
import { relationTargetLabels } from './relation-target-labels';

const kindLabel = (kind: AssetKind) => kind === 'account' ? '账号' : '项目';
const base = { name: 'Shared name', kind: 'account' as const, username: 'first@example.test', url: '' };

it('shows the ordinary login identifier and translated kind for same-name endpoints', () => {
  const result = relationTargetLabels([{ ...base, id: 'first-id' }, { ...base, id: 'second-id', username: 'second@example.test' }], kindLabel);
  expect(result.map(value => value.label)).toEqual(['Shared name · first@example.test · 账号', 'Shared name · second@example.test · 账号']);
  expect(result.map(value => value.asset.id)).toEqual(['first-id', 'second-id']);
});

it('uses stable visible IDs when identifiers match, including a colliding short-ID prefix', () => {
  const assets = [{ ...base, id: 'aaaaaaaa-first' }, { ...base, id: 'aaaaaaaa-second' }, { ...base, id: 'bbbbbbbb-third' }];
  const labels = new Map(relationTargetLabels(assets, kindLabel).map(value => [value.asset.id, value.label]));
  expect(labels.get('aaaaaaaa-first')).toContain('#aaaaaaaa-first');
  expect(labels.get('aaaaaaaa-second')).toContain('#aaaaaaaa-second');
  expect(labels.get('bbbbbbbb-third')).toContain('#bbbbbbbb');
  for (const value of relationTargetLabels([...assets].reverse(), kindLabel)) expect(value.label).toBe(labels.get(value.asset.id));
  expect(new Set(labels.values()).size).toBe(3);
});

it('uses only the public hostname for other types, excluding credentials, path, query and hash', () => {
  const asset = { ...base, id: 'project-id', kind: 'project' as const, username: 'not-used', url: 'https://synthetic-user:synthetic-secret@public.example.test/private?key=synthetic-query#synthetic-hash', notes: 'synthetic-private-note' };
  const label = relationTargetLabels([asset, { ...asset, id: 'other-project', url: 'https://other.example.test/' }], kindLabel)[0].label;
  expect(label).toBe('Shared name · public.example.test · 项目');
  for (const value of ['synthetic-user', 'synthetic-secret', 'private', 'synthetic-query', 'synthetic-hash', 'not-used']) expect(label).not.toContain(value);
});

it('retains existing exact labels for unique names and does not change original ID values', () => {
  const asset = { ...base, id: 'unique-id' };
  expect(relationTargetLabels([asset], kindLabel)).toEqual([{ asset, label: base.name }]);
});

it('keeps malformed/non-http URLs out and does not rely on translated kind text to distinguish IDs', () => {
  const result = relationTargetLabels([{ ...base, id: 'asset-one', kind: 'project' as const, url: 'javascript:alert(1)' }, { ...base, id: 'asset-two', kind: 'project' as const, url: 'not a url' }], kindLabel);
  expect(result.map(value => value.label)).toEqual(['Shared name · 项目 · #asset-on', 'Shared name · 项目 · #asset-tw']);
});
