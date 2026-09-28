import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { syncPullRequestSchema, syncPushRequestSchema } from '../../../packages/contracts/src';
import {
  AttachmentConflictError, AttachmentIntegrityError, AttachmentInvalidError, AttachmentNotFoundError, type AttachmentService,
  CIPHERTEXT_ATTACHMENT_TYPE,
} from '../../../packages/sync-core/src/attachments';
import { type PostgresSyncService, SyncForbiddenError } from '../../../packages/sync-core/src/postgres';

// A caller must verify credentials and return a stable subject ID. No anonymous sync route exists.
export type AuthRequest = {
  method: string;
  url: string;
  origin: string | undefined;
  dpop: string | undefined;
  scope: 'sync:read' | 'sync:write';
};
export type Authenticate = (authorization: string | undefined, request?: AuthRequest) => Promise<string | null>;

function configuredWebOrigin(value: string): string {
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password || url.search || url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw Error('sync-web-origin');
  return url.origin;
}

export function createPostgresSyncApp(service: PostgresSyncService, authenticate: Authenticate, attachments?: AttachmentService,
  options?: { webOrigin?: string }) {
  const app = new Hono();
  if (options?.webOrigin) {
    const origin = configuredWebOrigin(options.webOrigin);
    app.use('*', async (context, next) => {
      const supplied = context.req.header('origin');
      if (supplied && supplied !== origin) return context.json({ error: 'forbidden' }, 403);
      await next();
    });
    app.use('*', cors({ origin, allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type', 'DPoP', 'X-Ciphertext-SHA256'],
      exposeHeaders: ['X-Ciphertext-SHA256'], maxAge: 300 }));
  }
  const subjectFor = (context: { req: { header: (name: string) => string | undefined; raw: Request } }, scope: AuthRequest['scope']) =>
    authenticate(context.req.header('authorization'), {
      method: context.req.raw.method, url: context.req.raw.url,
      origin: context.req.header('origin'), dpop: context.req.header('dpop'), scope,
    });
  app.use('*', bodyLimit({ maxSize: 4 * 1024 * 1024 }));
  app.use('*', async (context, next) => { await next(); context.header('Cache-Control', 'no-store'); });
  app.onError((error, context) => {
    if (error instanceof HTTPException) return error.getResponse();
    if (error instanceof SyncForbiddenError) return context.json({ error: 'forbidden' }, 403);
    if (error instanceof AttachmentConflictError) return context.json({ error: 'attachment-conflict' }, 409);
    if (error instanceof AttachmentNotFoundError) return context.json({ error: 'attachment-not-found' }, 404);
    if (error instanceof AttachmentInvalidError) return context.json({ error: 'attachment-invalid' }, 400);
    if (error instanceof AttachmentIntegrityError) return context.json({ error: 'attachment-integrity' }, 502);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return context.json({ error: 'invalid-request' }, 400);
    return context.json({ error: 'internal' }, 500);
  });
  app.get('/healthz', context => context.json({ status: 'ok' }));
  app.post('/sync/identity', async context => {
    const subject = await subjectFor(context, 'sync:read');
    if (!subject) return context.json({ error: 'unauthorized' }, 401);
    return context.json({ accountId: subject });
  });
  app.post('/sync/preflight', async context => {
    const subject = await subjectFor(context, 'sync:write');
    if (!subject) return context.json({ error: 'unauthorized' }, 401);
    const { workspaceId } = z.object({ workspaceId: z.uuid() }).parse(await context.req.json());
    await service.assertWorkspaceAccess(workspaceId, subject);
    return context.json({ accountId: subject, workspaceId });
  });
  app.post('/workspaces', async context => {
    const subject = await subjectFor(context, 'sync:write');
    if (!subject) return context.json({ error: 'unauthorized' }, 401);
    const workspaceId = await service.createWorkspace(subject);
    return context.json({ workspaceId }, 201);
  });
  app.post('/sync/push', async context => {
    const subject = await subjectFor(context, 'sync:write');
    if (!subject) return context.json({ error: 'unauthorized' }, 401);
    const request = syncPushRequestSchema.parse(await context.req.json());
    return context.json(await service.push(request, subject));
  });
  app.post('/sync/pull', async context => {
    const subject = await subjectFor(context, 'sync:read');
    if (!subject) return context.json({ error: 'unauthorized' }, 401);
    const request = syncPullRequestSchema.parse(await context.req.json());
    return context.json(await service.pull(request, subject));
  });
  app.put('/workspaces/:workspaceId/attachments/:attachmentId', async context => {
    const subject = await subjectFor(context, 'sync:write');
    if (!subject) return context.json({ error: 'unauthorized' }, 401);
    if (!attachments) return context.json({ error: 'attachments-unavailable' }, 503);
    if (context.req.header('content-type') !== CIPHERTEXT_ATTACHMENT_TYPE) return context.json({ error: 'ciphertext-required' }, 415);
    const result = await attachments.put({
      workspaceId: context.req.param('workspaceId'), attachmentId: context.req.param('attachmentId'),
      sha256: context.req.header('x-ciphertext-sha256') ?? '',
      bytes: new Uint8Array(await context.req.arrayBuffer()),
    }, subject);
    return context.json(result, result.status === 'stored' ? 201 : 200);
  });
  app.get('/workspaces/:workspaceId/attachments/:attachmentId', async context => {
    const subject = await subjectFor(context, 'sync:read');
    if (!subject) return context.json({ error: 'unauthorized' }, 401);
    if (!attachments) return context.json({ error: 'attachments-unavailable' }, 503);
    const result = await attachments.get(context.req.param('workspaceId'), context.req.param('attachmentId'), subject);
    context.header('Content-Type', CIPHERTEXT_ATTACHMENT_TYPE);
    context.header('X-Content-Type-Options', 'nosniff');
    context.header('X-Ciphertext-SHA256', result.sha256);
    const body = new ArrayBuffer(result.bytes.length);
    new Uint8Array(body).set(result.bytes);
    return context.body(body);
  });
  return app;
}
