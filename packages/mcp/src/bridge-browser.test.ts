import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from '@playwright/test';
import { afterEach, describe, expect, it } from 'vitest';
import { newAsset } from '../../domain/src';
import { McpAuthority, MemoryAuthorityStorage } from './authority';
import { startLocalMcpBridge, type LocalMcpBridge } from './bridge';

const pages: Server[] = [];
const bridges: LocalMcpBridge[] = [];
const browsers: Browser[] = [];

async function pageOrigin() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('<!doctype html><title>Isolated MCP bridge test</title>');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  pages.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await Promise.all(bridges.splice(0).map(bridge => bridge.close()));
  await Promise.all(browsers.splice(0).map(browser => browser.close()));
  await Promise.all(pages.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

describe('loopback MCP bridge in a real browser', () => {
  it('preflights an approved origin, rejects another page origin, then relays a scoped response', async () => {
    const appOrigin = await pageOrigin();
    const otherOrigin = await pageOrigin();
    const asset = { ...newAsset('account'), name: 'Browser-visible', username: 'hidden-login' };
    const authority = new McpAuthority(new MemoryAuthorityStorage());
    const grant = await authority.issueGrant({ assetIds: [asset.id], readFields: ['name'], ttlMs: 60_000 });
    const bridge = await startLocalMcpBridge({ appOrigin, authority, grantId: grant.id, grantSecret: grant.secret,
      requestTimeoutMs: 5_000 });
    bridges.push(bridge);
    const rejectedPreflight = await fetch(`${bridge.url}/pair`, { method: 'OPTIONS', headers: {
      Origin: otherOrigin, 'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    } });
    expect(rejectedPreflight.status).toBe(403);
    expect(rejectedPreflight.headers.get('access-control-allow-origin')).toBeNull();

    const browser = await chromium.launch({ headless: true });
    browsers.push(browser);
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const blockedPage = await context.newPage();
    await blockedPage.goto(otherOrigin);
    const blocked = await blockedPage.evaluate(async ({ url, secret }) => {
      try {
        await fetch(`${url}/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret }) });
        return false;
      } catch { return true; }
    }, { url: bridge.url, secret: bridge.pairingSecret });
    expect(blocked).toBe(true);

    const page = await context.newPage();
    await page.goto(appOrigin);
    const preflight = await fetch(`${bridge.url}/pair`, { method: 'OPTIONS', headers: {
      Origin: appOrigin, 'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(appOrigin);
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Content-Type');
    const paired = await page.evaluate(async ({ url, secret }) => {
      const response = await fetch(`${url}/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }) });
      return { status: response.status, body: await response.json() as {
        sessionSecret: string; scope: { assetIds: string[]; readFields: string[]; writeFields: string[] }
      } };
    }, { url: bridge.url, secret: bridge.pairingSecret });
    expect(paired.status).toBe(200);
    expect(paired.body.scope).toEqual({ assetIds: [asset.id], readFields: ['name'], writeFields: [] });
    // Chromium successfully read a JSON POST across origins, which requires its CORS preflight.

    const work = bridge.store.get(asset.id);
    const relay = await page.evaluate(async ({ url, token, assetId, createdAt, updatedAt, kind, deleted, name }) => {
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      let message: { id: string } | null = null;
      for (let attempt = 0; attempt < 100; attempt++) {
        const response = await fetch(`${url}/poll`, { method: 'POST', headers, body: '{}' });
        if (response.status === 200) { message = await response.json() as { id: string }; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      if (!message) throw Error('no bridge request');
      const response = await fetch(`${url}/respond`, { method: 'POST', headers,
        body: JSON.stringify({ id: message.id, result: { version: 'v1', asset: {
          id: assetId, kind, createdAt, updatedAt, deleted, name,
        } } }) });
      return response.status;
    }, { url: bridge.url, token: paired.body.sessionSecret, assetId: asset.id,
      createdAt: asset.createdAt, updatedAt: asset.updatedAt, kind: asset.kind, deleted: asset.deleted, name: asset.name });
    expect(relay).toBe(204);
    expect((await work)?.asset).toMatchObject({ id: asset.id, name: asset.name, username: '' });
  }, 20_000);
});
