import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { buildImpactTasks } from '../../domain/src/impact';
import { newAsset, relationSchema, taskSchema } from '../../domain/src';
import { decryptBackup, encryptBackup } from './backup-crypto';
import { openLocalRepository } from './index';

it('preserves impact evidence, frozen IDs and completion through CAS rejection and encrypted clean restore', async () => {
  const original = await openLocalRepository(`impact-note-${crypto.randomUUID().slice(0, 8)}`);
  const restored = await openLocalRepository(`impact-return-${crypto.randomUUID().slice(0, 8)}`);
  try {
    const account = { ...newAsset('account'), name: 'Synthetic account' };
    const project = { ...newAsset('project'), name: 'Synthetic project' };
    const at = '2026-10-27T00:00:00.000Z';
    const relation = relationSchema.parse({ id: crypto.randomUUID(), from: account.id, to: project.id, label: 'Synthetic evidence', source: 'Original relation source', createdAt: at });
    const [legacy] = buildImpactTasks(account, [relation], [account, project], [], at, () => 'Check synthetic relation');
    if (!legacy) throw Error('missing-fixture');
    expect(taskSchema.parse(legacy)).not.toHaveProperty('impactNotes');
    await original.saveBatch([{ type: 'asset', value: account }, { type: 'asset', value: project }, { type: 'relation', value: relation }, { type: 'task', value: legacy }]);
    const first = { ...legacy, impactNotes: [{ id: crypto.randomUUID(), text: 'Synthetic receipt\nSecond line', recordedAt: at }] };
    await original.saveTaskIfCurrent(legacy, first);
    await expect(original.saveTaskIfCurrent(legacy, { ...legacy, done: true, completedAt: at, completionHistory: [at] })).rejects.toThrow('task-stale');
    expect(await original.get('task', legacy.id)).toEqual(first);
    const completed = { ...first, done: true, completedAt: at, completionHistory: [at] };
    await original.saveTaskIfCurrent(first, completed);
    await original.save('relation', { ...relation, deleted: true });
    const encrypted = await encryptBackup(await original.exportArchive(), 'Synthetic-evidence-backup');
    await restored.restoreArchive(await decryptBackup(encrypted, 'Synthetic-evidence-backup'));
    expect(await restored.get('task', legacy.id)).toEqual(completed);
    expect(await restored.get('relation', relation.id)).toEqual({ ...relation, deleted: true });
    expect(taskSchema.safeParse({ ...completed, impactNotes: [{ id: crypto.randomUUID(), text: ' ', recordedAt: at }] }).success).toBe(false);
    expect(taskSchema.safeParse({ ...completed, impactNotes: [{ id: crypto.randomUUID(), text: 'x'.repeat(2001), recordedAt: at }] }).success).toBe(false);
    expect(taskSchema.safeParse({ ...completed, impactNotes: Array.from({ length: 101 }, () => ({ ...first.impactNotes[0], id: crypto.randomUUID() })) }).success).toBe(false);
    expect(taskSchema.safeParse({ ...completed, impactNotes: [first.impactNotes[0], first.impactNotes[0]] }).success).toBe(false);
    expect(taskSchema.safeParse({ ...completed, impactSnapshot: undefined }).success).toBe(false);
  } finally { await original.close(); await restored.close(); }
}, 30_000);
