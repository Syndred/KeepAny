// 2026-10-29 user removed B1 backlink creation; retained snapshots and closure gates stay strict.
import { describe, expect, it } from 'vitest';
import { newAsset, type Asset, type Relation, type Submission } from './index';
import { buildProjectWorkflowTasks, canRecordProjectWorkflowTask, currentProjectWorkflowRound, recordProjectWorkflowTask } from './project-workflow';

function fixture() {
  const project = { ...newAsset('project'), name: 'Site A', description: 'Old profile', url: 'https://a.example', attachments: [crypto.randomUUID()], projectDomains: [{ id: crypto.randomUUID(), name: 'a.example', registrar: 'Registrar', accountId: '', expiryDate: '2027-01-01', annualAmount: 12000, currency: 'CNY' as const, autoRenew: 'on' as const }] };
  const account = { ...newAsset('account'), name: 'Admin account' };
  const subscription = { ...newAsset('subscription'), name: 'Hosting', amount: 9800, dueDate: '2026-10-22' };
  const relation = (asset: Asset): Relation => ({ id: crypto.randomUUID(), from: project.id, to: asset.id, label: 'uses', createdAt: '2026-09-29T00:00:00.000Z', verifiedAt: '', deleted: false });
  const submission: Submission = { id: crypto.randomUUID(), assetId: project.id, name: 'Directory', url: 'https://directory.example/a', status: 'review', submittedAt: '', verifiedAt: '', evidence: '', deleted: false };
  return { project, assets: [project, account, subscription], relations: [relation(account), relation(subscription)], submissions: [submission], account, subscription };
}
const title = (step: string, source: string) => `${step}: ${source}`;

describe('project workflow', () => {
  it('snapshots actual brand dependencies and preserves them after source changes', () => {
    const f = fixture();
    f.project.description = 'x'.repeat(20000);
    const rows = buildProjectWorkflowTasks({ ...f, kind: 'brand', proposal: { proposedName: 'Site B', proposedDescription: '', proposedUrl: '', changeNote: '' }, roundId: crypto.randomUUID(), at: '2026-09-29T00:00:00.000Z', title });
    expect(rows.map(row => row.projectWorkflow?.step)).toEqual(['brandProfile', 'brandRelation', 'brandRelation', 'brandDomain']);
    expect(rows.some(row => row.projectWorkflow?.step === 'brandSubmission')).toBe(false);
    expect(f.submissions[0].url).toBe('https://directory.example/a'); // Historical data is not mutated.
    expect(rows[0].projectWorkflow?.projectName).toBe('Site A');
    expect(rows[0].projectWorkflow?.projectDescription).toHaveLength(20000);
    expect(rows[0].projectWorkflow?.sourceDetail).toHaveLength(2000);
    f.project.name = 'Edited later';
    expect(rows[0].projectWorkflow?.projectName).toBe('Site A');
    expect(new Set(rows.map(row => row.dedupeKey)).size).toBe(rows.length);
    expect(currentProjectWorkflowRound(rows, f.project.id, 'brand')).toHaveLength(rows.length);
  });
  it('requires evidence for all outcomes and gates the final close decision', () => {
    const f = fixture();
    const rows = buildProjectWorkflowTasks({ ...f, kind: 'close', roundId: crypto.randomUUID(), at: '2026-09-29T00:00:00.000Z', title });
    expect(rows.map(row => row.projectWorkflow?.step)).toEqual(['closeBackup','closeHandoff','closeSubscription','closeDomain','closeRelated','closeDecision']);
    const decision = rows.at(-1)!;
    expect(canRecordProjectWorkflowTask(decision, rows)).toBe(false);
    expect(() => recordProjectWorkflowTask(rows[0], 'done', ' ', '2026-09-29T01:00:00.000Z')).toThrow();
    const blocked = recordProjectWorkflowTask(rows[0], 'blocked', 'Backup location unavailable', '2026-09-29T01:00:00.000Z');
    expect(blocked.done).toBe(false);
    expect(blocked.projectWorkflow?.record?.evidence).toBe('Backup location unavailable');
    const resolved = recordProjectWorkflowTask(blocked, 'done', 'Restored test copy successfully', '2026-09-29T02:00:00.000Z');
    expect(resolved.done).toBe(true);
    expect(resolved.projectWorkflow?.recordHistory).toHaveLength(1);
    const complete = [resolved, ...rows.slice(1, -1).map(row => recordProjectWorkflowTask(row, 'na', 'Checked and not applicable', '2026-09-29T02:00:00.000Z')), decision];
    expect(canRecordProjectWorkflowTask(decision, complete)).toBe(true);
  });
  it('rejects empty brand changes and plans beyond the atomic batch limit', () => {
    const f = fixture();
    expect(() => buildProjectWorkflowTasks({ ...f, kind: 'brand', proposal: { proposedName: '', proposedDescription: '', proposedUrl: '', changeNote: '' }, roundId: crypto.randomUUID(), at: '2026-09-29T00:00:00.000Z', title })).toThrow('workflow-proposal');
    const manyAccounts = Array.from({ length: 1000 }, (_, index) => ({ ...f.account, id: crypto.randomUUID(), name: `Account ${index}` }));
    const manyRelations = manyAccounts.map(account => ({ ...f.relations[0], id: crypto.randomUUID(), to: account.id }));
    expect(() => buildProjectWorkflowTasks({ ...f, assets: [f.project, ...manyAccounts], relations: manyRelations, kind: 'close', roundId: crypto.randomUUID(), at: '2026-09-29T00:00:00.000Z', title })).toThrow('workflow-batch-size');
  });

  it('keeps legacy backlink checklist rows resolvable without creating new backlink tasks', () => {
    const f = fixture();
    const rows = buildProjectWorkflowTasks({ ...f, kind: 'close', roundId: crypto.randomUUID(), at: '2026-09-29T00:00:00.000Z', title });
    const old = { ...rows[0], id: crypto.randomUUID(), projectWorkflow: { ...rows[0].projectWorkflow!, step: 'closeBacklink' as const, sourceId: f.submissions[0].id } };
    const legacyRound = [...rows.slice(0, -1), old, rows.at(-1)!];
    expect(canRecordProjectWorkflowTask(legacyRound.at(-1)!, legacyRound)).toBe(false);
    const resolved = legacyRound.slice(0, -1).map(row => recordProjectWorkflowTask(row, 'na', 'Retired feature; no external action performed', '2026-10-29T01:00:00.000Z'));
    expect(resolved.find(row => row.id === old.id)?.projectWorkflow?.record?.outcome).toBe('na');
    expect(canRecordProjectWorkflowTask(legacyRound.at(-1)!, [...resolved, legacyRound.at(-1)!])).toBe(true);
    expect(rows.some(row => row.projectWorkflow?.step === 'closeBacklink')).toBe(false);
  });
  it('does not add retired external-vault dependencies to new rounds', () => {
    const f = fixture();
    const vault = { ...newAsset('vault'), name: 'Historical external vault' };
    const linked = { ...f.relations[0], id: crypto.randomUUID(), to: vault.id };
    const rows = buildProjectWorkflowTasks({ ...f, assets: [...f.assets, vault], relations: [...f.relations, linked], kind: 'close', roundId: crypto.randomUUID(), at: '2026-10-29T00:00:00.000Z', title });
    expect(rows.some(row => row.projectWorkflow?.sourceAssetId === vault.id)).toBe(false);
    expect(rows.find(row => row.projectWorkflow?.step === 'closeHandoff')?.projectWorkflow?.sourceDetail).not.toContain(vault.name);
  });
});
