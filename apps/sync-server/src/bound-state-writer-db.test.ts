import pg from 'pg';
import { expect, it } from 'vitest';
import type { VerifiedBoundState } from './bound-state-record';
import { createPostgresBoundStateWriter } from './bound-state-writer-db';
import { migrateSyncDatabase } from './migrate';

const testDatabase = process.env.KEEPANY_TEST_DATABASE_URL;

function observedState(bindingId: string, offsetMs = 0): VerifiedBoundState {
  const stateObservedAt = new Date(Date.now() - 3_000 + offsetMs);
  return {
    bindingId,
    subject: 'keepanyadm:writer-test',
    instanceIdHash: 'a'.repeat(64),
    jkt: 'b'.repeat(43),
    scopes: ['sync:read', 'sync:write'],
    status: 'active',
    epoch: 1,
    tokenValidAfter: 0,
    stateObservedAt,
    stateExpiresAt: new Date(stateObservedAt.getTime() + 8_000),
  };
}

it.skipIf(!testDatabase)('applies signed state with PostgreSQL CAS across writers and retains revoked tombstones', async () => {
  if (!testDatabase) throw Error('test-database-url');
  const schema = `keepany_bound_writer_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: testDatabase, max: 1, connectionTimeoutMillis: 5_000 });
  const connection = { connectionString: testDatabase, options: `-c search_path=${schema}`, max: 2, connectionTimeoutMillis: 5_000 };
  const first = new pg.Pool(connection);
  const second = new pg.Pool(connection);
  let created = false;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await migrateSyncDatabase(first);
    await migrateSyncDatabase(second);
    const writer = createPostgresBoundStateWriter(first);
    const another = createPostgresBoundStateWriter(second);
    const bindingId = crypto.randomUUID();
    const initial = observedState(bindingId);

    expect(await writer.hasState(bindingId)).toBe(false);
    expect(await writer.upsertVerifiedState(initial)).toBe('applied');
    expect(await another.hasState(bindingId)).toBe(true);
    expect(await another.listKnownNonRevokedIds()).toEqual([bindingId]);

    const renewal = observedState(bindingId, 1_000);
    expect(await another.upsertVerifiedState(renewal)).toBe('applied');
    expect(await writer.upsertVerifiedState(initial)).toBe('ignored');
    expect(await writer.upsertVerifiedState({ ...renewal, stateExpiresAt: new Date(renewal.stateExpiresAt.getTime() + 1_000) })).toBe('ignored');
    await expect(first.query(
      "UPDATE sync_bound_bindings SET state_expires_at=state_expires_at+INTERVAL '1 second' WHERE binding_id=$1", [bindingId],
    )).rejects.toMatchObject({ code: 'P0001' });
    await expect(first.query(
      "UPDATE sync_bound_bindings SET status='inactive' WHERE binding_id=$1", [bindingId],
    )).rejects.toMatchObject({ code: 'P0001' });
    for (const changed of [
      { ...observedState(bindingId, 2_000), status: 'inactive' as const },
      { ...observedState(bindingId, 2_000), scopes: ['sync:read'] as VerifiedBoundState['scopes'] },
      { ...observedState(bindingId, 2_000), tokenValidAfter: 1 },
      { ...observedState(bindingId, 2_000), subject: 'keepanyadm:other' },
    ]) expect(await writer.upsertVerifiedState(changed)).toBe('ignored');
    expect(await writer.upsertVerifiedState({ ...observedState(bindingId, 2_000), epoch: 2 })).toBe('ignored');

    const epoch2 = { ...observedState(bindingId, 2_000), epoch: 2, tokenValidAfter: 1 };
    const epoch3 = { ...observedState(bindingId, 3_000), epoch: 3, tokenValidAfter: 2, status: 'inactive' as const };
    await Promise.all([writer.upsertVerifiedState(epoch2), another.upsertVerifiedState(epoch3)]);
    const current = await first.query<{ epoch: string; status: string; token_valid_after: string; state_observed_at: Date }>(
      'SELECT epoch,status,token_valid_after,state_observed_at FROM sync_bound_bindings WHERE binding_id=$1', [bindingId],
    );
    expect(current.rows[0]).toMatchObject({ epoch: '3', status: 'inactive', token_valid_after: '2' });
    expect(current.rows[0].state_observed_at).toEqual(epoch3.stateObservedAt);
    expect(await writer.listKnownNonRevokedIds()).toEqual([bindingId]);
    expect(await another.upsertVerifiedState(epoch2)).toBe('ignored');

    const revoked = { ...observedState(bindingId, 4_000), epoch: 4, tokenValidAfter: 3, status: 'revoked' as const };
    expect(await another.upsertVerifiedState(revoked)).toBe('applied');
    expect(await writer.listKnownNonRevokedIds()).toEqual([]);
    expect(await writer.hasState(bindingId)).toBe(true);
    expect(await writer.upsertVerifiedState({ ...observedState(bindingId, 5_000), epoch: 5, tokenValidAfter: 4 })).toBe('ignored');
    await expect(first.query(
      "UPDATE sync_bound_bindings SET status='active', epoch=5, token_valid_after=4 WHERE binding_id=$1", [bindingId],
    )).rejects.toMatchObject({ code: 'P0001' });
    await expect(first.query('DELETE FROM sync_bound_bindings WHERE binding_id=$1', [bindingId])).rejects.toMatchObject({ code: 'P0001' });

    const lateId = crypto.randomUUID();
    const late = observedState(lateId);
    await expect(writer.upsertVerifiedState({ ...late, stateExpiresAt: new Date(late.stateObservedAt.getTime() + 11_000) }))
      .rejects.toMatchObject({ code: '23514' });
    expect(await another.hasState(lateId)).toBe(false);
  } finally {
    await first.end();
    await second.end();
    if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}, 60_000);

it.skipIf(!testDatabase)('admits at most 32 non-revoked IDs across PostgreSQL writers without starving accepted IDs', async () => {
  if (!testDatabase) throw Error('test-database-url');
  const schema = `keepany_bound_capacity_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: testDatabase, max: 1, connectionTimeoutMillis: 5_000 });
  const connection = { connectionString: testDatabase, options: `-c search_path=${schema}`, max: 2, connectionTimeoutMillis: 5_000 };
  const first = new pg.Pool(connection);
  const second = new pg.Pool(connection);
  let restarted: pg.Pool | undefined;
  let fastRenewals: pg.Pool | undefined;
  let created = false;
  let firstClosed = false;
  let secondClosed = false;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await migrateSyncDatabase(first);
    const writer = createPostgresBoundStateWriter(first);
    const another = createPostgresBoundStateWriter(second);
    const admittedIds = Array.from({ length: 31 }, () => crypto.randomUUID());
    for (const id of admittedIds) expect(await writer.upsertVerifiedState(observedState(id))).toBe('applied');

    const contenders: string[] = [crypto.randomUUID(), crypto.randomUUID()];
    const outcomes = await Promise.allSettled([
      writer.upsertVerifiedState(observedState(contenders[0])),
      another.upsertVerifiedState(observedState(contenders[1])),
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toEqual([{ status: 'fulfilled', value: 'applied' }]);
    expect(outcomes.find(result => result.status === 'rejected')).toMatchObject({
      reason: { message: 'bound-state-feed-capacity-exceeded' },
    });
    const full = await another.listKnownNonRevokedIds();
    expect(full).toHaveLength(32);
    expect(full.filter(id => contenders.includes(id))).toHaveLength(1);
    const rejectedId = contenders.find(id => !full.includes(id));
    if (!rejectedId) throw Error('capacity-rejected-id-missing');
    expect(await writer.hasState(rejectedId)).toBe(false);
    await expect(another.upsertVerifiedState(observedState(rejectedId)))
      .rejects.toThrow('bound-state-feed-capacity-exceeded');

    fastRenewals = new pg.Pool({ ...connection, options: `-c search_path=${schema} -c lock_timeout=750ms` });
    const admissionGate = await second.connect();
    let gateBegun = false;
    try {
      await admissionGate.query('BEGIN');
      gateBegun = true;
      await admissionGate.query("SELECT pg_advisory_xact_lock(hashtext('keepany-bound-state-feed-capacity'))");
      const quickWriter = createPostgresBoundStateWriter(fastRenewals);
      expect(await Promise.all([
        quickWriter.upsertVerifiedState(observedState(admittedIds[0], 2_000)),
        quickWriter.upsertVerifiedState(observedState(admittedIds[1], 2_000)),
      ])).toEqual(['applied', 'applied']);
    } finally {
      if (gateBegun) await admissionGate.query('ROLLBACK');
      admissionGate.release();
    }

    const renewed = observedState(admittedIds[0], 3_000);
    expect(await writer.upsertVerifiedState(renewed)).toBe('applied');
    const tombstoneId = crypto.randomUUID();
    expect(await another.upsertVerifiedState({ ...observedState(tombstoneId), status: 'revoked' })).toBe('applied');
    expect(await writer.hasState(tombstoneId)).toBe(true);
    expect(await another.listKnownNonRevokedIds()).toHaveLength(32);

    expect(await writer.upsertVerifiedState({
      ...observedState(admittedIds[0], 3_000), status: 'revoked', epoch: 2, tokenValidAfter: 1,
    })).toBe('applied');
    expect(await another.listKnownNonRevokedIds()).toHaveLength(31);
    const sameNewState = observedState(rejectedId);
    expect((await Promise.all([
      writer.upsertVerifiedState(sameNewState),
      another.upsertVerifiedState(sameNewState),
    ])).sort()).toEqual(['applied', 'ignored']);

    await first.end();
    firstClosed = true;
    await second.end();
    secondClosed = true;
    restarted = new pg.Pool(connection);
    await migrateSyncDatabase(restarted);
    const afterRestart = createPostgresBoundStateWriter(restarted);
    expect(await afterRestart.listKnownNonRevokedIds()).toHaveLength(32);
    expect(await afterRestart.hasState(tombstoneId)).toBe(true);
    expect(await afterRestart.upsertVerifiedState(observedState(rejectedId, 2_000))).toBe('applied');
    await expect(afterRestart.upsertVerifiedState(observedState(crypto.randomUUID())))
      .rejects.toThrow('bound-state-feed-capacity-exceeded');
  } finally {
    if (!firstClosed) await first.end();
    if (!secondClosed) await second.end();
    await fastRenewals?.end();
    await restarted?.end();
    if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}, 60_000);
