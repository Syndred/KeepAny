import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { S3Client } from '@aws-sdk/client-s3';
import { serve } from '@hono/node-server';
import pg from 'pg';
import { expect, it } from 'vitest';
import { generateWorkspaceKey, openEnvelope, ReplayGuard, sealEnvelope } from '../../../packages/crypto/src';
import type { SyncOperation } from '../../../packages/contracts/src';
import { AttachmentService, CIPHERTEXT_ATTACHMENT_TYPE } from '../../../packages/sync-core/src/attachments';
import { PostgresSyncService } from '../../../packages/sync-core/src/postgres';
import { createPostgresSyncApp } from './app';
import { migrateSyncDatabase } from './migrate';
import { S3CiphertextObjectStore } from './s3-objects';

type PushBody = { results: Array<{ status: string; reason?: string; version: number; sequence: number }> };
type PullBody = { changes: Array<{ id: string; ciphertext: string; tombstone: boolean; sequence: number }>; nextCursor: number };

// Opt in explicitly. The test creates and drops its own schema in a real PostgreSQL database.
it.skipIf(!process.env.KEEPANY_TEST_DATABASE_URL)('runs two offline clients through Hono, PostgreSQL and signed S3 HTTP', async () => {
  const connectionString = process.env.KEEPANY_TEST_DATABASE_URL;
  if (!connectionString) throw Error('test-database-url');
  const schema = `keepany_it_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000 });
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 4, connectionTimeoutMillis: 5000 });
  const objects = new Map<string, Buffer>();
  const s3Mock = createServer(async (request, response) => {
    if (!request.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')) { response.writeHead(403).end(); return; }
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (request.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      objects.set(path, Buffer.concat(chunks));
      response.writeHead(200, { ETag: '"local-test"' }).end();
      return;
    }
    const bytes = objects.get(path);
    if (!bytes) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Length': bytes.length, 'Content-Type': CIPHERTEXT_ATTACHMENT_TYPE }).end(bytes);
  });
  let s3: S3Client | undefined;
  let server: ReturnType<typeof serve> | undefined;
  let schemaCreated = false;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    s3Mock.listen(0, '127.0.0.1');
    await once(s3Mock, 'listening');
    const s3Address = s3Mock.address();
    if (!s3Address || typeof s3Address === 'string') throw Error('s3-mock-address');
    s3 = new S3Client({ region: 'us-east-1', endpoint: `http://127.0.0.1:${s3Address.port}`,
      forcePathStyle: true, credentials: { accessKeyId: 'local-test-key', secretAccessKey: 'local-test-secret' },
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
    await migrateSyncDatabase(pool);
    const service = new PostgresSyncService(pool);
    const attachments = new AttachmentService(pool, new S3CiphertextObjectStore(s3, 'private-test-bucket'));
    const app = createPostgresSyncApp(service, async authorization =>
      authorization === 'Bearer device-a' || authorization === 'Bearer device-b' ? 'alice'
        : authorization === 'Bearer outsider' ? 'bob' : null, attachments);
    server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('hono-address');
    const base = `http://127.0.0.1:${address.port}`;
    const client = (token: string) => ({
      post: (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      get: (path: string) => fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } }),
      put: (path: string, bytes: Buffer, sha256: string) => {
        const body = new ArrayBuffer(bytes.length);
        new Uint8Array(body).set(bytes);
        return fetch(`${base}${path}`, { method: 'PUT',
          headers: { authorization: `Bearer ${token}`, 'content-type': CIPHERTEXT_ATTACHMENT_TYPE,
            'x-ciphertext-sha256': sha256 }, body });
      },
    });
    const deviceA = client('device-a');
    const deviceB = client('device-b');
    const outsider = client('outsider');
    const workspaceResponse = await deviceA.post('/workspaces', {});
    expect(workspaceResponse.status).toBe(201);
    const { workspaceId } = await workspaceResponse.json() as { workspaceId: string };
    const outsiderWorkspace = await outsider.post('/workspaces', {});
    expect(outsiderWorkspace.status).toBe(201);
    const { workspaceId: bobWorkspace } = await outsiderWorkspace.json() as { workspaceId: string };
    const key = await generateWorkspaceKey();
    const recordId = `asset:${crypto.randomUUID()}`;
    const makeOperation = async (plain: string, expectedVersion: number, sequence: number, tombstone = false): Promise<SyncOperation> => {
      const operationId = crypto.randomUUID();
      const envelope = await sealEnvelope(new TextEncoder().encode(plain), key, {
        workspaceId, recordId, schemaVersion: 1, keyEpoch: 1, sequence, operationId, tombstone,
      });
      return { operationId, id: recordId, kind: 'asset', schemaVersion: 1,
        expectedVersion, ciphertext: JSON.stringify(envelope), tombstone, intent: 'write' };
    };
    const first = await makeOperation('first-private-value', 0, 1);
    const firstResponse = await deviceA.post('/sync/push', { workspaceId, operations: [first] });
    expect((await firstResponse.json() as PushBody).results[0]).toMatchObject({ status: 'accepted', version: 1, sequence: 1 });
    expect((await deviceB.post('/sync/pull', { workspaceId, cursor: 0, limit: 1 }).then(response => response.json()) as PullBody).nextCursor).toBe(1);

    // Both devices now edit the same offline version and reconnect concurrently on separate HTTP requests.
    const editA = await makeOperation('device-a-private-value', 1, 2);
    const editB = await makeOperation('device-b-private-value', 1, 2);
    const [responseA, responseB] = await Promise.all([
      deviceA.post('/sync/push', { workspaceId, operations: [editA] }),
      deviceB.post('/sync/push', { workspaceId, operations: [editB] }),
    ]);
    const resultA = (await responseA.json() as PushBody).results[0];
    const resultB = (await responseB.json() as PushBody).results[0];
    expect([resultA.status, resultB.status].sort()).toEqual(['accepted', 'conflict']);
    const accepted = resultA.status === 'accepted' ? editA : editB;
    const acceptedClient = resultA.status === 'accepted' ? deviceA : deviceB;
    const rejected = resultA.status === 'conflict' ? editA : editB;
    const rejectedClient = resultA.status === 'conflict' ? deviceA : deviceB;
    // Replay models a response lost after commit; accepted operations are not written twice.
    expect((await acceptedClient.post('/sync/push', { workspaceId, operations: [accepted] }).then(response => response.json()) as PushBody).results[0])
      .toMatchObject({ status: 'duplicate', version: 2, sequence: 2 });
    expect((await rejectedClient.post('/sync/push', { workspaceId, operations: [rejected] }).then(response => response.json()) as PushBody).results[0])
      .toMatchObject({ status: 'conflict', version: 2 });

    const deleted = await makeOperation('deleted-private-value', 2, 3, true);
    expect((await deviceA.post('/sync/push', { workspaceId, operations: [deleted] }).then(response => response.json()) as PushBody).results[0])
      .toMatchObject({ status: 'accepted', version: 3, sequence: 3 });
    const resurrection = await makeOperation('resurrection-attempt', 3, 4);
    expect((await deviceB.post('/sync/push', { workspaceId, operations: [resurrection] }).then(response => response.json()) as PushBody).results[0])
      .toMatchObject({ status: 'conflict', reason: 'tombstone', version: 3 });
    const page1 = await deviceB.post('/sync/pull', { workspaceId, cursor: 1, limit: 1 }).then(response => response.json()) as PullBody;
    const page2 = await deviceB.post('/sync/pull', { workspaceId, cursor: page1.nextCursor, limit: 1 }).then(response => response.json()) as PullBody;
    expect([...page1.changes, ...page2.changes].map(change => change.sequence)).toEqual([2, 3]);
    expect(page2.changes[0].tombstone).toBe(true);
    const winningEnvelope = JSON.parse(page1.changes[0].ciphertext);
    expect(winningEnvelope.context).toMatchObject({ workspaceId, recordId, sequence: 2 });
    const opened = await openEnvelope(winningEnvelope, key, winningEnvelope.context, new ReplayGuard());
    expect(new TextDecoder().decode(opened)).toBe(accepted === editA ? 'device-a-private-value' : 'device-b-private-value');
    const stored = await pool.query<{ ciphertext: string }>('SELECT ciphertext FROM sync_documents WHERE workspace_id=$1 AND doc_id=$2', [workspaceId, recordId]);
    expect(stored.rows[0].ciphertext).not.toContain('deleted-private-value');
    expect(stored.rows[0].ciphertext).toContain('keepany-sync-envelope');

    expect((await outsider.post('/sync/pull', { workspaceId, cursor: 0 })).status).toBe(403);
    expect((await outsider.post('/sync/push', { workspaceId, operations: [await makeOperation('outsider', 3, 4)] })).status).toBe(403);
    expect((await deviceA.post('/sync/pull', { workspaceId: bobWorkspace, cursor: 0 })).status).toBe(403);

    const attachmentId = crypto.randomUUID();
    const image = Uint8Array.from([0, 1, 4, 9, 16]);
    const attachmentEnvelope = await sealEnvelope(image, key, { workspaceId, recordId: `attachment:${attachmentId}`,
      schemaVersion: 1, keyEpoch: 1, sequence: 1, operationId: crypto.randomUUID(), tombstone: false });
    const encryptedBytes = Buffer.from(JSON.stringify(attachmentEnvelope));
    const sha256 = createHash('sha256').update(encryptedBytes).digest('hex');
    const attachmentPath = `/workspaces/${workspaceId}/attachments/${attachmentId}`;
    expect((await deviceA.put(attachmentPath, encryptedBytes, sha256)).status).toBe(201);
    expect((await deviceB.put(attachmentPath, encryptedBytes, sha256)).status).toBe(200);
    expect((await outsider.get(attachmentPath)).status).toBe(403);
    const downloaded = await deviceB.get(attachmentPath);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get('x-ciphertext-sha256')).toBe(sha256);
    const returned = Buffer.from(await downloaded.arrayBuffer());
    expect(returned).toEqual(encryptedBytes);
    const decrypted = await openEnvelope(JSON.parse(returned.toString('utf8')), key, attachmentEnvelope.context, new ReplayGuard());
    expect(decrypted).toEqual(image);
    expect(objects.get(`/private-test-bucket/${workspaceId}/${attachmentId}`)).toEqual(encryptedBytes);
  } finally {
    const activeServer = server;
    if (activeServer) await new Promise<void>((resolve, reject) => activeServer.close(error => error ? reject(error) : resolve()));
    s3?.destroy();
    if (s3Mock.listening) {
      s3Mock.closeAllConnections();
      await new Promise<void>((resolve, reject) => s3Mock.close(error => error ? reject(error) : resolve()));
    }
    await pool.end();
    if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}, 60_000);
