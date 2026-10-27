import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { newAsset, submissionSchema } from '../../domain/src';
import { openLocalRepository } from './index';

test('single link restoration retains identity and rejects stale or permanently cleared snapshots', async () => {
  const repository = await openLocalRepository(`submission-restore-${crypto.randomUUID().slice(0, 12)}`);
  try {
    const asset = { ...newAsset('project'), name: 'Scoped project' };
    await repository.save('asset', asset);
    const deleted = submissionSchema.parse({ id: 'original-link-id', assetId: asset.id, name: 'Original link', url: 'https://directory.synthetic.test/', status: 'submitted', evidence: 'Original receipt', submittedAt: '2026-10-20', verifiedAt: '', deleted: true });
    await repository.save('submission', deleted);
    const newer = { ...deleted, evidence: 'Newer receipt' };
    await repository.save('submission', newer);
    await expect(repository.restoreSubmissionIfCurrent(deleted)).rejects.toThrow('submission-stale');
    expect(await repository.get('submission', deleted.id)).toEqual(newer);
    await repository.restoreSubmissionIfCurrent(newer);
    expect(await repository.get('submission', deleted.id)).toEqual({ ...newer, deleted: false });
    const purged = { ...newer, purged: true as const };
    await repository.records.modify(`submission:${deleted.id}`, row => ({ ...row, payload: JSON.stringify(purged) }));
    await expect(repository.restoreSubmissionIfCurrent(purged)).rejects.toThrow();
    expect(await repository.get('submission', deleted.id)).toEqual(purged);
  } finally { await repository.close(); }
});
