import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { syncPullRequestSchema, syncPushRequestSchema } from '../../../packages/contracts/src';
import { PostgresSyncService, SyncForbiddenError } from '../../../packages/sync-core/src/postgres';

// A caller must verify credentials and return a stable subject ID. No anonymous sync route exists.
export type Authenticate = (authorization: string | undefined) => Promise<string | null>;

export function createPostgresSyncApp(service: PostgresSyncService, authenticate: Authenticate) {
  const app = new Hono();
  app.use('*', bodyLimit({ maxSize: 4 * 1024 * 1024 }));
  app.use('*', async (context, next) => { await next(); context.header('Cache-Control', 'no-store'); });
  app.onError((error, context) => {
    if (error instanceof HTTPException) return error.getResponse();
    if (error instanceof SyncForbiddenError) return context.json({ error: 'forbidden' }, 403);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return context.json({ error: 'invalid-request' }, 400);
    return context.json({ error: 'internal' }, 500);
  });
  app.get('/healthz', context => context.json({ status: 'ok' }));
  app.post('/workspaces', async context => {
    const subject = await authenticate(context.req.header('authorization'));
    if (!subject) return context.json({ error: 'unauthorized' }, 401);
    const workspaceId = await service.createWorkspace(subject);
    return context.json({ workspaceId }, 201);
  });
  app.post('/sync/push', async context => {
    const subject = await authenticate(context.req.header('authorization'));
    if (!subject) return context.json({ error: 'unauthorized' }, 401);
    const request = syncPushRequestSchema.parse(await context.req.json());
    return context.json(await service.push(request, subject));
  });
  app.post('/sync/pull', async context => {
    const subject = await authenticate(context.req.header('authorization'));
    if (!subject) return context.json({ error: 'unauthorized' }, 401);
    const request = syncPullRequestSchema.parse(await context.req.json());
    return context.json(await service.pull(request, subject));
  });
  return app;
}
