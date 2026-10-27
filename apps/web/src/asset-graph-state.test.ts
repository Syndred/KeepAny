import { describe, expect, it } from 'vitest';
import { newAsset, type Relation } from '../../../packages/domain/src';
import { accountFamilyGraph, consumeGraphReturn, graphReturnTarget, graphViewState, recoverableGraphRelations, rememberGraphVisit } from './account-family-graph';
import { layoutAccountGraph } from './account-graph-layout';

describe('shared asset graph presentation', () => {
  it('keeps mixed asset families, parallel IDs and original direction for a project center', async () => {
    const project = { ...newAsset('project'), id: 'project-center' };
    const account = { ...newAsset('account'), id: 'account-neighbor' };
    const item = { ...newAsset('item'), id: 'item-indirect' };
    const assets = [project, account, item];
    const first: Relation = { id: 'primary', from: project.id, to: account.id, label: 'Primary', verifiedAt: '', createdAt: '', deleted: false };
    const relations = [first, { ...first, id: 'recovery', label: 'Recovery' }, { ...first, id: 'reverse', from: account.id, to: project.id }, { ...first, id: 'indirect', from: account.id, to: item.id }];
    const graph = accountFamilyGraph(project.id, new Map(assets.map(asset => [asset.id, asset])), relations);
    expect(graph.relations.map(relation => relation.id)).toEqual(relations.map(relation => relation.id));
    const layout = await layoutAccountGraph(project.id, assets, relations, { width: 390, height: 560 });
    expect(layout.nodes.size).toBe(3); expect(layout.edges.size).toBe(4);
    expect(layout.edges.has("reverse")).toBe(true);
    expect(layout.edges.has("primary")).toBe(true);
  });
  it('retains filter, camera and drag offsets separately for each center without mutating assets', () => {
    const asset = { ...newAsset('project'), id: 'state-project' };
    const original = structuredClone(asset);
    const state = graphViewState(asset.id);
    state.filter = 'recorded source'; state.scope = 'family'; state.camera = { x: 30, y: 80, zoom: 0.75 }; state.positions[asset.id] = { x: 22, y: -9 };
    expect(graphViewState(asset.id)).toBe(state);
    expect(graphViewState('other-center').positions).toEqual({});
    expect(asset).toEqual(original);
  });
  it('returns through the actual sequence of graph visits and ignores unrelated routes', () => {
    const project = { ...newAsset('project'), id: 'return-project' }, account = { ...newAsset('account'), id: 'return-account' }, item = { ...newAsset('item'), id: 'return-item' };
    rememberGraphVisit(project, account); rememberGraphVisit(account, item);
    expect(graphReturnTarget(item.id)).toEqual({ id: account.id, kind: 'account' });
    expect(graphReturnTarget('unrelated')).toBeUndefined();
    expect(consumeGraphReturn(item.id)).toEqual({ id: account.id, kind: 'account' });
    expect(consumeGraphReturn(account.id)).toEqual({ id: project.id, kind: 'project' });
    expect(graphReturnTarget(account.id)).toBeUndefined();
  });
  it('carries the chosen connection scope through visits while retaining each center and return state', () => {
    const project = { ...newAsset('project'), id: 'scope-project' };
    const account = { ...newAsset('account'), id: 'scope-account' };
    const item = { ...newAsset('item'), id: 'scope-item' };
    const originalAssets = structuredClone([project, account, item]);
    const source = graphViewState(project.id), target = graphViewState(account.id);
    source.scope = 'family'; source.filter = 'source filter'; source.selected = 'source edge';
    target.filter = 'target filter'; target.selected = 'target edge'; target.detailsOpen = true;
    target.camera = { x: 10, y: 20, zoom: 0.8 };
    target.expandedCamera = { x: 30, y: 40, zoom: 1.2 };
    target.positions = { [account.id]: { x: 8, y: -9 } };
    const targetPresentation = structuredClone(target);
    rememberGraphVisit(project, account);
    expect(graphViewState(account.id)).toEqual({ ...targetPresentation, scope: 'family' });
    expect(graphViewState(project.id).scope).toBe('family');
    // A new explicit choice applies to the next graph visit, but going back
    // restores the previous center's own scope, filter and camera.
    target.scope = 'direct'; graphViewState(item.id).scope = 'family';
    rememberGraphVisit(account, item);
    expect(graphViewState(item.id).scope).toBe('direct');
    expect(consumeGraphReturn(item.id)).toEqual({ id: account.id, kind: 'account' });
    expect(graphViewState(account.id)).toEqual({ ...targetPresentation, scope: 'direct' });
    expect(consumeGraphReturn(account.id)).toEqual({ id: project.id, kind: 'project' });
    expect(source).toMatchObject({ scope: 'family', filter: 'source filter', selected: 'source edge' });
    expect(graphViewState('scope-unrelated').scope).toBe('direct');
    rememberGraphVisit(project, project);
    expect(graphReturnTarget(project.id)).toBeUndefined();
    expect([project, account, item]).toEqual(originalAssets);
  });
  it('can recover an isolated indirect branch after reload without reviving tombstones in the active graph', () => {
    const project = { ...newAsset('project'), id: 'history-project' }, account = { ...newAsset('account'), id: 'history-account' }, item = { ...newAsset('item'), id: 'history-item', deleted: true };
    const link: Relation = { id: 'history-direct', from: project.id, to: account.id, label: 'Direct', verifiedAt: '', createdAt: '', deleted: false };
    const removed = { ...link, id: 'history-removed', from: account.id, to: item.id, deleted: true };
    const outside = { ...removed, id: 'purged-link', from: project.id, to: item.id, purged: true as const };
    expect(recoverableGraphRelations(project.id, [project, account, item], [link, removed, outside])).toEqual([removed]);
    expect(accountFamilyGraph(project.id, new Map([project, account, item].map(asset => [asset.id, asset])), [link, removed, outside]).relations).toEqual([link]);
    expect(removed.deleted).toBe(true); expect(item.deleted).toBe(true);
  });
  it('retains the active scope when a new destination evicts the oldest center at the cache limit', () => {
    const source = { ...newAsset('account'), id: 'cache-limit-source' };
    const target = { ...newAsset('account'), id: 'cache-limit-destination' };
    graphViewState(source.id).scope = 'family';
    for (let index = 0; index < 63; index++) graphViewState(`cache-limit-other-${index}`);
    rememberGraphVisit(source, target);
    expect(graphViewState(target.id).scope).toBe('family');
  });
});
